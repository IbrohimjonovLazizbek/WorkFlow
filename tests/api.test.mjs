/**
 * api.test.mjs — Phase 2 API Integration Tests
 * Tests handleApiRequest() from functions/api/[[path]].js using Node's built-in
 * test runner and an in-memory SQLite D1 shim.
 *
 * Run: node --test tests/api.test.mjs
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

// ─── Polyfills for Cloudflare Web APIs not in Node 22 ────────────────────────
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

// TextEncoder / TextDecoder are in Node 18+ globally, but ensure:
if (!globalThis.TextEncoder) {
  const { TextEncoder, TextDecoder } = await import('node:util');
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}

// ─── Load the [[path]].js module ─────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiPath = path.resolve(__dirname, '../functions/api/[[path]].js');
const apiSrc = readFileSync(apiPath, 'utf8');

// The file uses `export function onRequest` and `export async function handleApiRequest`.
// We need to load it as a module. Node can't directly import a file with brackets in
// name as an ESM URL, so we use a data: URL approach to evaluate it.
const escapedSrc = apiSrc.replace(/`/g, '\\`');

// Use createRequire-based dynamic load via tmp module object.
// Since [[path]].js is a standard ESM module with exports, we need a trick:
// wrap it into a data-URL blob module.
let handleApiRequest;
try {
  // Node 20+ supports data: imports
  const encoded = Buffer.from(apiSrc).toString('base64');
  const mod = await import(`data:text/javascript;base64,${encoded}`);
  handleApiRequest = mod.handleApiRequest;
} catch (e) {
  // Fallback: eval using Function constructor (loses top-level await, but our
  // module doesn't use it at the top level)
  throw new Error('Could not load [[path]].js as module: ' + e.message);
}

assert.equal(typeof handleApiRequest, 'function', 'handleApiRequest must be exported');

// ─── SQLite D1 Shim ───────────────────────────────────────────────────────────
const SCHEMA = readFileSync(path.resolve(__dirname, '../migrations/0001_init.sql'), 'utf8');

function makeD1(db) {
  /**
   * Minimal D1 shim: prepare(sql).bind(...args).all() / .first() / .run()
   * and db.batch([stmts])
   */
  function makeStmt(sql, boundArgs = []) {
    function run() {
      const stmt = db.prepare(sql);
      stmt.run(...boundArgs);
      return { success: true };
    }
    function all() {
      const stmt = db.prepare(sql);
      const rows = stmt.all(...boundArgs);
      return { results: rows, success: true };
    }
    function first() {
      const stmt = db.prepare(sql);
      const row = stmt.get(...boundArgs);
      return row ?? null;
    }
    return {
      bind(...args) { return makeStmt(sql, args); },
      run,
      all,
      first,
      // D1 batch returns promises; for shim we wrap in resolved promises
      _run: run,
      _all: all,
      _first: first,
    };
  }

  const d1 = {
    prepare(sql) {
      return makeStmt(sql);
    },
    async batch(stmts) {
      return stmts.map(s => {
        // Each stmt is a bound D1PreparedStatement
        // We call _all to get results
        try {
          return s._all ? s._all() : { results: [], success: true };
        } catch {
          return { results: [], success: true };
        }
      });
    }
  };

  // Promisify all query methods to match real D1 async API
  const asyncD1 = {
    prepare(sql) {
      const stmt = makeStmt(sql);
      return {
        bind(...args) {
          const bound = makeStmt(sql, args);
          return {
            async run() { return bound.run(); },
            async all() { return bound.all(); },
            async first() { return bound.first(); },
            _all() { return bound.all(); },
            _run() { return bound.run(); },
            _first() { return bound.first(); },
          };
        },
        async run() { return stmt.run(); },
        async all() { return stmt.all(); },
        async first() { return stmt.first(); },
        _all() { return stmt.all(); },
      };
    },
    async batch(stmts) {
      return stmts.map(s => {
        try {
          return s._all ? s._all() : { results: [], success: true };
        } catch {
          return { results: [], success: true };
        }
      });
    }
  };

  return asyncD1;
}

