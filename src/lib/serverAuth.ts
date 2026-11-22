/**
 * Jack of All Trades — Server-Side Authentication, Password Hashing & RBAC Middleware Scaffold
 * License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
 *
 * Node.js-only cryptographic & Express middleware scaffold (ADR 008):
 *  - HMAC-SHA256 stateless Bearer token signing & verification (`crypto.timingSafeEqual`)
 *  - Per-user salted `scrypt` password hashing & verification ready for Cloud SQL `app_users`
 *  - Ephemeral in-memory revocation list (replace with Cloud SQL `auth_sessions` lookup at rollout)
 *  - `requireAuth(minimumRole)` Express middleware enforcing RBAC cleanly when
 *    `AUTH_ENFORCEMENT_MODE=enforced`, while remaining non-blocking in `'scaffold'` mode.
 */

import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import {
  hasRequiredRole,
  normalizeUserRole,
  resolveAuthEnforcementMode,
  type AuthEnforcementMode,
  type AuthPrincipal,
  type AuthProviderId,
  type UserRole,
} from './authScaffold';

export interface AuthenticatedRequest extends Request {
  authPrincipal?: AuthPrincipal | null;
}

const DEFAULT_TOKEN_TTL_SEC = 60 * 60 * 8; // 8 hours

// Read signing secret from server environment, falling back to a process-local
// cryptographically secure 32-byte key so no static secret is ever hardcoded.
const PROCESS_FALLBACK_SECRET = crypto.randomBytes(32).toString('hex');

export function resolveSessionSigningSecret(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.AUTH_SESSION_SECRET?.trim();
  if (configured && configured.length >= 16) {
    return configured;
  }
  return PROCESS_FALLBACK_SECRET;
}

/**
 * Hashes a user password with Node's native `crypto.scryptSync` and a 16-byte random salt.
 * Output format: `scrypt$<saltHex>$<derivedKeyHex>`
 */
export function hashPasswordScrypt(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

/**
 * Verifies a plaintext password against a stored `scrypt$<salt>$<hash>` record
 * using constant-time comparison to prevent timing side-channels.
 */
export function verifyPasswordScrypt(password: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * Signs a compact URL-safe HMAC-SHA256 Bearer session token (`<payloadB64Url>.<sigB64Url>`).
 */
export function signSessionToken(
  input: {
    userId: string;
    email: string;
    displayName: string;
    role: UserRole;
    provider: AuthProviderId;
    ttlSeconds?: number;
  },
  secret: string = resolveSessionSigningSecret()
): { token: string; principal: AuthPrincipal } {
  const nowSec = Math.floor(Date.now() / 1000);
  const ttl = Math.max(60, input.ttlSeconds ?? DEFAULT_TOKEN_TTL_SEC);
  const principal: AuthPrincipal = {
    userId: input.userId,
    email: input.email,
    displayName: input.displayName,
    role: normalizeUserRole(input.role),
    provider: input.provider,
    issuedAt: nowSec,
    expiresAt: nowSec + ttl,
  };

  const payloadEncoded = Buffer.from(JSON.stringify(principal), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payloadEncoded)
    .digest('base64url');

  return {
    token: `${payloadEncoded}.${signature}`,
    principal,
  };
}

/**
 * Verifies an HMAC-SHA256 Bearer token's signature, structure, and expiration timestamp.
 */
export function verifySessionToken(
  token: string,
  secret: string = resolveSessionSigningSecret(),
  nowSec: number = Math.floor(Date.now() / 1000)
): AuthPrincipal | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadEncoded, providedSig] = parts;
  if (!payloadEncoded || !providedSig) return null;

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(payloadEncoded)
    .digest('base64url');

  const providedBuf = Buffer.from(providedSig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (providedBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString('utf8')) as Partial<AuthPrincipal>;
    if (
      typeof parsed.userId !== 'string' ||
      typeof parsed.email !== 'string' ||
      typeof parsed.expiresAt !== 'number' ||
      parsed.expiresAt <= nowSec
    ) {
      return null;
    }
    return {
      userId: parsed.userId,
      email: parsed.email,
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : parsed.email,
      role: normalizeUserRole(parsed.role),
      provider:
        parsed.provider === 'oidc_google' || parsed.provider === 'firebase_auth'
          ? parsed.provider
          : 'email_password_scrypt',
      issuedAt: typeof parsed.issuedAt === 'number' ? parsed.issuedAt : nowSec,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

/**
 * Extracts a Bearer token from the standard `Authorization` HTTP header.
 */
export function extractBearerToken(authHeader?: string | null): string | null {
  if (!authHeader || typeof authHeader !== 'string') return null;
  const match = authHeader.match(/^Bearer\s+([A-Za-z0-9._~+/=-]+)$/i);
  return match ? match[1] : null;
}

// Process-level token revocation cache (paired with Cloud SQL `auth_sessions` persistence)
const revokedTokenHashes = new Set<string>();

/**
 * Computes the hex SHA-256 digest of a Bearer session token for storage in `auth_sessions.token_sha256`.
 */
export function hashSessionTokenSha256(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function revokeSessionToken(token: string): void {
  if (!token) return;
  revokedTokenHashes.add(hashSessionTokenSha256(token));
}

export function isTokenRevoked(token: string): boolean {
  if (!token) return false;
  return revokedTokenHashes.has(hashSessionTokenSha256(token));
}

/**
 * Express middleware factory enforcing Role-Based Access Control (RBAC).
 * - In `'scaffold'` mode (default until login rollout): attaches any verified
 *   `req.authPrincipal` without blocking unauthenticated requests.
 * - In `'enforced'` mode: requires a valid, non-revoked Bearer token (`401`)
 *   whose role satisfies `minimumRole` (`403`).
 */
export function createRequireAuthMiddleware(
  minimumRole: UserRole,
  options?: {
    enforcementMode?: AuthEnforcementMode;
    secret?: string;
    isTokenRevokedInDb?: (tokenSha256: string) => Promise<boolean>;
  }
) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const mode =
      options?.enforcementMode ?? resolveAuthEnforcementMode(process.env.AUTH_ENFORCEMENT_MODE);
    const secret = options?.secret ?? resolveSessionSigningSecret();

    const bearer = extractBearerToken(req.headers.authorization);
    let principal =
      bearer && !isTokenRevoked(bearer) ? verifySessionToken(bearer, secret) : null;

    if (principal && bearer && options?.isTokenRevokedInDb) {
      try {
        const revokedInDb = await options.isTokenRevokedInDb(hashSessionTokenSha256(bearer));
        if (revokedInDb) {
          revokeSessionToken(bearer);
          principal = null;
        }
      } catch {
        // Non-fatal fallback if DB is temporarily unreachable; HMAC signature & expiry still apply
      }
    }

    req.authPrincipal = principal;

    if (mode === 'scaffold' || minimumRole === 'anonymous') {
      return next();
    }

    if (!principal) {
      return res.status(401).json({
        error: 'Authentication required. Provide a valid Authorization: Bearer token.',
        code: 'AUTH_REQUIRED',
        requiredRole: minimumRole,
      });
    }

    if (!hasRequiredRole(principal.role, minimumRole)) {
      return res.status(403).json({
        error: `Insufficient permissions. This endpoint requires "${minimumRole}" access.`,
        code: 'FORBIDDEN_ROLE',
        requiredRole: minimumRole,
        actualRole: principal.role,
      });
    }

    return next();
  };
}
