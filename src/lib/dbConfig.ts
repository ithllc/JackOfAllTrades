/**
 * JackOfAllTrades — Google Cloud SQL (PostgreSQL 16 + pgvector) Pool Configuration Resolver
 * License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
 *
 * Pure, testable configuration module supporting both:
 *  1. Google Cloud Run Auth Proxy Unix socket (`/cloudsql/<SQL_CONNECTION_NAME>`)
 *     — encrypted by Cloud SQL Auth Proxy, so pg `ssl` MUST be `false` and `port` omitted.
 *  2. Direct Public IP TCP (`SQL_PUBLIC_IP:SQL_PORT`) for external/local environments
 *     — defaults to TLS/SSL enabled for remote Cloud SQL connections unless `SQL_SSL=false`.
 *
 * Security: Credentials (`SQL_DB_NAME`, `SQL_USER`, `SQL_PASSWORD`) are strictly read
 * from environment variables / Secret Manager and are NEVER hardcoded.
 */

import fs from 'node:fs';
import type { PoolConfig } from 'pg';

export const DEFAULT_SQL_PORT = 5432;
export const DEFAULT_SQL_CONNECTION_NAME =
  'gemini4nyc26nyc-2273:us-east1:free-trial-first-project';
export const DEFAULT_SQL_PUBLIC_IP = '34.74.102.222';
export const DEFAULT_SQL_OUTGOING_IP = '34.73.184.213';

export type CloudSqlTransport =
  | 'cloud_sql_socket'
  | 'public_ip_tcp'
  | 'custom_tcp'
  | 'unconfigured';

export interface ResolvedCloudSqlConfig {
  poolConfig: PoolConfig | null;
  transport: CloudSqlTransport;
  connectionName: string;
  publicIp: string;
  outgoingIp: string;
  port: number;
  sslEnabled: boolean;
  /** Non-sensitive summary safe to expose in `/healthz` diagnostics */
  hostSummary: string;
}

export interface ResolveCloudSqlOptions {
  /** Override filesystem socket presence check for deterministic unit testing */
  socketExists?: (socketPath: string) => boolean;
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const PLACEHOLDER_SECRETS = new Set([
  'CHANGE_ME_IN_SECRET_MANAGER',
  'MY_SQL_PASSWORD',
  'REPLACE_ME',
]);

function parsePort(rawPort: string | undefined, fallback: number): number {
  if (!rawPort) return fallback;
  const parsed = Number.parseInt(rawPort.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}

export function resolveCloudSqlPoolConfig(
  env: Record<string, string | undefined>,
  options: ResolveCloudSqlOptions = {}
): ResolvedCloudSqlConfig {
  const connectionName = (
    env.SQL_CONNECTION_NAME ||
    env.SQL_Connection_Name ||
    DEFAULT_SQL_CONNECTION_NAME
  ).trim();
  const publicIp = (env.SQL_PUBLIC_IP || DEFAULT_SQL_PUBLIC_IP).trim();
  const outgoingIp = (
    env.SQL_OUTGOING_IP ||
    env.SQL_Outgoing_IP ||
    DEFAULT_SQL_OUTGOING_IP
  ).trim();
  const port = parsePort(env.SQL_PORT || env.DB_PORT, DEFAULT_SQL_PORT);

  const database = (env.SQL_DB_NAME || env.DB_NAME || '').trim();
  const user = (env.SQL_USER || env.DB_USER || '').trim();
  const password = env.SQL_PASSWORD ?? env.DB_PASS;

  const explicitHost = (env.SQL_HOST || env.DB_HOST || '').trim();
  const socketPath = `/cloudsql/${connectionName}`;
  const checkSocketExists = options.socketExists ?? ((p: string) => fs.existsSync(p));
  const useUnixSocket =
    env.SQL_USE_UNIX_SOCKET?.trim().toLowerCase() === 'true' ||
    (Boolean(env.K_SERVICE?.trim()) && checkSocketExists(socketPath));

  // Credentials gate: do not attempt connections when DB name/user are unset or placeholders
  if (!database || !user || (password && PLACEHOLDER_SECRETS.has(password.trim()))) {
    return {
      poolConfig: null,
      transport: 'unconfigured',
      connectionName,
      publicIp,
      outgoingIp,
      port,
      sslEnabled: false,
      hostSummary: useUnixSocket ? socketPath : `${publicIp}:${port}`,
    };
  }

  let host: string;
  let transport: CloudSqlTransport;

  if (explicitHost) {
    if (explicitHost.startsWith('/cloudsql/')) {
      // If running inside Cloud Run / preview without the /cloudsql socket mounted,
      // fall back cleanly to Cloud SQL Public IP TCP + TLS instead of failing on ENOENT.
      if (Boolean(env.K_SERVICE?.trim()) && !checkSocketExists(explicitHost)) {
        host = publicIp;
        transport = 'public_ip_tcp';
      } else {
        host = explicitHost;
        transport = 'cloud_sql_socket';
      }
    } else if (
      explicitHost.toLowerCase() === 'postgres' &&
      Boolean(env.K_SERVICE?.trim()) &&
      publicIp
    ) {
      // Avoid unresolvable Docker-Compose hostname "postgres" inside Cloud Run / preview sandboxes
      host = publicIp;
      transport = 'public_ip_tcp';
    } else if (explicitHost === publicIp) {
      host = explicitHost;
      transport = 'public_ip_tcp';
    } else {
      host = explicitHost;
      transport = 'custom_tcp';
    }
  } else if (useUnixSocket) {
    host = socketPath;
    transport = 'cloud_sql_socket';
  } else {
    host = publicIp;
    transport = 'public_ip_tcp';
  }

  // Cloud SQL Auth Proxy Unix sockets are already encrypted; pg must disable TCP TLS.
  if (transport === 'cloud_sql_socket') {
    return {
      poolConfig: {
        host,
        database,
        user,
        password,
        max: 10,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
        ssl: false,
      },
      transport,
      connectionName,
      publicIp,
      outgoingIp,
      port,
      sslEnabled: false,
      hostSummary: host,
    };
  }

  // TCP SSL resolution:
  //  - If SQL_SSL_CA is provided, enforce strict CA validation.
  //  - If SQL_SSL === 'false', disable TLS explicitly.
  //  - If SQL_SSL === 'true' OR connecting over a non-localhost IP (e.g., Public IP 34.74.102.222), enable TLS.
  const sslCa = (env.SQL_SSL_CA || env.DB_SSL_CA || '').trim();
  const sslFlag = (env.SQL_SSL ?? env.DB_SSL)?.trim().toLowerCase();
  const isLocalHost = LOCAL_HOSTS.has(host.toLowerCase());

  let ssl: PoolConfig['ssl'] = false;
  if (sslCa) {
    ssl = { ca: sslCa, rejectUnauthorized: true };
  } else if (sslFlag === 'false') {
    ssl = false;
  } else if (sslFlag === 'true' || !isLocalHost) {
    ssl = { rejectUnauthorized: false };
  }

  return {
    poolConfig: {
      host,
      port,
      database,
      user,
      password,
      max: 10,
      connectionTimeoutMillis: 4000,
      idleTimeoutMillis: 30000,
      ssl,
    },
    transport,
    connectionName,
    publicIp,
    outgoingIp,
    port,
    sslEnabled: Boolean(ssl),
    hostSummary: `${host}:${port}`,
  };
}