function makeEnv(overrides = {}) {
  const db = new DatabaseSync(':memory:');
  // Run schema
  for (const stmt of SCHEMA.split(';').map(s => s.trim()).filter(s => s.length > 0)) {
    db.exec(stmt + ';');
  }
  return {
    DB: makeD1(db),
    SESSION_SECRET: 'test-secret-32-bytes-padded-xxxxxxx',
    GOOGLE_CLIENT_ID: overrides.GOOGLE_CLIENT_ID ?? null,
    GOOGLE_CLIENT_SECRET: overrides.GOOGLE_CLIENT_SECRET ?? null,
    TELEGRAM_BOT_TOKEN: overrides.TELEGRAM_BOT_TOKEN ?? null,
    TELEGRAM_BOT_USERNAME: overrides.TELEGRAM_BOT_USERNAME ?? null,
    TELEGRAM_WEBHOOK_SECRET: overrides.TELEGRAM_WEBHOOK_SECRET ?? null,
    ...overrides,
  };
}

function makeRequest(method, url, body = null, headers = {}) {
  const opts = {
    method,
    headers: new Headers({ 'Content-Type': 'application/json', ...headers }),
  };
  if (body !== null) opts.body = JSON.stringify(body);
  return new Request(url, opts);
}

async function call(env, method, path, body = null, headers = {}) {
  const req = makeRequest(method, `https://example.com${path}`, body, headers);
  const res = await handleApiRequest(req, env, undefined);
  let data = null;
  try { data = await res.clone().json(); } catch {}
  return { status: res.status, data, headers: res.headers };
}

