import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SQL_CONNECTION_NAME,
  DEFAULT_SQL_OUTGOING_IP,
  DEFAULT_SQL_PORT,
  DEFAULT_SQL_PUBLIC_IP,
  resolveCloudSqlPoolConfig,
} from './dbConfig.ts';

test('returns unconfigured pool when SQL_DB_NAME or SQL_USER are omitted', () => {
  const result = resolveCloudSqlPoolConfig({});
  assert.equal(result.poolConfig, null);
  assert.equal(result.transport, 'unconfigured');
  assert.equal(result.connectionName, DEFAULT_SQL_CONNECTION_NAME);
  assert.equal(result.publicIp, DEFAULT_SQL_PUBLIC_IP);
  assert.equal(result.outgoingIp, DEFAULT_SQL_OUTGOING_IP);
  assert.equal(result.port, DEFAULT_SQL_PORT);
});

test('ignores placeholder password values so sandbox safely falls back', () => {
  const result = resolveCloudSqlPoolConfig({
    SQL_DB_NAME: 'jackofalltrades',
    SQL_USER: 'joat_app',
    SQL_PASSWORD: 'CHANGE_ME_IN_SECRET_MANAGER',
  });
  assert.equal(result.poolConfig, null);
  assert.equal(result.transport, 'unconfigured');
});

test('selects Cloud SQL Auth Proxy Unix socket on Cloud Run when socket is mounted, with ssl=false', () => {
  const result = resolveCloudSqlPoolConfig(
    {
      K_SERVICE: 'jackofalltrades',
      SQL_DB_NAME: 'jackofalltrades',
      SQL_USER: 'joat_app',
      SQL_PASSWORD: 'test-runtime-value',
      SQL_Connection_Name: 'gemini4nyc26nyc-2273:us-east1:free-trial-first-project',
      SQL_PORT: '5432',
      SQL_SSL: 'true',
    },
    { socketExists: () => true }
  );

  assert.equal(result.transport, 'cloud_sql_socket');
  assert.equal(result.sslEnabled, false);
  assert.ok(result.poolConfig);
  assert.equal(
    result.poolConfig.host,
    '/cloudsql/gemini4nyc26nyc-2273:us-east1:free-trial-first-project'
  );
  assert.equal(result.poolConfig.port, undefined);
  assert.equal(result.poolConfig.ssl, false);
});

test('falls back to Public IP TLS when K_SERVICE is set without a mounted /cloudsql socket', () => {
  const result = resolveCloudSqlPoolConfig(
    {
      K_SERVICE: 'preview-sandbox',
      SQL_DB_NAME: 'jackofalltrades',
      SQL_USER: 'joat_app',
      SQL_PASSWORD: 'test-runtime-value',
    },
    { socketExists: () => false }
  );

  assert.equal(result.transport, 'public_ip_tcp');
  assert.equal(result.sslEnabled, true);
  assert.equal(result.poolConfig?.host, DEFAULT_SQL_PUBLIC_IP);
  assert.equal(result.poolConfig?.port, 5432);
});

test('defaults to Public IP TCP on port 5432 with TLS enabled outside Cloud Run', () => {
  const result = resolveCloudSqlPoolConfig({
    SQL_DB_NAME: 'jackofalltrades',
    SQL_USER: 'joat_app',
    SQL_PASSWORD: 'test-runtime-value',
    SQL_PORT: '5432',
    SQL_PUBLIC_IP: '34.74.102.222',
  });

  assert.equal(result.transport, 'public_ip_tcp');
  assert.equal(result.sslEnabled, true);
  assert.ok(result.poolConfig);
  assert.equal(result.poolConfig.host, '34.74.102.222');
  assert.equal(result.poolConfig.port, 5432);
  assert.deepEqual(result.poolConfig.ssl, { rejectUnauthorized: false });
});

test('respects explicit SQL_SSL=false and strict SQL_SSL_CA overrides', () => {
  const noSsl = resolveCloudSqlPoolConfig({
    SQL_DB_NAME: 'jackofalltrades',
    SQL_USER: 'joat_app',
    SQL_PASSWORD: 'test-runtime-value',
    SQL_PUBLIC_IP: '34.74.102.222',
    SQL_SSL: 'false',
  });
  assert.equal(noSsl.sslEnabled, false);
  assert.equal(noSsl.poolConfig?.ssl, false);

  const strictCa = resolveCloudSqlPoolConfig({
    SQL_DB_NAME: 'jackofalltrades',
    SQL_USER: 'joat_app',
    SQL_PASSWORD: 'test-runtime-value',
    SQL_PUBLIC_IP: '34.74.102.222',
    SQL_SSL_CA: '-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----',
  });
  assert.equal(strictCa.sslEnabled, true);
  assert.deepEqual(strictCa.poolConfig?.ssl, {
    ca: '-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----',
    rejectUnauthorized: true,
  });
});

test('uses localhost without SSL by default when SQL_HOST=127.0.0.1', () => {
  const localProxy = resolveCloudSqlPoolConfig({
    SQL_HOST: '127.0.0.1',
    SQL_PORT: '5432',
    SQL_DB_NAME: 'jackofalltrades',
    SQL_USER: 'joat_app',
    SQL_PASSWORD: 'test-runtime-value',
  });
  assert.equal(localProxy.transport, 'custom_tcp');
  assert.equal(localProxy.sslEnabled, false);
  assert.equal(localProxy.poolConfig?.host, '127.0.0.1');
  assert.equal(localProxy.poolConfig?.port, 5432);
  assert.equal(localProxy.poolConfig?.ssl, false);
});

test('supports DB_USER, DB_PASS, DB_NAME, and DB_HOST aliases for Cloud Run Unix socket', () => {
  const result = resolveCloudSqlPoolConfig({
    DB_USER: 'postgres',
    DB_PASS: 'test-special-&^#@\\-value',
    DB_NAME: 'postgres',
    DB_HOST: '/cloudsql/gemini4nyc26nyc-2273:us-east1:free-trial-first-project',
  });
  assert.equal(result.transport, 'cloud_sql_socket');
  assert.equal(result.sslEnabled, false);
  assert.ok(result.poolConfig);
  assert.equal(
    result.poolConfig.host,
    '/cloudsql/gemini4nyc26nyc-2273:us-east1:free-trial-first-project'
  );
  assert.equal(result.poolConfig.user, 'postgres');
  assert.equal(result.poolConfig.database, 'postgres');
  assert.equal(result.poolConfig.password, 'test-special-&^#@\\-value');
  assert.equal(result.poolConfig.ssl, false);
});
