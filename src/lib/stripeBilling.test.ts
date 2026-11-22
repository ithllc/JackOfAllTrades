import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BILLING_CREDIT_PACKS,
  evaluateCreditGate,
  formatUsdFromCents,
  getActionCreditCost,
  getBillingPackById,
  resolveBillingEnforcementMode,
} from './billingScaffold';
import {
  buildDeflectionProofHash,
  getStripeConfigStatus,
  resolveSafeCheckoutOrigin,
  signStripeWebhookHeader,
  verifyStripeWebhookSignature,
} from './serverStripe';

test('server-authoritative billing catalog resolves valid packs and rejects unknown IDs', () => {
  const starter = getBillingPackById('starter_10');
  assert.ok(starter);
  assert.equal(starter.priceCents, 499);
  assert.equal(starter.creditsGranted, 10);
  assert.equal(formatUsdFromCents(starter.priceCents), '$4.99');

  const proMonthly = getBillingPackById('pro_unlimited_monthly');
  assert.ok(proMonthly);
  assert.equal(proMonthly.billingType, 'subscription_monthly');

  assert.equal(getBillingPackById('free_10000_credits'), undefined);
  assert.equal(BILLING_CREDIT_PACKS.length, 4);
});

test('per-action credit gate enforces balances in enforced mode while allowing free and brand-sponsored flows', () => {
  assert.equal(getActionCreditCost('demo_narration'), 0);
  assert.equal(getActionCreditCost('scan_problem'), 1);
  assert.equal(getActionCreditCost('voice_assist'), 1);
  assert.equal(getActionCreditCost('generate_pip'), 2);

  // Demo narration is always free
  const demoGate = evaluateCreditGate({
    action: 'demo_narration',
    creditBalance: 0,
    enforcementMode: 'enforced',
  });
  assert.equal(demoGate.allowed, true);
  assert.equal(demoGate.reason, 'free_action');

  // Brand-sponsored repair passes bypass consumer credit charge
  const sponsoredGate = evaluateCreditGate({
    action: 'generate_pip',
    creditBalance: 0,
    enforcementMode: 'enforced',
    brandSponsored: true,
  });
  assert.equal(sponsoredGate.allowed, true);
  assert.equal(sponsoredGate.reason, 'brand_sponsored');

  // Scaffold mode does not block prior to Stripe rollout
  const scaffoldGate = evaluateCreditGate({
    action: 'scan_problem',
    creditBalance: 0,
    enforcementMode: 'scaffold',
  });
  assert.equal(scaffoldGate.allowed, true);
  assert.equal(scaffoldGate.httpStatus, 200);

  // Enforced mode blocks with HTTP 402 when credits are insufficient
  const blockedPip = evaluateCreditGate({
    action: 'generate_pip',
    creditBalance: 1,
    enforcementMode: 'enforced',
  });
  assert.equal(blockedPip.allowed, false);
  assert.equal(blockedPip.httpStatus, 402);
  assert.equal(blockedPip.reason, 'insufficient_credits');

  // Enforced mode deducts cleanly when sufficient
  const allowedPip = evaluateCreditGate({
    action: 'generate_pip',
    creditBalance: 5,
    enforcementMode: 'enforced',
  });
  assert.equal(allowedPip.allowed, true);
  assert.equal(allowedPip.remainingBalance, 3);
});

test('Stripe webhook signature verification validates authentic signatures and blocks tampering or replay', () => {
  const secret = 'whsec_test_99112233445566778899aabbccddeeff';
  const payload = JSON.stringify({
    id: 'evt_test_123',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_123', metadata: { pack_id: 'starter_10' } } },
  });
  const nowSec = 1_750_000_000;
  const header = signStripeWebhookHeader(payload, secret, nowSec);

  const ok = verifyStripeWebhookSignature(payload, header, secret, { nowSec: nowSec + 20 });
  assert.equal(ok.valid, true);
  assert.equal(ok.timestampSec, nowSec);

  // Tampered body must fail
  const tampered = verifyStripeWebhookSignature(payload + ' ', header, secret, {
    nowSec: nowSec + 20,
  });
  assert.equal(tampered.valid, false);
  assert.equal(tampered.reason, 'signature_mismatch');

  // Replayed timestamp (> 300s old) must fail
  const replayed = verifyStripeWebhookSignature(payload, header, secret, {
    nowSec: nowSec + 450,
  });
  assert.equal(replayed.valid, false);
  assert.equal(replayed.reason, 'timestamp_outside_tolerance');

  // Wrong signing secret must fail
  const wrongSecret = verifyStripeWebhookSignature(
    payload,
    header,
    'whsec_other_11223344556677889900112233445566',
    { nowSec }
  );
  assert.equal(wrongSecret.valid, false);
});

test('Stripe config status ignores placeholders and checkout origin blocks unsafe redirect schemes', () => {
  const placeholderStatus = getStripeConfigStatus({
    STRIPE_SECRET_KEY: 'sk_test_placeholder_change_me',
    STRIPE_WEBHOOK_SECRET: 'whsec_placeholder_change_me',
    BILLING_ENFORCEMENT_MODE: 'scaffold',
  });
  assert.equal(placeholderStatus.configured, false);
  assert.equal(placeholderStatus.keyMode, 'unconfigured');
  assert.equal(resolveBillingEnforcementMode('enforced'), 'enforced');
  assert.equal(resolveBillingEnforcementMode(undefined), 'scaffold');

  assert.equal(
    resolveSafeCheckoutOrigin({ appUrl: 'https://jackofalltrades.example.com/some/path' }),
    'https://jackofalltrades.example.com'
  );
  assert.equal(
    resolveSafeCheckoutOrigin({
      appUrl: 'javascript:alert(1)',
      requestHost: 'app.local:3000',
      protocol: 'http',
    }),
    'http://app.local:3000'
  );
});

test('B2B2C deflection proof hash is deterministic and sensitive to any altered claim', () => {
  const base = {
    sessionId: '550e8400-e29b-41d4-a716-446655440000',
    brandId: 1,
    productSku: 'ikea-billy-80',
    attributionChannel: 'brand_qr_box' as const,
    beforeIssueSummary: 'Concealed hinge sagging 5mm',
    afterVerifiedState: 'Hinge seated flush on plate',
    completedAtIso: '2026-11-22T08:00:00.000Z',
  };

  const h1 = buildDeflectionProofHash(base);
  const h2 = buildDeflectionProofHash({ ...base, productSku: 'IKEA-BILLY-80' });
  const h3 = buildDeflectionProofHash({ ...base, brandId: 2 });

  assert.equal(h1.length, 64);
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
});
