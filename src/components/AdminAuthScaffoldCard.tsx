/**
 * Jack of All Trades — Admin Authentication & RBAC Scaffold UI
 * License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
 *
 * Provides:
 *  1. <AdminAuthScaffoldCard /> — Security status & RBAC route-policy table on the Admin Overview tab.
 *  2. <AdminLoginGate /> — Clean operator sign-in gate rendered automatically whenever
 *     `AUTH_ENFORCEMENT_MODE=enforced` is activated on the server.
 */

import React, { useState } from 'react';
import { KeyRound, Lock, LogOut, ShieldCheck } from 'lucide-react';
import {
  ROUTE_ACCESS_POLICIES,
  type AuthSessionState,
} from '../lib/authScaffold';
import { JACK_OF_SPADES_LOGO_URL } from './BrandMark';

interface AdminAuthScaffoldCardProps {
  session: AuthSessionState;
  onLogout: () => Promise<void>;
}

export const AdminAuthScaffoldCard: React.FC<AdminAuthScaffoldCardProps> = ({
  session,
  onLogout,
}) => {
  const isEnforced = session.enforcementMode === 'enforced';

  return (
    <section
      aria-labelledby="auth-scaffold-heading"
      className="rounded-xl border border-slate-200 bg-white p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
            <ShieldCheck className="h-5 w-5 text-slate-800" aria-hidden="true" />
          </div>
          <div>
            <h2 id="auth-scaffold-heading" className="text-lg font-semibold text-slate-900">
              Identity, RBAC &amp; Admin Isolation Scaffold (ADR 008)
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              End-user camera &amp; demo screens contain zero links to <code className="font-mono text-xs text-slate-800">/admin</code>. Server-side role checks are wired and ready for login rollout.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold ${
              isEnforced
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-amber-200 bg-amber-50 text-amber-900'
            }`}
          >
            Mode: {isEnforced ? 'Enforced RBAC' : 'Scaffold (Pre-Rollout)'}
          </div>

          {session.authenticated && session.principal && (
            <button
              type="button"
              onClick={() => void onLogout()}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              Sign Out ({session.principal.email})
            </button>
          )}
        </div>
      </div>

      {/* 3-Column Security Boundary Summary */}
      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold text-slate-900">End-User Surface Isolation</p>
          <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
            The main PWA logo (<code className="font-mono text-[11px]">BrandMark</code>) is strictly non-interactive on <code className="font-mono text-[11px]">DemoMode</code> and <code className="font-mono text-[11px]">LiveCameraView</code>, and <code className="font-mono text-[11px]">?admin=1</code> redirects are disabled. Operators navigate directly to <code className="font-mono text-[11px]">/admin</code>.
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold text-slate-900">Dual-Audience Account Schema</p>
          <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
            PostgreSQL <code className="font-mono text-[11px]">app_users</code> &amp; <code className="font-mono text-[11px]">auth_sessions</code> tables in <code className="font-mono text-[11px]">database/migrations/002_auth_and_rbac.sql</code> support <code className="font-mono text-[11px]">end_user</code>, <code className="font-mono text-[11px]">technician</code>, <code className="font-mono text-[11px]">admin</code>, and <code className="font-mono text-[11px]">super_admin</code> roles with salted <code className="font-mono text-[11px]">scrypt</code> hashes or OIDC / Firebase Auth.
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold text-slate-900">In-Memory Bearer Session Boundary</p>
          <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
            Tokens are signed server-side via HMAC-SHA256 and held strictly in React memory (<code className="font-mono text-[11px]">authContext.tsx</code>)—never stored in <code className="font-mono text-[11px]">localStorage</code>. Flip <code className="font-mono text-[11px]">AUTH_ENFORCEMENT_MODE=enforced</code> when accounts are seeded.
          </p>
        </div>
      </div>

      {/* RBAC Route Policy Matrix */}
      <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-semibold">Method</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Route</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Audience</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Minimum Role</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Protected Capability</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {ROUTE_ACCESS_POLICIES.map((policy) => (
              <tr key={`${policy.method}-${policy.path}`} className="hover:bg-slate-50">
                <td className="px-4 py-2 font-mono font-semibold text-slate-900">
                  {policy.method}
                </td>
                <td className="px-4 py-2 font-mono text-slate-800">{policy.path}</td>
                <td className="px-4 py-2 capitalize text-slate-700">
                  {policy.audience.replace('_', ' ')}
                </td>
                <td className="px-4 py-2 font-mono text-slate-700">{policy.minimumRole}</td>
                <td className="px-4 py-2 text-slate-600">{policy.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

interface AdminLoginGateProps {
  onLogin: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  onOpenCamera: () => void;
}

/**
 * Rendered automatically on `/admin` whenever `AUTH_ENFORCEMENT_MODE=enforced` is enabled
 * and the operator has not yet signed in with an `admin` or `super_admin` account.
 */
export const AdminLoginGate: React.FC<AdminLoginGateProps> = ({
  onLogin,
  onOpenCamera,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSubmitting(true);
    try {
      const result = await onLogin(email, password);
      if (!result.ok) {
        setErrorMessage(result.error || 'Unable to sign in. Check your admin credentials.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh w-full bg-[#F7F8FA] flex items-center justify-center px-4 py-10 text-slate-900">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="flex items-center gap-3">
          <img
            src={JACK_OF_SPADES_LOGO_URL}
            alt="Jack of All Trades logo"
            referrerPolicy="no-referrer"
            className="h-11 w-[33px] rounded-[5px] border border-slate-300 object-cover"
          />
          <div>
            <p className="text-xs font-medium text-slate-500">Admin &amp; Operations Platform</p>
            <h1 className="text-xl font-bold tracking-tight text-slate-950">Operator Sign-In</h1>
          </div>
        </div>

        <p className="mt-4 text-sm text-slate-600 leading-relaxed">
          Role-based access control is enforced for this workspace. Sign in with an authorized administrator account to inspect Cloud SQL status, Ontology data, and runbooks.
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-6 space-y-4">
          <div>
            <label htmlFor="admin-email" className="block text-xs font-semibold text-slate-700">
              Admin Email
            </label>
            <input
              id="admin-email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@example.com"
              className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="admin-password" className="block text-xs font-semibold text-slate-700">
              Password
            </label>
            <input
              id="admin-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800"
            >
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 transition-colors cursor-pointer"
          >
            {submitting ? (
              <>
                <KeyRound className="h-4 w-4 animate-pulse" aria-hidden="true" />
                Verifying Credentials...
              </>
            ) : (
              <>
                <Lock className="h-4 w-4" aria-hidden="true" />
                Sign In to Admin Platform
              </>
            )}
          </button>
        </form>

        <div className="mt-5 border-t border-slate-100 pt-4 text-center">
          <button
            type="button"
            onClick={onOpenCamera}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 underline underline-offset-2 cursor-pointer"
          >
            Return to End-User Repair App
          </button>
        </div>
      </div>
    </div>
  );
};
