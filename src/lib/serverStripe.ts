/**
 * Jack of All Trades — Server-Side Stripe Checkout, Webhook Verification & B2B2C Proof Helper
 * License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
 *
 * Node.js-only payment scaffold (ADR 009):
 *  - Reads `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` strictly from `process.env`.
 *  - Verifies Stripe `Stripe-Signature` (`t=<unix>,v1=<hmac_sha256>`) using raw bytes,
 *    a 5-minute replay window, and `crypto.timingSafeEqual`.
 *  - Calls Stripe's HTTPS Checkout Sessions API using server-authoritative `BILLING_CREDIT_PACKS`
 *    pricing (never trusting client-supplied amounts or credit quantities).
 *  - Computes tamper-evident SHA-256 hashes for B2B2C Verified Deflection Proof Certificates.
 */

import crypto from 'node:crypto';
import {
  getBillingPackById,
  resolveBillingEnforcementMode,
  type BillingEnforcementMode,
  type BillingPack,
  type DeflectionAttributionChannel,
} from './billingScaffold';

export interface StripeConfigStatus {
  configured: boolean;
  webhookSecretConfigured: boolean;
  publishableKeyConfigured: boolean;
  keyMode: 'live' | 'test' | 'unconfigured';
  enforcementMode: BillingEnforcementMode;
}

export interface WebhookVerificationResult {
  valid: boolean;
  reason?: string;
  timestampSec?: number;
}

export interface StripeCheckoutCreateResult {
  ok: boolean;
  code:
    | 'CHECKOUT_CREATED'
    | 'STRIPE_SCAFFOLD_PENDING'
    | 'INVALID_PACK'
    | 'STRIPE_API_ERROR';
  sessionId?: string;
  checkoutUrl?: string;
  pack?: BillingPack;
  error?: string;
}

const PLACEHOLDER_TOKENS = [
  'CHANGE_ME',
  'YOUR_STRIPE',
  'MY_STRIPE',
  'sk_test_placeholder',
  'whsec_placeholder',
];

function isRealConfiguredSecret(value?: string | null): boolean {
  const trimmed = (value || '').trim();
  if (trimmed.length < 16) return false;
  return !PLACEHOLDER_TOKENS.some((token) =>
    trimmed.toUpperCase().includes(token.toUpperCase())
  );
}

/**
 * Returns non-secret Stripe configuration readiness flags safe for Admin UI & `/api/billing/config`.
 */
export function getStripeConfigStatus(env: NodeJS.ProcessEnv = process.env): StripeConfigStatus {
  const secretKey = (env.STRIPE_SECRET_KEY || '').trim();
  const configured = isRealConfiguredSecret(secretKey) && secretKey.startsWith('sk_');
  const webhookSecretConfigured = isRealConfiguredSecret(env.STRIPE_WEBHOOK_SECRET);
  const publishableKey = (env.STRIPE_PUBLISHABLE_KEY || '').trim();
  const publishableKeyConfigured =
    isRealConfiguredSecret(publishableKey) && publishableKey.startsWith('pk_');

  let keyMode: StripeConfigStatus['keyMode'] = 'unconfigured';
  if (configured) {
    keyMode = secretKey.startsWith('sk_live_') ? 'live' : 'test';
  }

  return {
    configured,
    webhookSecretConfigured,
    publishableKeyConfigured,
    keyMode,
    enforcementMode: resolveBillingEnforcementMode(env.BILLING_ENFORCEMENT_MODE),
  };
}

/**
 * Derives a safe HTTPS/HTTP origin for Stripe Checkout `success_url` / `cancel_url`.
 * Never accepts arbitrary external redirect targets supplied by untrusted clients.
 */
export function resolveSafeCheckoutOrigin(options: {
  appUrl?: string | null;
  requestHost?: string | null;
  protocol?: string | null;
}): string {
  const candidates = [options.appUrl];
  for (const raw of candidates) {
    if (!raw || typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.includes('MY_APP_URL')) continue;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return parsed.origin;
      }
    } catch {
      // Ignore malformed APP_URL and fall back safely
    }
  }

  const host = (options.requestHost || '').trim();
  if (host && /^[a-zA-Z0-9.-]+(:\d{1,5})?$/.test(host)) {
    const safeProto = options.protocol === 'https' ? 'https' : 'http';
    return `${safeProto}://${host}`;
  }

  return 'http://localhost:3000';
}

/**
 * Generates a Stripe-compatible `Stripe-Signature` header (`t=<sec>,v1=<hex>`) for tests.
 */
export function signStripeWebhookHeader(
  rawBody: string | Buffer,
  webhookSecret: string,
  timestampSec: number = Math.floor(Date.now() / 1000)
): string {
  const payloadStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
  const signedPayload = `${timestampSec}.${payloadStr}`;
  const signatureHex = crypto
    .createHmac('sha256', webhookSecret)
    .update(signedPayload, 'utf8')
    .digest('hex');
  return `t=${timestampSec},v1=${signatureHex}`;
}

/**
 * Verifies Stripe's `Stripe-Signature` header against the exact raw request bytes
 * with replay-window enforcement (default 300s) and constant-time HMAC comparison.
 */
