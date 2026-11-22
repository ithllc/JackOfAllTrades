import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getRoutePolicy,
  hasRequiredRole,
  normalizeUserRole,
  resolveAuthEnforcementMode,
  ROUTE_ACCESS_POLICIES,
} from './authScaffold';
import {
  createRequireAuthMiddleware,
  extractBearerToken,
  hashPasswordScrypt,
  isTokenRevoked,
  revokeSessionToken,
  signSessionToken,
  verifyPasswordScrypt,
  verifySessionToken,
  type AuthenticatedRequest,
} from './serverAuth';

test('RBAC role hierarchy enforces end_user < technician < admin < super_admin', () => {
  assert.equal(hasRequiredRole('anonymous', 'end_user'), false);
  assert.equal(hasRequiredRole('end_user', 'end_user'), true);
  assert.equal(hasRequiredRole('end_user', 'admin'), false);
  assert.equal(hasRequiredRole('admin', 'end_user'), true);
  assert.equal(hasRequiredRole('admin', 'admin'), true);
  assert.equal(hasRequiredRole('super_admin', 'admin'), true);
  assert.equal(normalizeUserRole('ADMIN'), 'admin');
  assert.equal(normalizeUserRole('unknown_role'), 'anonymous');
  assert.equal(resolveAuthEnforcementMode(undefined), 'scaffold');
  assert.equal(resolveAuthEnforcementMode('enforced'), 'enforced');
});

test('route access policy matrix separates end-user repair endpoints from admin-only endpoints', () => {
  assert.ok(ROUTE_ACCESS_POLICIES.length >= 10);
  assert.equal(getRoutePolicy('/api/analyze-buffer')?.audience, 'end_user');
  assert.equal(getRoutePolicy('/api/ontology/tree')?.audience, 'admin');
  assert.equal(getRoutePolicy('/api/deliverables')?.minimumRole, 'admin');
  assert.equal(getRoutePolicy('/api/health')?.audience, 'public');
});

test('scrypt password hashing verifies matching passwords and rejects wrong passwords', () => {
  const hashA = hashPasswordScrypt('WorkshopRepair#2026!');
  const hashB = hashPasswordScrypt('WorkshopRepair#2026!');
  assert.notEqual(hashA, hashB, 'Each password hash must use a unique random salt');
  assert.equal(verifyPasswordScrypt('WorkshopRepair#2026!', hashA), true);
  assert.equal(verifyPasswordScrypt('WrongPassword!', hashA), false);
  assert.equal(verifyPasswordScrypt('WorkshopRepair#2026!', 'invalid-format'), false);
});

test('HMAC-SHA256 session tokens verify cleanly and reject tampering, expiry, or revocation', () => {
  const testSecret = 'unit-test-signing-secret-32-bytes-minimum';
  const { token, principal } = signSessionToken(
    {
      userId: 'usr-001',
      email: 'operator@example.com',
      displayName: 'Lead Operator',
      role: 'admin',
      provider: 'email_password_scrypt',
      ttlSeconds: 300,
    },
    testSecret
  );

  assert.equal(extractBearerToken(`Bearer ${token}`), token);
  assert.equal(extractBearerToken('Basic abc123'), null);

  const verified = verifySessionToken(token, testSecret, principal.issuedAt + 10);
  assert.equal(verified?.userId, 'usr-001');
  assert.equal(verified?.role, 'admin');

  // Expired token rejected
  assert.equal(verifySessionToken(token, testSecret, principal.expiresAt + 5), null);

  // Tampered signature rejected
  assert.equal(verifySessionToken(`${token}tampered`, testSecret, principal.issuedAt + 10), null);

  // Wrong secret rejected
  assert.equal(verifySessionToken(token, 'different-secret-value-for-test', principal.issuedAt + 10), null);

  // Revocation tracked by SHA-256 digest
  assert.equal(isTokenRevoked(token), false);
  revokeSessionToken(token);
  assert.equal(isTokenRevoked(token), true);
});

test('requireAuth middleware allows requests in scaffold mode and enforces 401/403 in enforced mode', () => {
  const testSecret = 'middleware-unit-test-secret-key-12345';

  const mockResponse = () => {
    let statusCode = 200;
    let body: unknown = null;
    const res = {
      status(code: number) {
        statusCode = code;
        return res;
      },
      json(payload: unknown) {
        body = payload;
        return res;
      },
    };
    return { res, getStatus: () => statusCode, getBody: () => body };
  };

  // 1. Scaffold mode lets unauthenticated admin request proceed
  let nextCalled = false;
  const scaffoldMw = createRequireAuthMiddleware('admin', {
    enforcementMode: 'scaffold',
    secret: testSecret,
  });
  scaffoldMw({ headers: {} } as AuthenticatedRequest, mockResponse().res as never, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);

  // 2. Enforced mode returns 401 when missing Bearer token
  const enforcedAdminMw = createRequireAuthMiddleware('admin', {
    enforcementMode: 'enforced',
    secret: testSecret,
  });
  const unauthResp = mockResponse();
  let unauthNext = false;
  enforcedAdminMw({ headers: {} } as AuthenticatedRequest, unauthResp.res as never, () => {
    unauthNext = true;
  });
  assert.equal(unauthNext, false);
  assert.equal(unauthResp.getStatus(), 401);

  // 3. Enforced mode returns 403 when end_user attempts admin route
  const { token: endUserToken } = signSessionToken(
    {
      userId: 'usr-end-1',
      email: 'diy@example.com',
      displayName: 'DIY User',
      role: 'end_user',
      provider: 'email_password_scrypt',
    },
    testSecret
  );
  const forbiddenResp = mockResponse();
  let forbiddenNext = false;
  enforcedAdminMw(
    { headers: { authorization: `Bearer ${endUserToken}` } } as AuthenticatedRequest,
    forbiddenResp.res as never,
    () => {
      forbiddenNext = true;
    }
  );
  assert.equal(forbiddenNext, false);
  assert.equal(forbiddenResp.getStatus(), 403);

  // 4. Enforced mode allows admin token through and attaches authPrincipal
  const { token: adminToken } = signSessionToken(
    {
      userId: 'usr-admin-1',
      email: 'admin@example.com',
      displayName: 'Platform Admin',
      role: 'admin',
      provider: 'oidc_google',
    },
    testSecret
  );
  const adminReq = { headers: { authorization: `Bearer ${adminToken}` } } as AuthenticatedRequest;
  let adminNext = false;
  enforcedAdminMw(adminReq, mockResponse().res as never, () => {
    adminNext = true;
  });
  assert.equal(adminNext, true);
  assert.equal(adminReq.authPrincipal?.role, 'admin');
});
