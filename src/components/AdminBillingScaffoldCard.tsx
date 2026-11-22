/**
 * Jack of All Trades — Admin Stripe Payments, Credits & B2B2C Proof Scaffold Card
 * License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
 */

import React from 'react';
import { CreditCard, ShieldCheck } from 'lucide-react';
import {
  ACTION_CREDIT_RULES,
  BILLING_CREDIT_PACKS,
  DEFAULT_STARTER_CREDITS,
  formatUsdFromCents,
  type BillingEnforcementMode,
} from '../lib/billingScaffold';

export interface BillingOverviewPayload {
  stripe: {
    configured: boolean;
    webhookSecretConfigured: boolean;
    publishableKeyConfigured: boolean;
    keyMode: 'live' | 'test' | 'unconfigured';
    enforcementMode: BillingEnforcementMode;
  };
  liveMetrics?: {
    source: 'postgresql_live' | 'scaffold_fallback';
    activeWallets: number;
    totalCreditsPurchased: number;
    totalCreditsSpent: number;
    verifiedDeflectionProofs: number;
    brandSponsoredPoolCredits: number;
  };
  starterCreditsGranted: number;
  webhookPath: string;
  b2b2cAttributionChannels: Array<{
    channel: string;
    label: string;
    proofStrength: string;
    description: string;
  }>;
}

interface AdminBillingScaffoldCardProps {
  overview: BillingOverviewPayload | null;
}

