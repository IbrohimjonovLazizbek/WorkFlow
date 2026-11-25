/**
 * api.test.mjs — Phase 2 Full Backend & Cron Integration Tests
 *
 * Tests handleApiRequest() from functions/api/[[path]].js AND runHourlyBriefings()
 * from cron-worker/src/index.js using Node's built-in test runner and an
 * accurate node:sqlite D1 shim (including batch, meta.changes, constraints).
 *
 * Run: node --test tests/api.test.mjs
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Load ESM modules cleanly via UTF-8 base64 data URL (avoids bracket glob quirks in [[path]].js)
const apiSrc = readFileSync(path.join(ROOT, 'functions/api/[[path]].js'), 'utf8');
const apiMod = await import(`data:text/javascript;base64,${Buffer.from(apiSrc, 'utf8').toString('base64')}`);
const { handleApiRequest } = apiMod;

const cronSrc = readFileSync(path.join(ROOT, 'cron-worker/src/index.js'), 'utf8');
const cronMod = await import(`data:text/javascript;base64,${Buffer.from(cronSrc, 'utf8').toString('base64')}`);
const { runHourlyBriefings, getLocalDateAndHour } = cronMod;
const cronWorker = cronMod.default;

assert.equal(typeof handleApiRequest, 'function');
assert.equal(typeof runHourlyBriefings, 'function');

const SCHEMA = readFileSync(path.join(ROOT, 'migrations/0001_init.sql'), 'utf8');

function createSqliteD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);

  function wrapStatement(sql, boundArgs = []) {
    return {
      bind(...args) {
        return wrapStatement(sql, args);
      },
      _executeAll() {
        const stmt = sqlite.prepare(sql);
        const trimmed = sql.trim().toUpperCase();
        if (trimmed.startsWith('SELECT') || trimmed.startsWith('WITH') || trimmed.includes('RETURNING')) {
          const rows = stmt.all(...boundArgs);
          return { results: rows, success: true, meta: { changes: 0 } };
        }
        const info = stmt.run(...boundArgs);
        return { results: [], success: true, meta: { changes: Number(info.changes || 0) } };
      },
      async run() {
        const stmt = sqlite.prepare(sql);
        const info = stmt.run(...boundArgs);
        return { success: true, results: [], meta: { changes: Number(info.changes || 0) } };
      },
      async all() {
        const stmt = sqlite.prepare(sql);
        const rows = stmt.all(...boundArgs);
        return { results: rows, success: true, meta: { changes: 0 } };
      },
      async first() {
        const stmt = sqlite.prepare(sql);
        const row = stmt.get(...boundArgs);
        return row ?? null;
      }
    };
  }

  return {
    sqlite,
    prepare(sql) {
      return wrapStatement(sql);
    },
    async batch(stmts) {
      sqlite.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) {
          out.push(s._executeAll());
        }
        sqlite.exec('COMMIT');
        return out;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    }
  };
}

function makeEnv(overrides = {}) {
  const db = createSqliteD1();
  return {
    DB: db,
    SESSION_SECRET: 'super-secret-key-for-taskflow-api-tests-2026',
    GOOGLE_CLIENT_ID: null,
    GOOGLE_CLIENT_SECRET: null,
    TELEGRAM_BOT_TOKEN: null,
    TELEGRAM_BOT_USERNAME: null,
    TELEGRAM_WEBHOOK_SECRET: null,
    ...overrides
  };
}

function parseSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  const raw = headers.get('set-cookie');
  return raw ? [raw] : [];
}

function extractCookieValue(setCookieHeaders, cookieName) {
  for (const header of setCookieHeaders) {
    const firstPart = header.split(';')[0];
    const eq = firstPart.indexOf('=');
    if (eq > 0 && firstPart.slice(0, eq).trim() === cookieName) {
      return decodeURIComponent(firstPart.slice(eq + 1).trim());
    }
  }
  return null;
}

async function signTestToken(payload, secret) {
  const enc = new TextEncoder();
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64));
  const sigB64 = Buffer.from(new Uint8Array(sig)).toString('base64url');
  return `${payloadB64}.${sigB64}`;
}

async function computeTelegramInitData(tgUserObj, botToken, authDateSec = Math.floor(Date.now() / 1000)) {
  const enc = new TextEncoder();
  const params = new URLSearchParams({
    auth_date: String(authDateSec),
    query_id: 'AAEAAAE',
    user: JSON.stringify(tgUserObj)
  });
  const entries = Array.from(params.entries()).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

  const webAppKey = await crypto.subtle.importKey(
    'raw',
    enc.encode('WebAppData'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const secretKey = await crypto.subtle.sign('HMAC', webAppKey, enc.encode(botToken));
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    secretKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', hmacKey, enc.encode(dataCheckString));
  const hashHex = Buffer.from(new Uint8Array(sig)).toString('hex');
  params.set('hash', hashHex);
  return params.toString();
}

async function seedUserWithCookie(env, { id, googleSub, email, name }) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, name, avatar_url, timezone, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'Asia/Tashkent', ?, ?)`
  ).bind(id, googleSub, email, name, 'https://example.com/a.png', now, now).run();
  await env.DB.prepare(
    `INSERT INTO user_settings (user_id, daily_goal_tasks, daily_goal_minutes, sound_enabled, user_name, show_completed, updated_at)
     VALUES (?, 5, 120, 1, ?, 1, ?)`
  ).bind(id, name, now).run();

  const token = await signTestToken(
    { typ: 'session', uid: id, exp: Date.now() + 3600 * 1000 },
    env.SESSION_SECRET
  );
  return `tf_session=${encodeURIComponent(token)}`;
}

async function call(env, method, reqPath, { body = null, headers = {}, origin = 'https://workflow.myclass.uz', ctx = undefined } = {}) {
  const reqHeaders = new Headers(headers);
  const opts = { method, headers: reqHeaders };
  if (body !== null) {
    if (!reqHeaders.has('Content-Type')) reqHeaders.set('Content-Type', 'application/json');
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const req = new Request(`${origin}${reqPath}`, opts);
  const res = await handleApiRequest(req, env, ctx);
  let data = null;
  try {
    data = await res.clone().json();
  } catch {
    data = null;
  }
  return { status: res.status, data, headers: res.headers, setCookies: parseSetCookies(res.headers) };
}

function mockFetch(fn) {
  const origFetch = globalThis.fetch;
  globalThis.fetch = fn;
  return () => {
    globalThis.fetch = origFetch;
  };
}

describe('Auth endpoints: status, Google PKCE, callback, session, logout', () => {
  test('/api/auth/status reflects config flags accurately', async () => {
    const envEmpty = makeEnv();
    const r1 = await call(envEmpty, 'GET', '/api/auth/status');
    assert.equal(r1.status, 200);
    assert.equal(r1.data.googleConfigured, false);
    assert.equal(r1.data.telegramConfigured, false);
    assert.equal(r1.data.telegramBotUsername, null);
    assert.equal(r1.data.origin, 'https://workflow.myclass.uz');

    const envSet = makeEnv({
      GOOGLE_CLIENT_ID: 'gid',
      GOOGLE_CLIENT_SECRET: 'gsec',
      TELEGRAM_BOT_TOKEN: 'bot-tok',
      TELEGRAM_BOT_USERNAME: '@taskflow_helper_bot'
    });
    const r2 = await call(envSet, 'GET', '/api/auth/status');
    assert.equal(r2.status, 200);
    assert.equal(r2.data.googleConfigured, true);
    assert.equal(r2.data.telegramConfigured, true);
    assert.equal(r2.data.telegramBotUsername, 'taskflow_helper_bot');
  });

  test('/api/auth/google unconfigured redirects with auth_error=google_not_configured', async () => {
    const env = makeEnv();
    const r = await call(env, 'GET', '/api/auth/google');
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), 'https://workflow.myclass.uz/?auth_error=google_not_configured');
  });

  test('/api/auth/google configured sets signed tf_oauth PKCE cookie and omits Secure on localhost', async () => {
    const env = makeEnv({ GOOGLE_CLIENT_ID: 'cid_123', GOOGLE_CLIENT_SECRET: 'csec_123' });

    // Production HTTPS -> includes Secure flag
    const rHttps = await call(env, 'GET', '/api/auth/google');
    assert.equal(rHttps.status, 302);
    const loc = new URL(rHttps.headers.get('location'));
    assert.equal(loc.origin, 'https://accounts.google.com');
    assert.equal(loc.searchParams.get('client_id'), 'cid_123');
    assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(loc.searchParams.get('code_challenge'));
    assert.ok(loc.searchParams.get('state'));
    assert.equal(loc.searchParams.get('scope'), 'openid email profile');
    assert.ok(rHttps.setCookies.some((c) => c.startsWith('tf_oauth=') && c.includes('HttpOnly') && c.includes('Secure')));

    // Local HTTP -> omits Secure flag cleanly
    const rLocal = await call(env, 'GET', '/api/auth/google', { origin: 'http://127.0.0.1:8788' });
    assert.equal(rLocal.status, 302);
    assert.ok(rLocal.setCookies.some((c) => c.startsWith('tf_oauth=') && c.includes('HttpOnly') && !c.includes('Secure')));
  });

  test('/api/auth/google/callback validates state, exchanges PKCE code, creates clean 0-task user cabinet, sets tf_session', async () => {
    const env = makeEnv({ GOOGLE_CLIENT_ID: 'cid_123', GOOGLE_CLIENT_SECRET: 'csec_123' });

    const startRes = await call(env, 'GET', '/api/auth/google');
    const authUrl = new URL(startRes.headers.get('location'));
    const state = authUrl.searchParams.get('state');
    const oauthVal = extractCookieValue(startRes.setCookies, 'tf_oauth');
    assert.ok(oauthVal);

    // Mismatched state rejects cleanly
    const badState = await call(env, 'GET', `/api/auth/google/callback?code=abc&state=wrong_state`, {
      headers: { Cookie: `tf_oauth=${encodeURIComponent(oauthVal)}` }
    });
    assert.equal(badState.status, 302);
    assert.match(badState.headers.get('location'), /auth_error=oauth_state_mismatch/);

    // Valid callback with mocked Google token + userinfo endpoints
    let capturedVerifier = null;
    const restore = mockFetch(async (url, opts) => {
      if (String(url) === 'https://oauth2.googleapis.com/token') {
        const bodyParams = new URLSearchParams(opts.body);
        capturedVerifier = bodyParams.get('code_verifier');
        return new Response(JSON.stringify({ access_token: 'goog_tok_1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (String(url) === 'https://openidconnect.googleapis.com/v1/userinfo') {
        return new Response(
          JSON.stringify({
            sub: 'google-sub-alice',
            email: 'alice@example.com',
            name: 'Alice Vance',
            picture: 'https://example.com/alice.jpg'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error('Unexpected fetch: ' + url);
    });

    try {
      const cbRes = await call(env, 'GET', `/api/auth/google/callback?code=auth_code_1&state=${encodeURIComponent(state)}`, {
        headers: { Cookie: `tf_oauth=${encodeURIComponent(oauthVal)}` }
      });
      assert.equal(cbRes.status, 302);
      assert.equal(cbRes.headers.get('location'), 'https://workflow.myclass.uz/');
      assert.ok(capturedVerifier && capturedVerifier.length >= 32);

      const sessionCookieVal = extractCookieValue(cbRes.setCookies, 'tf_session');
      assert.ok(sessionCookieVal);
      assert.ok(cbRes.setCookies.some((c) => c.startsWith('tf_oauth=;') || c.includes('Max-Age=0')));

      // Verify /api/auth/me and clean 0-task workspace onboarding
      const cookieHeader = `tf_session=${encodeURIComponent(sessionCookieVal)}`;
      const meRes = await call(env, 'GET', '/api/auth/me', { headers: { Cookie: cookieHeader } });
      assert.equal(meRes.status, 200);
      assert.equal(meRes.data.authenticated, true);
      assert.equal(meRes.data.user.email, 'alice@example.com');
      assert.equal(meRes.data.user.name, 'Alice Vance');
      assert.equal(meRes.data.user.telegramLinked, false);
      assert.equal(meRes.data.user.telegramChatId, null);

      const wsRes = await call(env, 'GET', '/api/workspace', { headers: { Cookie: cookieHeader } });
      assert.equal(wsRes.status, 200);
      assert.deepEqual(wsRes.data.tasks, []);
      assert.deepEqual(wsRes.data.routines, []);
      assert.deepEqual(wsRes.data.reflections, {});
      assert.equal(wsRes.data.settings.userName, 'Alice Vance');
    } finally {
      restore();
    }
  });

  test('/api/auth/me rejects tampered or expired session cookies', async () => {
    const env = makeEnv();
    const cookie = await seedUserWithCookie(env, { id: 'usr_1', googleSub: 'g1', email: 'u1@x.com', name: 'U1' });
    const okRes = await call(env, 'GET', '/api/auth/me', { headers: { Cookie: cookie } });
    assert.equal(okRes.data.authenticated, true);

    const tampered = await call(env, 'GET', '/api/auth/me', { headers: { Cookie: cookie + 'tamper' } });
    assert.equal(tampered.data.authenticated, false);
    assert.equal(tampered.data.user, null);

    const expiredToken = await signTestToken(
      { typ: 'session', uid: 'usr_1', exp: Date.now() - 5000 },
      env.SESSION_SECRET
    );
    const expRes = await call(env, 'GET', '/api/auth/me', {
      headers: { Cookie: `tf_session=${encodeURIComponent(expiredToken)}` }
    });
    assert.equal(expRes.data.authenticated, false);
  });
});

describe('Strict Two-User Cabinet Isolation & CRUD (WHERE user_id = ?)', () => {
  test('User A and User B workspaces, tasks, routines, reflections, and batch ops are strictly isolated', async () => {
    const env = makeEnv();
    const cookieA = await seedUserWithCookie(env, { id: 'usr_A', googleSub: 'subA', email: 'a@x.com', name: 'User A' });
    const cookieB = await seedUserWithCookie(env, { id: 'usr_B', googleSub: 'subB', email: 'b@x.com', name: 'User B' });

    // Create task & routine & reflection as User A
    const tA = await call(env, 'POST', '/api/tasks', {
      headers: { Cookie: cookieA },
      body: { id: 'task_a_1', title: 'Alice Secret Task', date: '2026-11-25', priority: 'high', subtasks: ['Sub 1'] }
    });
    assert.equal(tA.status, 201);
    assert.equal(tA.data.task.id, 'task_a_1');
    assert.equal(tA.data.task.subtasks.length, 1);

    const rA = await call(env, 'POST', '/api/routines', {
      headers: { Cookie: cookieA },
      body: { id: 'rtn_a_1', title: 'Alice Routine', schedule: 'weekdays', subtasks: ['Step 1'] }
    });
    assert.equal(rA.status, 201);

    const refA = await call(env, 'PUT', '/api/reflections/2026-11-25', {
      headers: { Cookie: cookieA },
      body: { mood: 5, intention: 'Alice focus', reflection: 'Alice win' }
    });
    assert.equal(refA.status, 200);
    assert.equal(refA.data.reflection.mood, 5);

    // User B cannot see A's items in /api/workspace
    const wsB = await call(env, 'GET', '/api/workspace', { headers: { Cookie: cookieB } });
    assert.equal(wsB.status, 200);
    assert.equal(wsB.data.tasks.length, 0);
    assert.equal(wsB.data.routines.length, 0);
    assert.deepEqual(wsB.data.reflections, {});

    // User B cannot PATCH, DELETE, batch-upsert, batch-delete, or reorder User A's task or routine
    const patchAsB = await call(env, 'PATCH', '/api/tasks/task_a_1', {
      headers: { Cookie: cookieB },
      body: { title: 'Hacked!' }
    });
    assert.equal(patchAsB.status, 404);

    const delAsB = await call(env, 'DELETE', '/api/tasks/task_a_1', { headers: { Cookie: cookieB } });
    assert.equal(delAsB.status, 404);

    const createCollisionAsB = await call(env, 'POST', '/api/tasks', {
      headers: { Cookie: cookieB },
      body: { id: 'task_a_1', title: 'Collision', date: '2026-11-25' }
    });
    assert.equal(createCollisionAsB.status, 409);

    const batchUpsertCollisionB = await call(env, 'POST', '/api/tasks/batch', {
      headers: { Cookie: cookieB },
      body: { action: 'upsertMany', tasks: [{ id: 'task_a_1', title: 'Steal', date: '2026-11-25' }] }
    });
    assert.equal(batchUpsertCollisionB.status, 409);

    const batchDelAsB = await call(env, 'POST', '/api/tasks/batch', {
      headers: { Cookie: cookieB },
      body: { action: 'deleteMany', ids: ['task_a_1'] }
    });
    assert.equal(batchDelAsB.status, 200);
    assert.equal(batchDelAsB.data.deleted, 0);

    const reorderAsB = await call(env, 'POST', '/api/tasks/batch', {
      headers: { Cookie: cookieB },
      body: { action: 'reorder', updates: [{ id: 'task_a_1', order: 99 }] }
    });
    assert.equal(reorderAsB.status, 200);
    assert.equal(reorderAsB.data.count, 0);

    const patchRtnAsB = await call(env, 'PATCH', '/api/routines/rtn_a_1', {
      headers: { Cookie: cookieB },
      body: { active: false }
    });
    assert.equal(patchRtnAsB.status, 404);

    const delRtnAsB = await call(env, 'DELETE', '/api/routines/rtn_a_1', { headers: { Cookie: cookieB } });
    assert.equal(delRtnAsB.status, 404);

    // User A's data remains untouched
    const wsA = await call(env, 'GET', '/api/workspace', { headers: { Cookie: cookieA } });
    assert.equal(wsA.data.tasks.length, 1);
    assert.equal(wsA.data.tasks[0].title, 'Alice Secret Task');
    assert.equal(wsA.data.routines.length, 1);

    // Importing overlapping IDs from guest workspace into User B cleanly remaps IDs without touching User A
    const impB = await call(env, 'POST', '/api/workspace/import', {
      headers: { Cookie: cookieB },
      body: {
        mode: 'merge',
        routines: [{ id: 'rtn_a_1', title: 'Bob Copy Routine', schedule: 'daily' }],
        tasks: [{ id: 'task_a_1', title: 'Bob Copy Task', date: '2026-11-25', routineId: 'rtn_a_1' }],
        reflections: { '2026-11-25': { mood: 3, intention: 'Bob day' } }
      }
    });
    assert.equal(impB.status, 200);
    assert.equal(impB.data.workspace.tasks.length, 1);
    assert.notEqual(impB.data.workspace.tasks[0].id, 'task_a_1');
    assert.notEqual(impB.data.workspace.routines[0].id, 'rtn_a_1');
    assert.equal(impB.data.workspace.tasks[0].routineId, impB.data.workspace.routines[0].id);

    // User A can update & delete own task cleanly (verifies meta.changes!)
    const patchA = await call(env, 'PATCH', '/api/tasks/task_a_1', {
      headers: { Cookie: cookieA },
      body: { status: 'done', actualMinutes: 25 }
    });
    assert.equal(patchA.status, 200);
    assert.equal(patchA.data.task.status, 'done');
    assert.ok(patchA.data.task.completedAt);

    const delA = await call(env, 'DELETE', '/api/tasks/task_a_1', { headers: { Cookie: cookieA } });
    assert.equal(delA.status, 200);
    assert.equal(delA.data.ok, true);
  });

  test('/api/settings updates user_settings and Telegram notification preferences', async () => {
    const env = makeEnv();
    const cookieA = await seedUserWithCookie(env, { id: 'usr_S', googleSub: 'subS', email: 's@x.com', name: 'Settings User' });

    const badTz = await call(env, 'PUT', '/api/settings', {
      headers: { Cookie: cookieA },
      body: { timezone: 'Mars/Olympus_Mons' }
    });
    assert.equal(badTz.status, 400);

    const res = await call(env, 'PUT', '/api/settings', {
      headers: { Cookie: cookieA },
      body: {
        dailyGoalTasks: 7,
        dailyGoalMinutes: 180,
        theme: 'dark',
        timezone: 'Europe/London',
        telegramNotificationsEnabled: false,
        morningReminderHour: 0,
        eveningReminderHour: 22
      }
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.settings.dailyGoalTasks, 7);
    assert.equal(res.data.settings.theme, 'dark');
    assert.equal(res.data.user.timezone, 'Europe/London');
    assert.equal(res.data.user.telegramNotificationsEnabled, false);
    assert.equal(res.data.user.morningReminderHour, 0);
    assert.equal(res.data.user.eveningReminderHour, 22);

    const wsAfter = await call(env, 'GET', '/api/workspace', { headers: { Cookie: cookieA } });
    assert.equal(wsAfter.status, 200);
    assert.equal(wsAfter.data.settings.theme, 'dark');
  });
});

describe('Telegram pairing, webhook commands, Mini App auth & Cron Worker', () => {
  test('Full Telegram flow: link-code -> webhook /start link_CODE -> /add -> /today -> /done -> /stats -> MiniApp auth -> Cron', async () => {
    const botToken = '123456:TEST_BOT_TOKEN';
    const env = makeEnv({
      TELEGRAM_BOT_TOKEN: botToken,
      TELEGRAM_BOT_USERNAME: 'taskflow_test_bot',
      TELEGRAM_WEBHOOK_SECRET: 'hook_secret_xyz'
    });
    const cookieA = await seedUserWithCookie(env, { id: 'usr_tg', googleSub: 'subTG', email: 'tg@x.com', name: 'Alex <Dev>' });

    // 1. Generate link code
    const linkRes = await call(env, 'POST', '/api/telegram/link-code', { headers: { Cookie: cookieA } });
    assert.equal(linkRes.status, 200);
    assert.match(linkRes.data.code, /^[A-Z2-9]{8}$/);
    assert.equal(linkRes.data.deepLink, `https://t.me/taskflow_test_bot?start=link_${linkRes.data.code}`);

    // 2. Webhook rejects wrong/missing secret token
    const badHook = await call(env, 'POST', '/api/telegram/webhook', {
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong' },
      body: { update_id: 1 }
    });
    assert.equal(badHook.status, 401);

    // 3. Mock outbound Telegram API calls and drive webhook commands
    const sentMessages = [];
    const restore = mockFetch(async (url, opts) => {
      if (String(url).includes('/sendMessage')) {
        sentMessages.push(JSON.parse(opts.body));
        return new Response(JSON.stringify({ ok: true, result: { message_id: sentMessages.length } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      throw new Error('Unexpected fetch: ' + url);
    });

    try {
      const hookHeaders = { 'X-Telegram-Bot-Api-Secret-Token': 'hook_secret_xyz' };

      // /start link_<CODE>
      const linkHook = await call(env, 'POST', '/api/telegram/webhook', {
        headers: hookHeaders,
        body: {
          message: {
            chat: { id: 99887766 },
            from: { id: 99887766, username: 'alex_tg', first_name: 'Alex' },
            text: `/start link_${linkRes.data.code}`
          }
        }
      });
      assert.equal(linkHook.status, 200);
      assert.equal(sentMessages.length, 1);
      assert.match(sentMessages[0].text, /Connected to <b>Alex &lt;Dev&gt;<\/b>/);

      // Verify /api/auth/me now reports telegramLinked + telegramChatId + telegramUsername
      const meAfter = await call(env, 'GET', '/api/auth/me', { headers: { Cookie: cookieA } });
      assert.equal(meAfter.data.user.telegramLinked, true);
      assert.equal(meAfter.data.user.telegramChatId, '99887766');
      assert.equal(meAfter.data.user.telegramUsername, 'alex_tg');

      // /add <title> (with HTML special chars to verify escaping)
      await call(env, 'POST', '/api/telegram/webhook', {
        headers: hookHeaders,
        body: { message: { chat: { id: 99887766 }, from: { id: 99887766 }, text: '/add Ship <Phase 2> Auth' } }
      });
      assert.match(sentMessages[1].text, /Ship &lt;Phase 2&gt; Auth/);

      // /today
      await call(env, 'POST', '/api/telegram/webhook', {
        headers: hookHeaders,
        body: { message: { chat: { id: 99887766 }, from: { id: 99887766 }, text: '/today' } }
      });
      assert.match(sentMessages[2].text, /1\. ⬜ Ship &lt;Phase 2&gt; Auth/);

      // /done 1
      await call(env, 'POST', '/api/telegram/webhook', {
        headers: hookHeaders,
        body: { message: { chat: { id: 99887766 }, from: { id: 99887766 }, text: '/done 1' } }
      });
      assert.match(sentMessages[3].text, /Completed #1: <b>Ship &lt;Phase 2&gt; Auth<\/b>/);

      // /stats
      await call(env, 'POST', '/api/telegram/webhook', {
        headers: hookHeaders,
        body: { message: { chat: { id: 99887766 }, from: { id: 99887766 }, text: '/stats' } }
      });
      assert.match(sentMessages[4].text, /Completed: <b>1\/1<\/b> \(100%\)/);

      // /api/telegram/miniapp-auth with valid HMAC initData logs user in
      const validInitData = await computeTelegramInitData({ id: 99887766, username: 'alex_tg', first_name: 'Alex' }, botToken);
      const miniRes = await call(env, 'POST', '/api/telegram/miniapp-auth', {
        body: { initData: validInitData }
      });
      assert.equal(miniRes.status, 200);
      assert.equal(miniRes.data.linked, true);
      assert.equal(miniRes.data.user.id, 'usr_tg');
      assert.ok(extractCookieValue(miniRes.setCookies, 'tf_session'));

      // Invalid initData fails with 401
      const badMini = await call(env, 'POST', '/api/telegram/miniapp-auth', {
        body: { initData: validInitData.replace(/hash=[0-9a-f]+/, 'hash=' + '0'.repeat(64)) }
      });
      assert.equal(badMini.status, 401);

      // Cron worker sends morning briefing at 08:00 Asia/Tashkent (03:00 UTC) and deduplicates same-day runs
      const morningUtc = new Date('2026-11-25T03:05:00Z'); // 08:05 Asia/Tashkent
      const { dateKey, hour } = getLocalDateAndHour(morningUtc, 'Asia/Tashkent');
      assert.equal(dateKey, '2026-11-25');
      assert.equal(hour, 8);

      const cronRun1 = await runHourlyBriefings(env, morningUtc);
      assert.equal(cronRun1.ok, true);
      assert.equal(cronRun1.sentMorning, 1);
      assert.equal(cronRun1.sentEvening, 0);

      // Running again in the same hour / day skips duplicate send
      const cronRun2 = await runHourlyBriefings(env, morningUtc);
      assert.equal(cronRun2.sentMorning, 0);

      // Cron /health route
      const healthRes = await cronWorker.fetch(new Request('https://cron.example.com/health'));
      assert.equal(healthRes.status, 200);
      assert.equal((await healthRes.json()).ok, true);
    } finally {
      restore();
    }
  });
});

describe('Public & guard routes: method enforcement, unknown routes, DB check', () => {
  test('405 on invalid methods, 401 before 404 on unauth /api/*, 404 on non-api', async () => {
    const env = makeEnv();
    assert.equal((await call(env, 'POST', '/api/auth/status')).status, 405);
    assert.equal((await call(env, 'GET', '/api/auth/logout')).status, 405);
    assert.equal((await call(env, 'GET', '/api/unknown')).status, 401);
    assert.equal((await call(env, 'GET', '/not-api')).status, 404);

    const cookieA = await seedUserWithCookie(env, { id: 'usr_M', googleSub: 'subM', email: 'm@x.com', name: 'M' });
    assert.equal((await call(env, 'GET', '/api/unknown', { headers: { Cookie: cookieA } })).status, 404);
    assert.equal((await call(env, 'GET', '/api/tasks', { headers: { Cookie: cookieA } })).status, 405);
  });
});
