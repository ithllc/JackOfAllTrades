/**
 * Jack of All Trades — Shared Authentication & RBAC Scaffold Contract
 * License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
 *
 * Browser-safe role definitions, permission hierarchy, and route policy map
 * shared between the React PWA, Admin Platform, and Express backend middleware.
 *
 * Security Invariants (ADR 008):
 *  - End-user views (`/` DemoMode & LiveCameraView) NEVER link to or embed `/admin`.
 *  - Client session tokens live strictly in React/JS memory (`Authorization: Bearer`),
 *    never in `localStorage` or `sessionStorage`.
 *  - Server-side `requireAuth()` middleware is the sole authority for access checks.
 */

export type UserRole = 'anonymous' | 'end_user' | 'technician' | 'admin' | 'super_admin';

export type AuthEnforcementMode = 'scaffold' | 'enforced';

export type AuthProviderId = 'email_password_scrypt' | 'oidc_google' | 'firebase_auth';

export interface AuthPrincipal {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
  provider: AuthProviderId;
  issuedAt: number;
  expiresAt: number;
}

export interface AuthSessionState {
  authenticated: boolean;
  enforcementMode: AuthEnforcementMode;
  principal: AuthPrincipal | null;
  supportedProviders: AuthProviderId[];
}

export interface RouteAccessPolicy {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  audience: 'public' | 'end_user' | 'admin';
  minimumRole: UserRole;
  description: string;
}

const ROLE_WEIGHT: Record<UserRole, number> = {
  anonymous: 0,
  end_user: 10,
  technician: 20,
  admin: 30,
  super_admin: 40,
};

/**
 * Returns true if `actualRole` satisfies `minimumRole` in the RBAC hierarchy.
 */
export function hasRequiredRole(actualRole: UserRole, minimumRole: UserRole): boolean {
  return ROLE_WEIGHT[actualRole] >= ROLE_WEIGHT[minimumRole];
}

/**
 * Normalizes untrusted role strings into a strict UserRole union.
 */
export function normalizeUserRole(raw?: string | null): UserRole {
  const cleaned = (raw || '').trim().toLowerCase();
  if (
    cleaned === 'end_user' ||
    cleaned === 'technician' ||
    cleaned === 'admin' ||
    cleaned === 'super_admin'
  ) {
    return cleaned;
  }
  return 'anonymous';
}

/**
 * Resolves the server enforcement mode from `AUTH_ENFORCEMENT_MODE`.
 * Defaults to `'scaffold'` until identity providers and user accounts are enabled.
 */
export function resolveAuthEnforcementMode(raw?: string | null): AuthEnforcementMode {
  return (raw || '').trim().toLowerCase() === 'enforced' ? 'enforced' : 'scaffold';
}

/**
 * Authoritative API route access policy matrix (ADR 008).
 * Used both by Express middleware enforcement and the Admin Platform Security panel.
 */
export const ROUTE_ACCESS_POLICIES: readonly RouteAccessPolicy[] = [
  {
    method: 'GET',
    path: '/api/health',
    audience: 'public',
    minimumRole: 'anonymous',
    description: 'Cloud Run liveness & readiness probe',
  },
  {
    method: 'GET',
    path: '/api/auth/session',
    audience: 'public',
    minimumRole: 'anonymous',
    description: 'Inspect current verified session principal and enforcement mode',
  },
  {
    method: 'POST',
    path: '/api/auth/login',
    audience: 'public',
    minimumRole: 'anonymous',
    description: 'Authenticate an end user or admin operator and issue a Bearer token',
  },
  {
    method: 'POST',
    path: '/api/auth/logout',
    audience: 'public',
    minimumRole: 'anonymous',
    description: 'Revoke the active Bearer session token',
  },
  {
    method: 'POST',
    path: '/api/analyze-buffer',
    audience: 'end_user',
    minimumRole: 'end_user',
    description: 'Scan Problem visual diagnosis, scale calibration & AR steps',
  },
  {
    method: 'POST',
    path: '/api/voice-assist',
    audience: 'end_user',
    minimumRole: 'end_user',
    description: 'Hold to Explain multilingual voice diagnosis & WAV synthesis',
  },
  {
    method: 'POST',
    path: '/api/generate-pip',
    audience: 'end_user',
    minimumRole: 'end_user',
    description: 'On-demand per-step PiP hand-motion video clip generation',
  },
  {
    method: 'POST',
    path: '/api/ontology/confirm-fix',
    audience: 'end_user',
    minimumRole: 'end_user',
    description: 'Confirm repair success and credit the self-learning ontology flywheel',
  },
  {
    method: 'POST',
    path: '/api/ontology/feedback',
    audience: 'end_user',
    minimumRole: 'end_user',
    description: 'Submit part/size corrections to refine Cloud SQL pgvector embeddings',
  },
  {
    method: 'GET',
    path: '/api/db/status',
    audience: 'admin',
    minimumRole: 'admin',
    description: 'Cloud SQL PostgreSQL connectivity and pgvector extension diagnostics',
  },
  {
    method: 'GET',
    path: '/api/ontology/tree',
    audience: 'admin',
    minimumRole: 'admin',
    description: 'Admin Ontology hierarchy inspection and B2B2C flywheel metrics',
  },
  {
    method: 'POST',
    path: '/api/ontology/search',
    audience: 'admin',
    minimumRole: 'admin',
    description: 'Admin Scale Anchor Guard & pgvector RAG search console',
  },
  {
    method: 'POST',
    path: '/api/ontology/deflection',
    audience: 'admin',
    minimumRole: 'admin',
    description: 'Manual B2B2C return-deflection ledger entry (Admin only)',
  },
  {
    method: 'GET',
    path: '/api/deliverables',
    audience: 'admin',
    minimumRole: 'admin',
    description: 'Admin source & runbook inspector (AGPL-3.0 Corresponding Source)',
  },
] as const;

export function getRoutePolicy(path: string): RouteAccessPolicy | undefined {
  return ROUTE_ACCESS_POLICIES.find((policy) => policy.path === path);
}