export const AdminBillingScaffoldCard: React.FC<AdminBillingScaffoldCardProps> = ({
  overview,
}) => {
  const stripeConfigured = Boolean(overview?.stripe?.configured);
  const webhookReady = Boolean(overview?.stripe?.webhookSecretConfigured);
  const enforcementMode = overview?.stripe?.enforcementMode ?? 'scaffold';
  const isEnforced = enforcementMode === 'enforced';
  const metrics = overview?.liveMetrics;
  const isLivePg = metrics?.source === 'postgresql_live';

  return (
    <section
      aria-labelledby="billing-scaffold-heading"
      className="rounded-xl border border-slate-200 bg-white p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
            <CreditCard className="h-5 w-5 text-slate-800" aria-hidden="true" />
          </div>
          <div>
            <h2 id="billing-scaffold-heading" className="text-lg font-semibold text-slate-900">
              Stripe Payments, Credit Ledger &amp; B2B2C Attribution Scaffold (ADR 009)
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Pay-as-you-go repair credits cap AI inference spend per user while avoiding app-store commissions on the Web PWA. Brand-sponsored QR/portal passes link directly to verifiable deflection proofs.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold ${
              stripeConfigured
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 bg-slate-50 text-slate-700'
            }`}
          >
            Stripe: {stripeConfigured ? `Connected (${overview?.stripe?.keyMode})` : 'Scaffold (Keys Pending)'}
          </span>
          <span
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold ${
              isEnforced
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-amber-200 bg-amber-50 text-amber-900'
            }`}
          >
            Billing Gate: {isEnforced ? 'Enforced (402)' : 'Scaffold (Pre-Rollout)'}
          </span>
        </div>
      </div>

      {/* Live Cloud SQL Billing & Deflection Proof Counters */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-[11px] font-medium text-slate-500">Active Wallets</p>
          <p className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
            {metrics ? metrics.activeWallets : '—'}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {isLivePg ? 'Live Cloud SQL' : 'Run migration 003'}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-[11px] font-medium text-slate-500">Credits Purchased / Spent</p>
          <p className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
            {metrics ? `${metrics.totalCreditsPurchased} / ${metrics.totalCreditsSpent}` : '—'}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">credit_ledger_entries</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-[11px] font-medium text-slate-500">Verified Deflection Proofs</p>
          <p className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
            {metrics ? metrics.verifiedDeflectionProofs : '—'}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">SHA-256 certificates</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-[11px] font-medium text-slate-500">Brand Sponsored Pool</p>
          <p className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
            {metrics ? metrics.brandSponsoredPoolCredits : '—'}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">OEM prepaid credits</p>
        </div>
      </div>

      {/* 3-Column Readiness Summary */}
      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold text-slate-900">Server-Authoritative Checkout</p>
          <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
            <code className="font-mono text-[11px]">POST /api/billing/checkout-session</code> resolves prices and credit grants strictly from server catalog IDs—clients never submit dollar totals.
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold text-slate-900">Idempotent Webhook Fulfillment</p>
          <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
            <code className="font-mono text-[11px]">POST /api/billing/webhook</code> verifies raw-body <code className="font-mono text-[11px]">Stripe-Signature</code> HMACs ({webhookReady ? 'secret active' : 'awaiting STRIPE_WEBHOOK_SECRET'}) and handles checkout, renewals, and cancellations via <code className="font-mono text-[11px]">stripe_webhook_events</code>.
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold text-slate-900">No Blank-Check Inference Cap</p>
          <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
            New accounts receive <strong className="font-semibold text-slate-800">{DEFAULT_STARTER_CREDITS} starter credits</strong>; scans/voice cost 1 credit, PiP clips cost 2, and partner brand QR scans bill the OEM pool instead.
          </p>
        </div>
      </div>

      {/* Two-Column Tables: Credit Packs + Per-Action Cost Matrix */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <h3 className="text-xs font-semibold text-slate-900">
              Server-Authoritative Stripe Credit Packs &amp; Pro Plan
            </h3>
          </div>
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-white text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-2 font-semibold">Pack ID</th>
                <th scope="col" className="px-4 py-2 font-semibold">Type</th>
                <th scope="col" className="px-4 py-2 font-semibold">Price</th>
                <th scope="col" className="px-4 py-2 font-semibold">Credits</th>
                <th scope="col" className="px-4 py-2 font-semibold">Est. COGS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {BILLING_CREDIT_PACKS.map((pack) => (
                <tr key={pack.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-slate-900">{pack.id}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {pack.billingType === 'subscription_monthly' ? 'Monthly Sub' : 'One-Time Pack'}
                  </td>
                  <td className="px-4 py-2 font-mono font-semibold text-slate-900 tabular-nums">
                    {formatUsdFromCents(pack.priceCents)}
                  </td>
                  <td className="px-4 py-2 font-mono text-slate-800 tabular-nums">
                    {pack.creditsGranted}
                  </td>
                  <td className="px-4 py-2 font-mono text-emerald-700 tabular-nums">
                    ~{formatUsdFromCents(pack.estimatedCogsCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <h3 className="text-xs font-semibold text-slate-900">
              Per-Action Credit Weights (Mapped to Gemini 4 COGS)
            </h3>
          </div>
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-white text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-2 font-semibold">Action</th>
                <th scope="col" className="px-4 py-2 font-semibold">Credits</th>
                <th scope="col" className="px-4 py-2 font-semibold">Est. COGS</th>
                <th scope="col" className="px-4 py-2 font-semibold">Compute Scope</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {ACTION_CREDIT_RULES.map((rule) => (
                <tr key={rule.action} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-900">{rule.label}</td>
                  <td className="px-4 py-2 font-mono font-semibold text-slate-900 tabular-nums">
                    {rule.creditsRequired}
                  </td>
                  <td className="px-4 py-2 font-mono text-slate-600 tabular-nums">
                    ${rule.estimatedCogsUsd.toFixed(2)}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{rule.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* B2B2C Proof-of-Deflection Attribution Channels */}
      {overview?.b2b2cAttributionChannels && overview.b2b2cAttributionChannels.length > 0 && (
        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-slate-800" aria-hidden="true" />
            <h3 className="text-xs font-semibold text-slate-900">
              B2B2C Proof-of-Deflection Attribution Channels (<code className="font-mono text-[11px] text-slate-700">brand_deflection_proofs</code>)
            </h3>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            {overview.b2b2cAttributionChannels.map((item) => (
              <div key={item.channel} className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-900">{item.label}</p>
                  <span className="font-mono text-[11px] text-slate-500">{item.proofStrength}</span>
                </div>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
