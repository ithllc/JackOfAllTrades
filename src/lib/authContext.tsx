/**
 * Jack of All Trades — In-Memory Authentication & RBAC React Context (Scaffold)
 * License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
 *
 * Security Invariant (ADR 008):
 *  - Holds any active `Authorization: Bearer` token strictly in React memory (`useRef` / `useState`).
 *  - NEVER reads or writes authentication tokens to `localStorage` or `sessionStorage`.
 *  - Exposes `authFetch()` so End-User and Admin requests automatically attach the Bearer token
 *    when a user or operator signs in.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { AuthSessionState } from './authScaffold';

export interface LoginResult {
  ok: boolean;
  code?: string;
  error?: string;
}

interface AuthContextValue {
  session: AuthSessionState;
  loading: boolean;
  hasActiveToken: boolean;
  refreshSession: () => Promise<void>;
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

const DEFAULT_SESSION: AuthSessionState = {
  authenticated: false,
  enforcementMode: 'scaffold',
  principal: null,
  supportedProviders: ['email_password_scrypt', 'oidc_google', 'firebase_auth'],
};

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Strictly in-memory token store — never persisted to localStorage or sessionStorage
  const accessTokenRef = useRef<string | null>(null);
  const [hasActiveToken, setHasActiveToken] = useState(false);
  const [session, setSession] = useState<AuthSessionState>(DEFAULT_SESSION);
  const [loading, setLoading] = useState(true);

  const authFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers ?? undefined);
      const token = accessTokenRef.current;
      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      return fetch(input, {
        ...init,
        headers,
      });
    },
    []
  );

  const refreshSession = useCallback(async () => {
    try {
      const resp = await authFetch('/api/auth/session', {
        headers: { Accept: 'application/json' },
      });
      if (!resp.ok) {
        setSession((prev) => ({ ...prev, authenticated: false, principal: null }));
        return;
      }
      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return;
      const data = (await resp.json()) as Partial<AuthSessionState>;
      setSession({
        authenticated: Boolean(data.authenticated),
        enforcementMode: data.enforcementMode === 'enforced' ? 'enforced' : 'scaffold',
        principal: data.principal ?? null,
        supportedProviders: Array.isArray(data.supportedProviders)
          ? data.supportedProviders
          : DEFAULT_SESSION.supportedProviders,
      });
    } catch {
      // Keep default scaffold state if backend is unreachable
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      try {
        const resp = await fetch('/api/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ email: email.trim(), password }),
        });

        const payload = (await resp.json().catch(() => ({}))) as {
          token?: string;
          principal?: AuthSessionState['principal'];
          enforcementMode?: AuthSessionState['enforcementMode'];
          error?: string;
          code?: string;
        };

        if (!resp.ok || !payload.token) {
          return {
            ok: false,
            code: payload.code,
            error: payload.error || 'Sign-in failed. Please verify your credentials.',
          };
        }

        accessTokenRef.current = payload.token;
        setHasActiveToken(true);
        setSession((prev) => ({
          ...prev,
          authenticated: true,
          enforcementMode: payload.enforcementMode ?? prev.enforcementMode,
          principal: payload.principal ?? prev.principal,
        }));
        return { ok: true };
      } catch {
        return {
          ok: false,
          error: 'Could not reach the authentication service. Please try again.',
        };
      }
    },
    []
  );

  const logout = useCallback(async () => {
    const currentToken = accessTokenRef.current;
    accessTokenRef.current = null;
    setHasActiveToken(false);
    setSession((prev) => ({
      ...prev,
      authenticated: false,
      principal: null,
    }));

    if (currentToken) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${currentToken}`,
            Accept: 'application/json',
          },
        });
      } catch {
        // Best-effort server-side revocation
      }
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      hasActiveToken,
      refreshSession,
      login,
      logout,
      authFetch,
    }),
    [session, loading, hasActiveToken, refreshSession, login, logout, authFetch]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }
  return ctx;
}