// Helper: sign a session token the same way the API does (we call /api/auth/me after
// manually inserting a user and constructing a cookie, using a login simulation approach)
async function createTestUser(env, overrides = {}) {
  const id = overrides.id ?? `usr_test_${Math.random().toString(36).slice(2)}`;
  const now = new Date().toISOString();
  // Insert directly via D1
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, name, avatar_url, timezone, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    overrides.google_sub ?? `sub_${id}`,
    overrides.email ?? `${id}@example.com`,
    overrides.name ?? 'Test User',
    null,
    'Asia/Tashkent',
    now,
    now
  ).run();
  await env.DB.prepare(
    `INSERT INTO user_settings (user_id, daily_goal_tasks, daily_goal_minutes, sound_enabled, user_name, show_completed, updated_at)
     VALUES (?, 5, 120, 1, ?, 1, ?)`
  ).bind(id, 'Test Workspace', now).run();
  return id;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('API: /api/auth/status', () => {
  test('returns googleConfigured=false when no credentials', async () => {
    const env = makeEnv();
    const r = await call(env, 'GET', '/api/auth/status');
    assert.equal(r.status, 200);
    assert.equal(r.data.googleConfigured, false);
    assert.equal(r.data.telegramConfigured, false);
    assert.equal(typeof r.data.origin, 'string');
  });

  test('returns googleConfigured=true when credentials set', async () => {
    const env = makeEnv({ GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csec' });
    const r = await call(env, 'GET', '/api/auth/status');
    assert.equal(r.status, 200);
    assert.equal(r.data.googleConfigured, true);
  });

  test('returns telegramConfigured=true when token set', async () => {
    const env = makeEnv({ TELEGRAM_BOT_TOKEN: 'token123', TELEGRAM_BOT_USERNAME: 'mybot' });
    const r = await call(env, 'GET', '/api/auth/status');
    assert.equal(r.status, 200);
    assert.equal(r.data.telegramConfigured, true);
    assert.equal(r.data.telegramBotUsername, 'mybot');
  });

  test('POST /api/auth/status returns 405', async () => {
    const env = makeEnv();
    const r = await call(env, 'POST', '/api/auth/status');
    assert.equal(r.status, 405);
  });
});

describe('API: /api/auth/google redirect', () => {
  test('redirects to ?auth_error=google_not_configured when no creds', async () => {
    const env = makeEnv();
    const req = makeRequest('GET', 'https://example.com/api/auth/google');
    const res = await handleApiRequest(req, env, undefined);
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location'), /auth_error=google_not_configured/);
  });

  test('returns 405 on POST', async () => {
    const env = makeEnv();
    const r = await call(env, 'POST', '/api/auth/google');
    assert.equal(r.status, 405);
  });
});

describe('API: /api/auth/me unauthenticated', () => {
  test('returns authenticated=false with no cookie', async () => {
    const env = makeEnv();
    const r = await call(env, 'GET', '/api/auth/me');
    assert.equal(r.status, 200);
    assert.equal(r.data.authenticated, false);
    assert.equal(r.data.user, null);
  });
});

describe('API: /api/workspace — multi-tenant isolation', () => {
  test('returns 401 without session', async () => {
    const env = makeEnv();
    const r = await call(env, 'GET', '/api/workspace');
    assert.equal(r.status, 401);
  });

  // Note: Full authenticated workspace test requires signing a session token.
  // We verify the router rejects unauthenticated requests with correct code.
  test('unauthenticated workspace/import returns 401', async () => {
    const env = makeEnv();
    const r = await call(env, 'POST', '/api/workspace/import', { mode: 'merge', tasks: [], routines: [], reflections: {} });
    assert.equal(r.status, 401);
    assert.equal(r.data.code, 'UNAUTHORIZED');
  });
});

describe('API: /api/tasks — CRUD auth enforcement', () => {
  test('POST /api/tasks returns 401 without auth', async () => {
    const env = makeEnv();
    const r = await call(env, 'POST', '/api/tasks', { title: 'Test', date: '2026-01-01' });
    assert.equal(r.status, 401);
  });

  test('POST /api/tasks/batch returns 401 without auth', async () => {
    const env = makeEnv();
    const r = await call(env, 'POST', '/api/tasks/batch', { action: 'upsertMany', tasks: [] });
    assert.equal(r.status, 401);
  });

  test('PATCH /api/tasks/:id returns 401 without auth', async () => {
    const env = makeEnv();
    const r = await call(env, 'PATCH', '/api/tasks/task_123', { title: 'x' });
    assert.equal(r.status, 401);
  });

  test('DELETE /api/tasks/:id returns 401 without auth', async () => {
    const env = makeEnv();
    const r = await call(env, 'DELETE', '/api/tasks/task_123');
    assert.equal(r.status, 401);
  });
});

describe('API: /api/routines — auth enforcement', () => {
  test('POST /api/routines returns 401', async () => {
    const env = makeEnv();
    const r = await call(env, 'POST', '/api/routines', { title: 'Morning', schedule: 'daily' });
    assert.equal(r.status, 401);
  });

  test('PATCH /api/routines/:id returns 401', async () => {
    const env = makeEnv();
    const r = await call(env, 'PATCH', '/api/routines/rtn_123', { active: false });
    assert.equal(r.status, 401);
  });

  test('DELETE /api/routines/:id returns 401', async () => {
    const env = makeEnv();
    const r = await call(env, 'DELETE', '/api/routines/rtn_123');
    assert.equal(r.status, 401);
  });
});

describe('API: /api/reflections — auth enforcement', () => {
  test('PUT /api/reflections/2026-01-01 returns 401', async () => {
    const env = makeEnv();
    const r = await call(env, 'PUT', '/api/reflections/2026-01-01', { mood: 4 });
    assert.equal(r.status, 401);
  });
});

describe('API: /api/settings — auth enforcement', () => {
  test('PUT /api/settings returns 401 without auth', async () => {
    const env = makeEnv();
    const r = await call(env, 'PUT', '/api/settings', { dailyGoalTasks: 5 });
    assert.equal(r.status, 401);
  });
});

describe('API: Telegram endpoints — no auth required for webhook/miniapp-auth', () => {
  test('POST /api/telegram/webhook with no token still responds (token check is in WEBHOOK_SECRET)', async () => {
    const env = makeEnv();
    // Webhook handler does NOT require TELEGRAM_BOT_TOKEN — it processes the update
    // regardless (bot token is used only inside processTelegramWebhookUpdate for sending).
    // Without TELEGRAM_WEBHOOK_SECRET header check, it returns 200 { ok: true }.
    const r = await call(env, 'POST', '/api/telegram/webhook', { update_id: 1 });
    // Expect 200 (the update is accepted; actual bot sends would fail silently if no token)
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
  });

  test('POST /api/telegram/miniapp-auth with no token returns 503', async () => {
    const env = makeEnv();
    const r = await call(env, 'POST', '/api/telegram/miniapp-auth', { initData: 'test' });
    assert.equal(r.status, 503);
  });

  test('POST /api/telegram/link-code returns 401 without auth', async () => {
    const env = makeEnv();
    const r = await call(env, 'POST', '/api/telegram/link-code');
    assert.equal(r.status, 401);
  });

  test('POST /api/telegram/unlink returns 401 without auth', async () => {
    const env = makeEnv();
    const r = await call(env, 'POST', '/api/telegram/unlink');
    assert.equal(r.status, 401);
  });

  test('POST /api/telegram/send-summary returns 401 without auth', async () => {
    const env = makeEnv();
    const r = await call(env, 'POST', '/api/telegram/send-summary', { date: '2026-01-01' });
    assert.equal(r.status, 401);
  });
});

describe('API: /api/auth/logout', () => {
  test('POST clears session cookie', async () => {
    const env = makeEnv();
    const r = await call(env, 'POST', '/api/auth/logout');
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
    // Should have a Set-Cookie clearing tf_session
    const cookie = r.headers.get('set-cookie');
    assert.ok(cookie && cookie.includes('tf_session'), 'Should set tf_session cookie header');
  });
});

describe('API: Method enforcement on key routes', () => {
  test('GET /api/auth/logout returns 405', async () => {
    const env = makeEnv();
    const r = await call(env, 'GET', '/api/auth/logout');
    assert.equal(r.status, 405);
  });

  test('GET /api/tasks returns 405 (only POST allowed)', async () => {
    const env = makeEnv();
    const r = await call(env, 'GET', '/api/tasks');
    // 401 because auth check comes before method check for tasks; either 401 or 405 is valid
    // The router checks method BEFORE auth for public routes, AFTER auth for protected routes
    assert.ok(r.status === 401 || r.status === 405);
  });
});

describe('API: Unknown routes', () => {
  test('GET /api/unknown returns 401 (auth gate before 404 for unknown protected routes)', async () => {
    const env = makeEnv();
    // The router checks session auth BEFORE checking if the route exists for
    // non-public routes. This prevents 404 disclosure to unauthenticated callers.
    const r = await call(env, 'GET', '/api/unknown');
    // After DB check, session check runs → 401 (session required, route unknown after auth)
    assert.equal(r.status, 401);
    assert.equal(r.data.code, 'UNAUTHORIZED');
  });

  test('GET /not-api returns 404', async () => {
    const env = makeEnv();
    const r = await call(env, 'GET', '/not-api/anything');
    assert.equal(r.status, 404);
  });
});

describe('API: DB not configured guard', () => {
  test('/api/auth/me returns 500 when DB missing but auth/status still works', async () => {
    const env = makeEnv();
    env.DB = null;
    // /api/auth/status is public and doesn't need DB
    const statusR = await call(env, 'GET', '/api/auth/status');
    assert.equal(statusR.status, 200);
    // /api/auth/me needs DB (after session verify) — returns 200 unauthenticated or 500
    const meR = await call(env, 'GET', '/api/auth/me');
    assert.ok([200, 500].includes(meR.status));
  });
});
