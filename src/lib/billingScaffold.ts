/**
 * Jack of All Trades — Shared Stripe Billing, Credit Ledger & B2B2C Proof Scaffold
 * License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
 *
 * Browser-safe monetization contract (ADR 009):
 *  - Server-authoritative Pay-As-You-Go Repair Credit Packs + optional Pro Monthly tier
 *    so clients NEVER dictate prices or credit quantities.
 *  - Per-action credit weights mapping directly to Gemini inference COGS so the platform
 *    never extends an unbounded "blank check" to unauthenticated or unpaid callers.
 *  - B2B2C Proof-of-Deflection attribution channels connecting completed repairs to brands.
 */

export type BillingEnforcementMode = 'scaffold' | 'enforced';

export type BillingPackType = 'one_time_credits' | 'subscription_monthly';

export type BillableActionType =
  | 'demo_narration'
  | 'scan_problem'
  | 'voice_assist'
  | 'generate_pip';

export type DeflectionAttributionChannel =
  | 'brand_qr_box'
  | 'support_portal_redirect'
  | 'barcode_sku_scan'
  | 'organic_camera';

export interface BillingPack {
  id: string;
  name: string;
  billingType: BillingPackType;
  priceCents: number;
  currency: 'usd';
  creditsGranted: number;
  estimatedCogsCents: number;
  badge?: string;
  description: string;
  stripePriceEnvVar: string;
}

export interface ActionCreditRule {
  action: BillableActionType;
  label: string;
  creditsRequired: number;
  estimatedCogsUsd: number;
  rationale: string;
}

export interface WalletSnapshot {
  userId: string;
  creditBalance: number;
  starterCreditsGranted: number;
  subscriptionStatus: 'none' | 'active' | 'past_due' | 'canceled';
  enforcementMode: BillingEnforcementMode;
  sponsoredBrandPassActive: boolean;
}

export interface CreditGateDecision {
  allowed: boolean;
  reason: 'scaffold_mode' | 'free_action' | 'brand_sponsored' | 'sufficient_credits' | 'insufficient_credits';
  creditsRequired: number;
  remainingBalance: number;
  httpStatus: 200 | 402;
}

/**
 * Starter credits granted once to newly registered end users so they can verify
 * real camera/voice value before purchasing a credit pack.
 */
export const DEFAULT_STARTER_CREDITS = 2;

/**
 * Authoritative catalog (ADR 009).
 * The server resolves priceCents and creditsGranted strictly from this table by `packId`.
 */
export const BILLING_CREDIT_PACKS: readonly BillingPack[] = [
  {
    id: 'starter_10',
    name: 'Starter Repair Pack',
    billingType: 'one_time_credits',
    priceCents: 499,
    currency: 'usd',
    creditsGranted: 10,
    estimatedCogsCents: 65,
    description: 'Pay-as-you-go pack for 1–2 weekend repairs (up to 10 scans/voice checks or 5 PiP motion clips). Credits never expire.',
    stripePriceEnvVar: 'STRIPE_PRICE_STARTER_10',
  },
  {
    id: 'homeowner_30',
    name: 'Homeowner Toolkit Pack',
    billingType: 'one_time_credits',
    priceCents: 1299,
    currency: 'usd',
    creditsGranted: 30,
    estimatedCogsCents: 195,
    badge: 'Best Value',
    description: 'Ideal for multi-room projects, appliances, and furniture assembly. No recurring subscription.',
    stripePriceEnvVar: 'STRIPE_PRICE_HOMEOWNER_30',
  },
  {
    id: 'pro_pack_100',
    name: 'Handyman 100-Credit Pack',
    billingType: 'one_time_credits',
    priceCents: 2999,
    currency: 'usd',
    creditsGranted: 100,
    estimatedCogsCents: 650,
    description: 'High-volume prepaid pack for frequent DIYers, landlords, and field technicians.',
    stripePriceEnvVar: 'STRIPE_PRICE_PRO_100',
  },
  {
    id: 'pro_unlimited_monthly',
    name: 'Pro Technician Monthly',
    billingType: 'subscription_monthly',
    priceCents: 1999,
    currency: 'usd',
    creditsGranted: 120,
    estimatedCogsCents: 780,
    description: 'Optional monthly allowance (120 fair-use credits/mo) tailored for daily service pros.',
    stripePriceEnvVar: 'STRIPE_PRICE_PRO_MONTHLY',
  },
] as const;