export function verifyStripeWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined | null,
  webhookSecret: string | undefined | null,
  options?: {
    toleranceSec?: number;
    nowSec?: number;
  }
): WebhookVerificationResult {
  if (!webhookSecret || !isRealConfiguredSecret(webhookSecret)) {
    return { valid: false, reason: 'webhook_secret_not_configured' };
  }
  if (!signatureHeader || typeof signatureHeader !== 'string') {
    return { valid: false, reason: 'missing_signature_header' };
  }

  const parts = signatureHeader.split(',').map((part) => part.trim());
  let timestampSec: number | null = null;
  const v1Signatures: string[] = [];

  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key === 't') {
      const parsed = Number(val);
      if (Number.isInteger(parsed) && parsed > 0) {
        timestampSec = parsed;
      }
    } else if (key === 'v1' && /^[a-fA-F0-9]{64}$/.test(val)) {
      v1Signatures.push(val.toLowerCase());
    }
  }

  if (timestampSec === null || v1Signatures.length === 0) {
    return { valid: false, reason: 'malformed_signature_header' };
  }

  const nowSec = options?.nowSec ?? Math.floor(Date.now() / 1000);
  const toleranceSec = options?.toleranceSec ?? 300;
  if (Math.abs(nowSec - timestampSec) > toleranceSec) {
    return { valid: false, reason: 'timestamp_outside_tolerance', timestampSec };
  }

  const payloadStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
  const expectedHex = crypto
    .createHmac('sha256', webhookSecret)
    .update(`${timestampSec}.${payloadStr}`, 'utf8')
    .digest('hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  const matched = v1Signatures.some((sigHex) => {
    const sigBuf = Buffer.from(sigHex, 'hex');
    if (sigBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expectedBuf);
  });

  if (!matched) {
    return { valid: false, reason: 'signature_mismatch', timestampSec };
  }

  return { valid: true, timestampSec };
}

/**
 * Creates a Stripe Hosted Checkout Session using strictly server-authoritative pack metadata.
 * When `STRIPE_SECRET_KEY` is not yet configured, returns a structured scaffold response.
 */
export async function createStripeCheckoutSessionViaApi(input: {
  packId: string;
  userId: string;
  userEmail?: string | null;
  origin: string;
  env?: NodeJS.ProcessEnv;
}): Promise<StripeCheckoutCreateResult> {
  const pack = getBillingPackById(input.packId);
  if (!pack) {
    return {
      ok: false,
      code: 'INVALID_PACK',
      error: 'Unknown billing pack requested.',
    };
  }

  const env = input.env ?? process.env;
  const status = getStripeConfigStatus(env);
  if (!status.configured) {
    return {
      ok: false,
      code: 'STRIPE_SCAFFOLD_PENDING',
      pack,
      error:
        'Stripe checkout is scaffolded and ready. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in server environment secrets to launch live payments.',
    };
  }

  const secretKey = (env.STRIPE_SECRET_KEY || '').trim();
  const configuredPriceId = (env[pack.stripePriceEnvVar] || '').trim();

  const params = new URLSearchParams();
  params.set(
    'mode',
    pack.billingType === 'subscription_monthly' ? 'subscription' : 'payment'
  );
  params.set(
    'success_url',
    `${input.origin}/?billing=success&session_id={CHECKOUT_SESSION_ID}`
  );
  params.set('cancel_url', `${input.origin}/?billing=canceled`);
  params.set('client_reference_id', input.userId);
  params.set('metadata[user_id]', input.userId);
  params.set('metadata[pack_id]', pack.id);
  params.set('metadata[credits_granted]', String(pack.creditsGranted));
  params.set('metadata[billing_type]', pack.billingType);

  if (input.userEmail) {
    params.set('customer_email', input.userEmail);
  }

  if (configuredPriceId.startsWith('price_')) {
    params.set('line_items[0][price]', configuredPriceId);
    params.set('line_items[0][quantity]', '1');
  } else {
    params.set('line_items[0][quantity]', '1');
    params.set('line_items[0][price_data][currency]', pack.currency);
    params.set('line_items[0][price_data][unit_amount]', String(pack.priceCents));
    params.set('line_items[0][price_data][product_data][name]', pack.name);
    params.set('line_items[0][price_data][product_data][description]', pack.description);
    if (pack.billingType === 'subscription_monthly') {
      params.set('line_items[0][price_data][recurring][interval]', 'month');
    }
  }

  try {
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = (await response.json().catch(() => ({}))) as {
      id?: string;
      url?: string;
      error?: { message?: string };
    };

    if (!response.ok || !data.id || !data.url) {
      return {
        ok: false,
        code: 'STRIPE_API_ERROR',
        pack,
        error: data.error?.message || `Stripe Checkout API returned HTTP ${response.status}.`,
      };
    }

    return {
      ok: true,
      code: 'CHECKOUT_CREATED',
      sessionId: data.id,
      checkoutUrl: data.url,
      pack,
    };
  } catch (err) {
    return {
      ok: false,
      code: 'STRIPE_API_ERROR',
      pack,
      error: (err as Error).message || 'Could not reach Stripe API.',
    };
  }
}

/**
 * Computes a deterministic, tamper-evident SHA-256 certificate digest proving that a
 * specific product SKU repair session completed safely via a verifiable attribution channel.
 */
export function buildDeflectionProofHash(input: {
  sessionId: string;
  brandId: number;
  productSku: string;
  attributionChannel: DeflectionAttributionChannel;
  beforeIssueSummary: string;
  afterVerifiedState: string;
  completedAtIso: string;
}): string {
  const canonical = JSON.stringify({
    sessionId: input.sessionId.trim(),
    brandId: input.brandId,
    productSku: input.productSku.trim().toUpperCase(),
    attributionChannel: input.attributionChannel,
    beforeIssueSummary: input.beforeIssueSummary.trim(),
    afterVerifiedState: input.afterVerifiedState.trim(),
    completedAtIso: input.completedAtIso.trim(),
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}
