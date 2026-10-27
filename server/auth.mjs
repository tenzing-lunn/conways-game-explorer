import { Pool } from 'pg';
import { betterAuth } from 'better-auth';
import { toNodeHandler } from 'better-auth/node';
import { dash } from '@better-auth/infra';
import { cleanDisplayName, cleanProfileUrl } from './profile-fields.mjs';

// Sign-up accepts any `name`/`image`; bound them before they become a
// profile display name or avatar.
function boundAuthUser(user) {
  const data = {};
  if (user?.name !== undefined) data.name = cleanDisplayName(user.name) || 'Member';
  if (user?.image !== undefined && user.image !== null) data.image = cleanProfileUrl(user.image) || null;
  return { data };
}

export function getDatabaseConnectionString(env = process.env) {
  return env.DATABASE_URL || env.HYPERDRIVE?.connectionString || null;
}

export function createPostgresPool({ env = process.env } = {}) {
  const connectionString = getDatabaseConnectionString(env);
  if (!connectionString) return null;

  const pool = new Pool({
    connectionString,
    max: Number(env.DATABASE_POOL_MAX || 5),
    idleTimeoutMillis: Number(env.DATABASE_IDLE_TIMEOUT_MS || 30_000),
    // Keep Better Auth's custom table names in public. Passing a search_path
    // via PostgreSQL startup options is rejected by Neon pooler endpoints and
    // is unnecessary when every application query is fully qualified.
  });

  pool.on('error', (error) => {
    console.error('PostgreSQL pool error:', error.message);
  });

  return pool;
}

export function createBetterAuth({
  env = process.env,
  database = createPostgresPool({ env }),
} = {}) {
  if (!database) return null;

  if (!env.BETTER_AUTH_SECRET) {
    throw new Error('Better Auth is configured but BETTER_AUTH_SECRET is missing.');
  }

  const baseURL = env.BETTER_AUTH_URL
    || `http://${env.HOST || '127.0.0.1'}:${env.PORT || '5173'}`;
  const trustedOrigins = [
    baseURL,
    ...(env.BETTER_AUTH_TRUSTED_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  ];

  const plugins = [];

  // Dash is intentionally opt-in: the API key stays in the server runtime
  // (a Cloudflare secret in production) and is never part of browser config.
  if (env.BETTER_AUTH_API_KEY) {
    plugins.push(dash({
      apiKey: env.BETTER_AUTH_API_KEY,
      apiUrl: env.BETTER_AUTH_API_URL,
      kvUrl: env.BETTER_AUTH_KV_URL,
    }));
  }

  return betterAuth({
    appName: "Conway's Game of Life",
    database,
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    trustedOrigins,
    // Passwords are hashed by Better Auth with scrypt and live only in the
    // auth_accounts table. We deliberately do not enable verification or
    // password-reset endpoints: both require a transactional email sender.
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    // Enabled explicitly: Better Auth's default reads NODE_ENV from
    // process.env at import time, which the Worker never sets. Memory storage
    // is per isolate; the Worker's Cloudflare rate-limit binding is the
    // cross-isolate guard in front of it.
    rateLimit: {
      enabled: true,
      storage: 'memory',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/*': { window: 60, max: 10 },
        '/sign-up/*': { window: 3600, max: 10 },
      },
    },
    advanced: {
      // Cloudflare sets this header at the edge; retain the usual proxy header
      // as a local-development fallback for Better Auth's rate limiter.
      ipAddress: {
        ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'],
      },
    },
    databaseHooks: {
      user: {
        create: { before: async (user) => boundAuthUser(user) },
        update: { before: async (user) => boundAuthUser(user) },
      },
    },
    user: {
      deleteUser: { enabled: true },
      modelName: 'auth_users',
      fields: {
        emailVerified: 'email_verified',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    session: {
      modelName: 'auth_sessions',
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
      },
    },
    account: {
      modelName: 'auth_accounts',
      fields: {
        accountId: 'account_id',
        providerId: 'provider_id',
        userId: 'user_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      modelName: 'auth_verifications',
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    plugins,
  });
}

export function createBetterAuthHandler(options = {}) {
  const auth = createBetterAuth(options);
  return auth ? toNodeHandler(auth) : null;
}