/**
 * Per-action credit cost matrix tied directly to Gemini 4 model tier COGS.
 */
export const ACTION_CREDIT_RULES: readonly ActionCreditRule[] = [
  {
    action: 'demo_narration',
    label: 'Interactive Onboarding Demo',
    creditsRequired: 0,
    estimatedCogsUsd: 0.0,
    rationale: 'Cached WAV narration + local canvas — zero inference burn.',
  },
  {
    action: 'scan_problem',
    label: 'Scan Problem (Vision + AR + TTS)',
    creditsRequired: 1,
    estimatedCogsUsd: 0.06,
    rationale: 'Zero-token gemini-decision-1 gate -> gemini-4-neon + RAG + 3.8 TTS.',
  },
  {
    action: 'voice_assist',
    label: 'Hold to Explain (Voice + Vision + TTS)',
    creditsRequired: 1,
    estimatedCogsUsd: 0.07,
    rationale: 'Multimodal audio + frame reasoning in user language + RIFF WAV reply.',
  },
  {
    action: 'generate_pip',
    label: 'Show Step Motion (6s PiP Video Clip)',
    creditsRequired: 2,
    estimatedCogsUsd: 0.18,
    rationale: 'On-demand gemini-omni-1.2-flash 720p video clip, cached per step.',
  },
] as const;

export function resolveBillingEnforcementMode(raw?: string | null): BillingEnforcementMode {
  return (raw || '').trim().toLowerCase() === 'enforced' ? 'enforced' : 'scaffold';
}

export function getBillingPackById(packId?: string | null): BillingPack | undefined {
  if (!packId || typeof packId !== 'string') return undefined;
  const cleaned = packId.trim();
  return BILLING_CREDIT_PACKS.find((pack) => pack.id === cleaned);
}

export function getActionCreditCost(action: BillableActionType): number {
  const rule = ACTION_CREDIT_RULES.find((item) => item.action === action);
  return rule ? rule.creditsRequired : 1;
}

/**
 * Pure server-side credit gate evaluator.
 * - Always allows free actions (0 credits) and brand-sponsored sessions (paid by OEM wallet).
 * - In `'scaffold'` mode, allows requests while reporting the credits that would be charged.
 * - In `'enforced'` mode, returns `allowed: false` + `httpStatus: 402` when balance < cost.
 */
export function evaluateCreditGate(input: {
  action: BillableActionType;
  creditBalance: number;
  enforcementMode: BillingEnforcementMode;
  brandSponsored?: boolean;
}): CreditGateDecision {
  const creditsRequired = getActionCreditCost(input.action);
  const safeBalance = Math.max(0, Math.floor(input.creditBalance));

  if (creditsRequired === 0) {
    return {
      allowed: true,
      reason: 'free_action',
      creditsRequired: 0,
      remainingBalance: safeBalance,
      httpStatus: 200,
    };
  }

  if (input.brandSponsored) {
    return {
      allowed: true,
      reason: 'brand_sponsored',
      creditsRequired,
      remainingBalance: safeBalance,
      httpStatus: 200,
    };
  }

  if (input.enforcementMode === 'scaffold') {
    return {
      allowed: true,
      reason: 'scaffold_mode',
      creditsRequired,
      remainingBalance: Math.max(0, safeBalance - creditsRequired),
      httpStatus: 200,
    };
  }

  if (safeBalance >= creditsRequired) {
    return {
      allowed: true,
      reason: 'sufficient_credits',
      creditsRequired,
      remainingBalance: safeBalance - creditsRequired,
      httpStatus: 200,
    };
  }

  return {
    allowed: false,
    reason: 'insufficient_credits',
    creditsRequired,
    remainingBalance: safeBalance,
    httpStatus: 402,
  };
}

export function formatUsdFromCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
