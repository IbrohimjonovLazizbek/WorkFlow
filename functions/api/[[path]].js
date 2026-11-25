const DEFAULT_TIMEZONE = 'Asia/Tashkent';
const SESSION_TTL_SECONDS = 2592000; // 30 days
const OAUTH_TTL_SECONDS = 600; // 10 minutes
const LINK_CODE_TTL_MS = 600000; // 10 minutes
const MINIAPP_AUTH_MAX_AGE_SECONDS = 86400; // 24 hours
const D1_IN_CHUNK_SIZE = 50;

const VALID_TIME_BLOCKS = new Set(['morning', 'afternoon', 'evening', 'anytime']);
const VALID_PRIORITIES = new Set(['high', 'medium', 'low']);
const VALID_CATEGORIES = new Set(['work', 'health', 'learning', 'personal', 'admin']);
const VALID_STATUSES = new Set(['todo', 'in_progress', 'done']);
const LINK_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/* ============================================================================
 * HTTP & Validation Helpers
 * ========================================================================== */

function jsonResponse(data, status = 200, extraHeaders = null) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  if (extraHeaders) {
    for (const [key, value] of extraHeaders.entries()) {
      headers.append(key, value);
    }
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function errorResponse(status, error, code = 'ERROR', details = undefined) {
  const body = { error, code };
  if (details !== undefined) {
    body.details = details;
  }
  return jsonResponse(body, status);
}

function redirectResponse(location, extraHeaders = null) {
  const headers = new Headers({
    Location: location,
    'Cache-Control': 'no-store'
  });
  if (extraHeaders) {
    for (const [key, value] of extraHeaders.entries()) {
      headers.append(key, value);
    }
  }
  return new Response(null, { status: 302, headers });
}

async function readJsonBody(request) {
  let raw;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, error: 'Unable to read request body' };
  }
  if (!raw || !raw.trim()) {
    return { ok: false, error: 'Request body must be valid JSON' };
  }
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, error: 'JSON body must be an object' };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'Malformed JSON body' };
  }
}

async function readOptionalJsonBody(request) {
  let raw = '';
  try {
    raw = await request.text();
  } catch {
    return { ok: false, error: 'Unable to read request body' };
  }
  if (!raw || !raw.trim()) {
    return { ok: true, data: {} };
  }
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, error: 'JSON body must be an object' };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'Malformed JSON body' };
  }
}

function sanitizeBotUsername(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/^@+/, '').trim();
  return cleaned || null;
}

function isValidDateKey(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return false;
  }
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function addDaysToDateKey(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta, 12, 0, 0));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

function getDateKeyInTimezone(timeZone, date = new Date()) {
  const safeTz = isValidTimeZone(timeZone) ? timeZone.trim() : DEFAULT_TIMEZONE;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function normalizeTime(val) {
  if (typeof val !== 'string') return '';
  const trimmed = val.trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(trimmed) ? trimmed : '';
}

function safeJsonParse(raw, fallback) {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatMinutes(mins) {
  const total = Math.max(0, Math.round(Number(mins) || 0));
  if (total === 0) return '0m';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function chunkArray(items, chunkSize = D1_IN_CHUNK_SIZE) {
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

/* ============================================================================
 * Web Crypto & Cookie Helpers (Zero external dependencies)
 * ========================================================================== */

function toBase64Url(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < view.length; i += step) {
    binary += String.fromCharCode(...view.subarray(i, i + step));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9\-_]+$/.test(str)) {
    return null;
  }
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function importHmacKey(keyBytes, usages) {
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages
  );
}

/**
 * Constant-time string comparison using an ephemeral HMAC key and crypto.subtle.verify.
 * Avoids `===` and prevents timing leaks including secret length leakage.
 */
async function constantTimeEqualStrings(expected, provided) {
  if (typeof expected !== 'string' || typeof provided !== 'string') {
    return false;
  }
  const key = await crypto.subtle.generateKey(
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  const expectedMac = await crypto.subtle.sign('HMAC', key, textEncoder.encode(expected));
  return crypto.subtle.verify('HMAC', key, expectedMac, textEncoder.encode(provided));
}

async function signTokenPayload(payload, secret) {
  const payloadB64 = toBase64Url(textEncoder.encode(JSON.stringify(payload)));
  const key = await importHmacKey(textEncoder.encode(secret), ['sign']);
  const sigBuffer = await crypto.subtle.sign('HMAC', key, textEncoder.encode(payloadB64));
  const sigB64 = toBase64Url(new Uint8Array(sigBuffer));
  return `${payloadB64}.${sigB64}`;
}

async function verifyTokenPayload(token, secret, expectedType) {
  if (typeof token !== 'string' || typeof secret !== 'string' || !secret) {
    return null;
  }
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0 || token.indexOf('.', dotIdx + 1) !== -1) {
    return null;
  }
  const payloadB64 = token.slice(0, dotIdx);
  const sigB64 = token.slice(dotIdx + 1);
  const sigBytes = fromBase64Url(sigB64);
  const payloadBytes = fromBase64Url(payloadB64);
  if (!sigBytes || !payloadBytes) {
    return null;
  }

  const key = await importHmacKey(textEncoder.encode(secret), ['verify']);
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, textEncoder.encode(payloadB64));
  if (!valid) {
    return null;
  }

  try {
    const payload = JSON.parse(textDecoder.decode(payloadBytes));
    if (!payload || typeof payload !== 'object') return null;
    if (payload.typ !== expectedType) return null;
    if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function generateRandomBase64Url(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

async function computePkceChallenge(codeVerifier) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(codeVerifier));
  return toBase64Url(new Uint8Array(digest));
}

function generatePairingCode(length = 8) {
  const alphabetLen = LINK_CODE_ALPHABET.length;
  const maxValidByte = Math.floor(256 / alphabetLen) * alphabetLen;
  let code = '';
  const buf = new Uint8Array(16);
  while (code.length < length) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && code.length < length; i += 1) {
      if (buf[i] < maxValidByte) {
        code += LINK_CODE_ALPHABET[buf[i] % alphabetLen];
      }
    }
  }
  return code;
}

function parseCookies(request) {
  const header = request.headers.get('Cookie');
  const map = new Map();
  if (!header) return map;

  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = trimmed.slice(0, eqIdx).trim();
    const rawVal = trimmed.slice(eqIdx + 1).trim();
    try {
      map.set(name, decodeURIComponent(rawVal));
    } catch {
      map.set(name, rawVal);
    }
  }
  return map;
}

function shouldUseSecureCookie(url) {
  const isLocalHttp =
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  return !isLocalHttp;
}

function buildCookieHeader(name, value, { path = '/', maxAge = null, secure = true, httpOnly = true, sameSite = 'Lax' } = {}) {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  if (path) segments.push(`Path=${path}`);
  if (typeof maxAge === 'number') segments.push(`Max-Age=${maxAge}`);
  if (httpOnly) segments.push('HttpOnly');
  if (sameSite) segments.push(`SameSite=${sameSite}`);
  if (secure) segments.push('Secure');
  return segments.join('; ');
}

function appendSessionCookie(headers, token, url) {
  headers.append(
    'Set-Cookie',
    buildCookieHeader('tf_session', token, {
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
      secure: shouldUseSecureCookie(url),
      httpOnly: true,
      sameSite: 'Lax'
    })
  );
}

function clearSessionCookie(headers, url) {
  headers.append(
    'Set-Cookie',
    buildCookieHeader('tf_session', '', {
      path: '/',
      maxAge: 0,
      secure: shouldUseSecureCookie(url),
      httpOnly: true,
      sameSite: 'Lax'
    })
  );
}

function appendOAuthCookie(headers, token, url) {
  headers.append(
    'Set-Cookie',
    buildCookieHeader('tf_oauth', token, {
      path: '/api/auth/google',
      maxAge: OAUTH_TTL_SECONDS,
      secure: shouldUseSecureCookie(url),
      httpOnly: true,
      sameSite: 'Lax'
    })
  );
}

function clearOAuthCookie(headers, url) {
  headers.append(
    'Set-Cookie',
    buildCookieHeader('tf_oauth', '', {
      path: '/api/auth/google',
      maxAge: 0,
      secure: shouldUseSecureCookie(url),
      httpOnly: true,
      sameSite: 'Lax'
    })
  );
}

/* ============================================================================
 * Domain Mappers & Normalizers (SQLite snake_case <-> JS camelCase)
 * ========================================================================== */

function formatUser(row) {
  return {
    id: row.id,
    email: row.email || null,
    name: row.name || row.email || 'TaskFlow User',
    avatarUrl: row.avatar_url || null,
    timezone: row.timezone || DEFAULT_TIMEZONE,
    telegramChatId: row.telegram_chat_id || null,
    telegramLinked: Boolean(row.telegram_chat_id),
    telegramUsername: row.telegram_username || null,
    telegramNotificationsEnabled:
      row.telegram_notifications_enabled === null || row.telegram_notifications_enabled === undefined
        ? true
        : Boolean(row.telegram_notifications_enabled),
    morningReminderHour:
      row.morning_reminder_hour !== null &&
      row.morning_reminder_hour !== undefined &&
      row.morning_reminder_hour !== '' &&
      Number.isFinite(Number(row.morning_reminder_hour))
        ? Number(row.morning_reminder_hour)
        : 8,
    eveningReminderHour:
      row.evening_reminder_hour !== null &&
      row.evening_reminder_hour !== undefined &&
      row.evening_reminder_hour !== '' &&
      Number.isFinite(Number(row.evening_reminder_hour))
        ? Number(row.evening_reminder_hour)
        : 21,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function formatSettings(row) {
  if (!row) {
    return {
      dailyGoalTasks: 5,
      dailyGoalMinutes: 120,
      soundEnabled: true,
      userName: 'Daily Workspace',
      showCompleted: true
    };
  }
  return {
    dailyGoalTasks: clampInt(row.daily_goal_tasks, 1, 50, 5),
    dailyGoalMinutes: clampInt(row.daily_goal_minutes, 15, 720, 120),
    soundEnabled: Boolean(row.sound_enabled),
    userName: typeof row.user_name === 'string' && row.user_name.trim() ? row.user_name : 'Daily Workspace',
    showCompleted: Boolean(row.show_completed)
  };
}

function formatTask(row) {
  const rawSubs = safeJsonParse(row.subtasks_json, []);
  const subtasks = Array.isArray(rawSubs)
    ? rawSubs
        .filter((s) => s && typeof s.title === 'string' && s.title.trim())
        .map((s) => ({
          id: typeof s.id === 'string' && s.id ? s.id : `sub_${crypto.randomUUID().slice(0, 8)}`,
          title: s.title.trim(),
          done: Boolean(s.done)
        }))
    : [];

  return {
    id: row.id,
    title: row.title,
    notes: row.notes || '',
    date: row.date,
    timeBlock: VALID_TIME_BLOCKS.has(row.time_block) ? row.time_block : 'anytime',
    scheduledTime: row.scheduled_time || '',
    estimatedMinutes: Number.isFinite(Number(row.estimated_minutes)) ? Number(row.estimated_minutes) : 30,
    actualMinutes: Number.isFinite(Number(row.actual_minutes)) ? Number(row.actual_minutes) : 0,
    priority: VALID_PRIORITIES.has(row.priority) ? row.priority : 'medium',
    category: VALID_CATEGORIES.has(row.category) ? row.category : 'work',
    status: VALID_STATUSES.has(row.status) ? row.status : 'todo',
    subtasks,
    routineId: row.routine_id || null,
    order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 0,
    createdAt: row.created_at,
    completedAt: row.completed_at || null
  };
}

function formatRoutine(row) {
  const rawSubs = safeJsonParse(row.subtasks_json, []);
  const subtasks = Array.isArray(rawSubs)
    ? rawSubs
        .map((s) => {
          if (typeof s === 'string') return s.trim();
          if (s && typeof s.title === 'string') return s.title.trim();
          return '';
        })
        .filter(Boolean)
    : [];

  return {
    id: row.id,
    title: row.title,
    category: VALID_CATEGORIES.has(row.category) ? row.category : 'work',
    priority: VALID_PRIORITIES.has(row.priority) ? row.priority : 'medium',
    timeBlock: VALID_TIME_BLOCKS.has(row.time_block) ? row.time_block : 'morning',
    estimatedMinutes: Number.isFinite(Number(row.estimated_minutes)) ? Number(row.estimated_minutes) : 30,
    schedule: row.schedule === 'weekdays' ? 'weekdays' : 'daily',
    active: Boolean(row.active),
    subtasks
  };
}

function formatReflection(row) {
  return {
    mood: row.mood === null || row.mood === undefined ? null : clampInt(row.mood, 1, 5, null),
    intention: typeof row.intention === 'string' ? row.intention : '',
    reflection: typeof row.reflection === 'string' ? row.reflection : '',
    updatedAt: row.updated_at
  };
}

function normalizeSubtasksInput(rawSubtasks) {
  if (!Array.isArray(rawSubtasks)) return [];
  const result = [];
  for (const item of rawSubtasks) {
    if (typeof item === 'string') {
      const title = item.trim();
      if (title) {
        result.push({
          id: `sub_${crypto.randomUUID().slice(0, 8)}`,
          title: title.slice(0, 300),
          done: false
        });
      }
    } else if (item && typeof item === 'object') {
      const title = typeof item.title === 'string' ? item.title.trim() : '';
      if (title) {
        result.push({
          id: typeof item.id === 'string' && item.id.trim()
            ? item.id.trim().slice(0, 100)
            : `sub_${crypto.randomUUID().slice(0, 8)}`,
          title: title.slice(0, 300),
          done: Boolean(item.done)
        });
      }
    }
  }
  return result;
}

function normalizeRoutineSubtasksInput(rawSubtasks) {
  if (!Array.isArray(rawSubtasks)) return [];
  return rawSubtasks
    .map((item) => {
      if (typeof item === 'string') return item.trim().slice(0, 300);
      if (item && typeof item.title === 'string') return item.title.trim().slice(0, 300);
      return '';
    })
    .filter(Boolean);
}

function normalizeTaskInput(raw, existingTask = null, defaultDate = null) {
  const source = existingTask ? { ...existingTask, ...raw } : raw;
  const title = typeof source.title === 'string' ? source.title.trim() : '';
  if (!title) {
    return { ok: false, error: 'Task title is required' };
  }

  let date = existingTask ? existingTask.date : defaultDate;
  if (raw.date !== undefined) {
    if (!isValidDateKey(raw.date)) {
      return { ok: false, error: 'Task date must be a valid YYYY-MM-DD calendar date' };
    }
    date = raw.date;
  } else if (!isValidDateKey(date)) {
    return { ok: false, error: 'Task date must be a valid YYYY-MM-DD calendar date' };
  }

  const status = VALID_STATUSES.has(source.status) ? source.status : 'todo';
  const nowIso = new Date().toISOString();

  let completedAt = null;
  if (status === 'done') {
    if (existingTask && existingTask.status === 'done' && existingTask.completedAt) {
      completedAt = typeof raw.completedAt === 'string' && raw.completedAt ? raw.completedAt : existingTask.completedAt;
    } else {
      completedAt = typeof source.completedAt === 'string' && source.completedAt ? source.completedAt : nowIso;
    }
  }

  const createdAt = existingTask?.createdAt
    || (typeof source.createdAt === 'string' && source.createdAt ? source.createdAt : nowIso);

  const rawId = existingTask?.id
    || (typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 128) : `task_${crypto.randomUUID()}`);

  const order = raw.order !== undefined
    ? (Number.isFinite(Number(raw.order)) ? Math.round(Number(raw.order)) : 0)
    : (existingTask ? existingTask.order : 0);

  return {
    ok: true,
    task: {
      id: rawId,
      title: title.slice(0, 500),
      notes: typeof source.notes === 'string' ? source.notes.slice(0, 10000) : '',
      date,
      timeBlock: VALID_TIME_BLOCKS.has(source.timeBlock) ? source.timeBlock : 'anytime',
      scheduledTime: normalizeTime(source.scheduledTime),
      estimatedMinutes: clampInt(source.estimatedMinutes, 0, 1440, 30),
      actualMinutes: clampInt(source.actualMinutes, 0, 1440, 0),
      priority: VALID_PRIORITIES.has(source.priority) ? source.priority : 'medium',
      category: VALID_CATEGORIES.has(source.category) ? source.category : 'work',
      status,
      subtasks: normalizeSubtasksInput(source.subtasks),
      routineId: typeof source.routineId === 'string' && source.routineId.trim()
        ? source.routineId.trim().slice(0, 128)
        : null,
      order,
      createdAt,
      completedAt
    }
  };
}

function normalizeRoutineInput(raw, existingRoutine = null) {
  const source = existingRoutine ? { ...existingRoutine, ...raw } : raw;
  const title = typeof source.title === 'string' ? source.title.trim() : '';
  if (!title) {
    return { ok: false, error: 'Routine title is required' };
  }

  const rawId = existingRoutine?.id
    || (typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 128) : `rtn_${crypto.randomUUID()}`);

  return {
    ok: true,
    routine: {
      id: rawId,
      title: title.slice(0, 300),
      category: VALID_CATEGORIES.has(source.category) ? source.category : 'work',
      priority: VALID_PRIORITIES.has(source.priority) ? source.priority : 'medium',
      timeBlock: VALID_TIME_BLOCKS.has(source.timeBlock) ? source.timeBlock : 'morning',
      estimatedMinutes: clampInt(source.estimatedMinutes, 5, 480, 30),
      schedule: source.schedule === 'weekdays' ? 'weekdays' : 'daily',
      active: source.active !== undefined ? Boolean(source.active) : true,
      subtasks: normalizeRoutineSubtasksInput(source.subtasks)
    }
  };
}

/* ============================================================================
 * Auth & Workspace Database Operations
 * ========================================================================== */

async function authenticateRequest(request, env) {
  if (!env?.DB || !env?.SESSION_SECRET) {
    return null;
  }
  const cookies = parseCookies(request);
  const sessionToken = cookies.get('tf_session');
  if (!sessionToken) return null;

  const payload = await verifyTokenPayload(sessionToken, env.SESSION_SECRET, 'session');
  if (!payload || typeof payload.uid !== 'string' || !payload.uid) {
    return null;
  }

  const userRow = await env.DB.prepare('SELECT * FROM users WHERE id = ?')
    .bind(payload.uid)
    .first();
  if (!userRow) return null;

  return {
    userId: userRow.id,
    userRow,
    user: formatUser(userRow)
  };
}

async function loadWorkspaceForUser(db, userId) {
  const [userRes, settingsRes, tasksRes, routinesRes, reflectionsRes] = await db.batch([
    db.prepare('SELECT * FROM users WHERE id = ?').bind(userId),
    db.prepare('SELECT * FROM user_settings WHERE user_id = ?').bind(userId),
    db.prepare(
      'SELECT * FROM tasks WHERE user_id = ? ORDER BY date ASC, sort_order ASC, created_at ASC'
    ).bind(userId),
    db.prepare('SELECT * FROM routines WHERE user_id = ? ORDER BY created_at ASC').bind(userId),
    db.prepare('SELECT * FROM reflections WHERE user_id = ? ORDER BY date ASC').bind(userId)
  ]);

  const userRow = userRes?.results?.[0];
  if (!userRow) return null;

  const settingsRow = settingsRes?.results?.[0] || null;
  const tasks = (tasksRes?.results || []).map(formatTask);
  const routines = (routinesRes?.results || []).map(formatRoutine);
  const reflections = {};
  for (const row of reflectionsRes?.results || []) {
    reflections[row.date] = formatReflection(row);
  }

  return {
    user: formatUser(userRow),
    settings: formatSettings(settingsRow),
    tasks,
    routines,
    reflections
  };
}

async function fetchExistingOwners(db, table, ids) {
  const ownerMap = new Map();
  if (!ids.length) return ownerMap;

  const uniqueIds = Array.from(new Set(ids));
  for (const chunk of chunkArray(uniqueIds, D1_IN_CHUNK_SIZE)) {
    const placeholders = chunk.map(() => '?').join(', ');
    const sql = `SELECT id, user_id FROM ${table} WHERE id IN (${placeholders})`;
    const res = await db.prepare(sql).bind(...chunk).all();
    for (const row of res?.results || []) {
      ownerMap.set(row.id, row.user_id);
    }
  }
  return ownerMap;
}

function buildTaskInsertStmt(db, userId, task) {
  return db.prepare(
    `INSERT INTO tasks (
      id, user_id, title, notes, date, time_block, scheduled_time,
      estimated_minutes, actual_minutes, priority, category, status,
      subtasks_json, routine_id, sort_order, created_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    task.id,
    userId,
    task.title,
    task.notes,
    task.date,
    task.timeBlock,
    task.scheduledTime,
    task.estimatedMinutes,
    task.actualMinutes,
    task.priority,
    task.category,
    task.status,
    JSON.stringify(task.subtasks),
    task.routineId,
    task.order,
    task.createdAt,
    task.completedAt
  );
}

function buildTaskUpsertSameUserStmt(db, userId, task) {
  return db.prepare(
    `INSERT INTO tasks (
      id, user_id, title, notes, date, time_block, scheduled_time,
      estimated_minutes, actual_minutes, priority, category, status,
      subtasks_json, routine_id, sort_order, created_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      notes = excluded.notes,
      date = excluded.date,
      time_block = excluded.time_block,
      scheduled_time = excluded.scheduled_time,
      estimated_minutes = excluded.estimated_minutes,
      actual_minutes = excluded.actual_minutes,
      priority = excluded.priority,
      category = excluded.category,
      status = excluded.status,
      subtasks_json = excluded.subtasks_json,
      routine_id = excluded.routine_id,
      sort_order = excluded.sort_order,
      completed_at = excluded.completed_at
    WHERE tasks.user_id = ?`
  ).bind(
    task.id,
    userId,
    task.title,
    task.notes,
    task.date,
    task.timeBlock,
    task.scheduledTime,
    task.estimatedMinutes,
    task.actualMinutes,
    task.priority,
    task.category,
    task.status,
    JSON.stringify(task.subtasks),
    task.routineId,
    task.order,
    task.createdAt,
    task.completedAt,
    userId
  );
}

function buildRoutineUpsertSameUserStmt(db, userId, routine, createdAtIso) {
  return db.prepare(
    `INSERT INTO routines (
      id, user_id, title, category, priority, time_block,
      estimated_minutes, schedule, active, subtasks_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      category = excluded.category,
      priority = excluded.priority,
      time_block = excluded.time_block,
      estimated_minutes = excluded.estimated_minutes,
      schedule = excluded.schedule,
      active = excluded.active,
      subtasks_json = excluded.subtasks_json
    WHERE routines.user_id = ?`
  ).bind(
    routine.id,
    userId,
    routine.title,
    routine.category,
    routine.priority,
    routine.timeBlock,
    routine.estimatedMinutes,
    routine.schedule,
    routine.active ? 1 : 0,
    JSON.stringify(routine.subtasks),
    createdAtIso,
    userId
  );
}

/* ============================================================================
 * Auth Route Handlers
 * ========================================================================== */

function handleAuthStatus(request, env) {
  const url = new URL(request.url);
  return jsonResponse({
    googleConfigured: Boolean(env?.GOOGLE_CLIENT_ID && env?.GOOGLE_CLIENT_SECRET),
    telegramConfigured: Boolean(env?.TELEGRAM_BOT_TOKEN),
    telegramBotUsername: sanitizeBotUsername(env?.TELEGRAM_BOT_USERNAME),
    sessionConfigured: Boolean(env?.SESSION_SECRET),
    origin: url.origin
  });
}

async function handleGoogleAuthStart(request, env) {
  const url = new URL(request.url);
  if (!env?.GOOGLE_CLIENT_ID || !env?.GOOGLE_CLIENT_SECRET) {
    return redirectResponse(`${url.origin}/?auth_error=google_not_configured`);
  }
  if (!env?.SESSION_SECRET) {
    return redirectResponse(`${url.origin}/?auth_error=session_secret_missing`);
  }

  const codeVerifier = generateRandomBase64Url(32);
  const codeChallenge = await computePkceChallenge(codeVerifier);
  const state = generateRandomBase64Url(16);

  const oauthCookieToken = await signTokenPayload(
    {
      typ: 'oauth',
      state,
      code_verifier: codeVerifier,
      exp: Date.now() + OAUTH_TTL_SECONDS * 1000
    },
    env.SESSION_SECRET
  );

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', `${url.origin}/api/auth/google/callback`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('prompt', 'select_account');

  const headers = new Headers();
  appendOAuthCookie(headers, oauthCookieToken, url);
  return redirectResponse(authUrl.toString(), headers);
}

async function handleGoogleAuthCallback(request, env) {
  const url = new URL(request.url);
  const clearHeaders = new Headers();
  clearOAuthCookie(clearHeaders, url);

  if (!env?.DB) {
    return redirectResponse(`${url.origin}/?auth_error=database_not_configured`, clearHeaders);
  }
  if (!env?.GOOGLE_CLIENT_ID || !env?.GOOGLE_CLIENT_SECRET) {
    return redirectResponse(`${url.origin}/?auth_error=google_not_configured`, clearHeaders);
  }
  if (!env?.SESSION_SECRET) {
    return redirectResponse(`${url.origin}/?auth_error=session_secret_missing`, clearHeaders);
  }

  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    return redirectResponse(`${url.origin}/?auth_error=oauth_cancelled`, clearHeaders);
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    return redirectResponse(`${url.origin}/?auth_error=oauth_exchange_failed`, clearHeaders);
  }

  const cookies = parseCookies(request);
  const oauthCookie = cookies.get('tf_oauth');
  const oauthPayload = await verifyTokenPayload(oauthCookie, env.SESSION_SECRET, 'oauth');
  if (!oauthPayload || typeof oauthPayload.state !== 'string' || typeof oauthPayload.code_verifier !== 'string') {
    return redirectResponse(`${url.origin}/?auth_error=oauth_expired`, clearHeaders);
  }

  const stateMatches = await constantTimeEqualStrings(oauthPayload.state, state);
  if (!stateMatches) {
    return redirectResponse(`${url.origin}/?auth_error=oauth_state_mismatch`, clearHeaders);
  }

  const tokenParams = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: `${url.origin}/api/auth/google/callback`,
    grant_type: 'authorization_code',
    code_verifier: oauthPayload.code_verifier
  });

  let tokenData;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString()
    });
    if (!tokenRes.ok) {
      return redirectResponse(`${url.origin}/?auth_error=oauth_exchange_failed`, clearHeaders);
    }
    tokenData = await tokenRes.json();
  } catch {
    return redirectResponse(`${url.origin}/?auth_error=oauth_exchange_failed`, clearHeaders);
  }

  if (!tokenData?.access_token) {
    return redirectResponse(`${url.origin}/?auth_error=oauth_exchange_failed`, clearHeaders);
  }

  let profile;
  try {
    const userInfoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    if (!userInfoRes.ok) {
      return redirectResponse(`${url.origin}/?auth_error=oauth_exchange_failed`, clearHeaders);
    }
    profile = await userInfoRes.json();
  } catch {
    return redirectResponse(`${url.origin}/?auth_error=oauth_exchange_failed`, clearHeaders);
  }

  if (!profile?.sub) {
    return redirectResponse(`${url.origin}/?auth_error=oauth_exchange_failed`, clearHeaders);
  }

  const googleSub = String(profile.sub);
  const email = typeof profile.email === 'string' ? profile.email.trim() : null;
  const name = typeof profile.name === 'string' && profile.name.trim()
    ? profile.name.trim()
    : (email || 'TaskFlow User');
  const avatarUrl = typeof profile.picture === 'string' ? profile.picture.trim() : null;
  const nowIso = new Date().toISOString();

  const existingUser = await env.DB.prepare('SELECT id FROM users WHERE google_sub = ?')
    .bind(googleSub)
    .first();

  let userId;
  if (existingUser) {
    userId = existingUser.id;
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE users
         SET email = COALESCE(?, email),
             name = COALESCE(?, name),
             avatar_url = COALESCE(?, avatar_url),
             updated_at = ?
         WHERE id = ?`
      ).bind(email, name, avatarUrl, nowIso, userId),
      env.DB.prepare(
        `INSERT OR IGNORE INTO user_settings (
          user_id, daily_goal_tasks, daily_goal_minutes, sound_enabled, user_name, show_completed, updated_at
        ) VALUES (?, 5, 120, 1, ?, 1, ?)`
      ).bind(userId, name.slice(0, 60) || 'Daily Workspace', nowIso)
    ]);
  } else {
    userId = `usr_${crypto.randomUUID()}`;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (
          id, google_sub, email, name, avatar_url, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(userId, googleSub, email, name, avatarUrl, nowIso, nowIso),
      env.DB.prepare(
        `INSERT INTO user_settings (
          user_id, daily_goal_tasks, daily_goal_minutes, sound_enabled, user_name, show_completed, updated_at
        ) VALUES (?, 5, 120, 1, ?, 1, ?)`
      ).bind(userId, name.slice(0, 60) || 'Daily Workspace', nowIso)
    ]);
  }

  const sessionToken = await signTokenPayload(
    {
      typ: 'session',
      uid: userId,
      exp: Date.now() + SESSION_TTL_SECONDS * 1000
    },
    env.SESSION_SECRET
  );

  const responseHeaders = new Headers();
  clearOAuthCookie(responseHeaders, url);
  appendSessionCookie(responseHeaders, sessionToken, url);
  return redirectResponse(`${url.origin}/`, responseHeaders);
}

async function handleAuthMe(request, env) {
  const session = await authenticateRequest(request, env);
  if (!session) {
    return jsonResponse({ authenticated: false, user: null });
  }
  return jsonResponse({ authenticated: true, user: session.user });
}

function handleAuthLogout(request) {
  const url = new URL(request.url);
  const headers = new Headers();
  clearSessionCookie(headers, url);
  return jsonResponse({ ok: true }, 200, headers);
}

/* ============================================================================
 * Workspace, Settings, Tasks, Routines & Reflections Handlers
 * ========================================================================== */

async function handleGetWorkspace(session, env) {
  const workspace = await loadWorkspaceForUser(env.DB, session.userId);
  if (!workspace) {
    return errorResponse(404, 'User workspace not found', 'NOT_FOUND');
  }
  return jsonResponse(workspace);
}

async function handleImportWorkspace(request, session, env) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return errorResponse(400, parsed.error, 'VALIDATION_ERROR');
  }

  const body = parsed.data;
  const mode = body.mode === undefined ? 'merge' : body.mode;
  if (mode !== 'merge' && mode !== 'replace') {
    return errorResponse(400, 'mode must be either "merge" or "replace"', 'VALIDATION_ERROR');
  }

  const rawTasks = body.tasks === undefined ? [] : body.tasks;
  const rawRoutines = body.routines === undefined ? [] : body.routines;
  const rawReflections = body.reflections === undefined ? {} : body.reflections;

  if (!Array.isArray(rawTasks) || !Array.isArray(rawRoutines)) {
    return errorResponse(400, 'tasks and routines must be arrays', 'VALIDATION_ERROR');
  }
  if (!rawReflections || typeof rawReflections !== 'object' || Array.isArray(rawReflections)) {
    return errorResponse(400, 'reflections must be an object keyed by YYYY-MM-DD', 'VALIDATION_ERROR');
  }

  const fallbackDate = getDateKeyInTimezone(session.user.timezone);
  const normalizedRoutines = [];
  for (let i = 0; i < rawRoutines.length; i += 1) {
    const res = normalizeRoutineInput(rawRoutines[i]);
    if (!res.ok) {
      return errorResponse(400, `Invalid routine at index ${i}: ${res.error}`, 'VALIDATION_ERROR');
    }
    normalizedRoutines.push(res.routine);
  }

  const normalizedTasks = [];
  for (let i = 0; i < rawTasks.length; i += 1) {
    const res = normalizeTaskInput(rawTasks[i], null, fallbackDate);
    if (!res.ok) {
      return errorResponse(400, `Invalid task at index ${i}: ${res.error}`, 'VALIDATION_ERROR');
    }
    normalizedTasks.push(res.task);
  }

  const normalizedReflections = [];
  for (const [dateKey, entry] of Object.entries(rawReflections)) {
    if (!isValidDateKey(dateKey) || !entry || typeof entry !== 'object') {
      return errorResponse(400, `Invalid reflection entry for date "${dateKey}"`, 'VALIDATION_ERROR');
    }
    normalizedReflections.push({
      date: dateKey,
      mood: entry.mood === null || entry.mood === undefined ? null : clampInt(entry.mood, 1, 5, null),
      intention: typeof entry.intention === 'string' ? entry.intention.slice(0, 4000) : '',
      reflection: typeof entry.reflection === 'string' ? entry.reflection.slice(0, 4000) : '',
      updatedAt: typeof entry.updatedAt === 'string' && entry.updatedAt ? entry.updatedAt : new Date().toISOString()
    });
  }

  // Prevent IDOR/UNIQUE collisions when multiple users import identical local/guest IDs
  const routineOwners = await fetchExistingOwners(
    env.DB,
    'routines',
    normalizedRoutines.map((r) => r.id)
  );
  const routineIdRemap = new Map();
  for (const routine of normalizedRoutines) {
    const existingOwner = routineOwners.get(routine.id);
    if (existingOwner && existingOwner !== session.userId) {
      const remappedId = `rtn_${crypto.randomUUID()}`;
      routineIdRemap.set(routine.id, remappedId);
      routine.id = remappedId;
    }
  }

  const taskOwners = await fetchExistingOwners(
    env.DB,
    'tasks',
    normalizedTasks.map((t) => t.id)
  );
  for (const task of normalizedTasks) {
    if (task.routineId && routineIdRemap.has(task.routineId)) {
      task.routineId = routineIdRemap.get(task.routineId);
    }
    const existingOwner = taskOwners.get(task.id);
    if (existingOwner && existingOwner !== session.userId) {
      task.id = `task_${crypto.randomUUID()}`;
    }
  }

  const stmts = [];
  const nowIso = new Date().toISOString();

  if (mode === 'replace') {
    stmts.push(
      env.DB.prepare('DELETE FROM tasks WHERE user_id = ?').bind(session.userId),
      env.DB.prepare('DELETE FROM routines WHERE user_id = ?').bind(session.userId),
      env.DB.prepare('DELETE FROM reflections WHERE user_id = ?').bind(session.userId)
    );
  }

  for (const routine of normalizedRoutines) {
    stmts.push(buildRoutineUpsertSameUserStmt(env.DB, session.userId, routine, nowIso));
  }

  for (const task of normalizedTasks) {
    stmts.push(buildTaskUpsertSameUserStmt(env.DB, session.userId, task));
  }

  for (const ref of normalizedReflections) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO reflections (user_id, date, mood, intention, reflection, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, date) DO UPDATE SET
           mood = excluded.mood,
           intention = excluded.intention,
           reflection = excluded.reflection,
           updated_at = excluded.updated_at`
      ).bind(session.userId, ref.date, ref.mood, ref.intention, ref.reflection, ref.updatedAt)
    );
  }

  if (body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)) {
    const existingSettingsRow = await env.DB.prepare(
      'SELECT * FROM user_settings WHERE user_id = ?'
    ).bind(session.userId).first();
    const currentSettings = formatSettings(existingSettingsRow);
    const s = body.settings;
    const nextSettings = {
      dailyGoalTasks: s.dailyGoalTasks !== undefined
        ? clampInt(s.dailyGoalTasks, 1, 50, currentSettings.dailyGoalTasks)
        : currentSettings.dailyGoalTasks,
      dailyGoalMinutes: s.dailyGoalMinutes !== undefined
        ? clampInt(s.dailyGoalMinutes, 15, 720, currentSettings.dailyGoalMinutes)
        : currentSettings.dailyGoalMinutes,
      soundEnabled: s.soundEnabled !== undefined ? Boolean(s.soundEnabled) : currentSettings.soundEnabled,
      userName: typeof s.userName === 'string' && s.userName.trim()
        ? s.userName.trim().slice(0, 60)
        : currentSettings.userName,
      showCompleted: s.showCompleted !== undefined ? Boolean(s.showCompleted) : currentSettings.showCompleted
    };

    stmts.push(
      env.DB.prepare(
        `INSERT INTO user_settings (
          user_id, daily_goal_tasks, daily_goal_minutes, sound_enabled, user_name, show_completed, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          daily_goal_tasks = excluded.daily_goal_tasks,
          daily_goal_minutes = excluded.daily_goal_minutes,
          sound_enabled = excluded.sound_enabled,
          user_name = excluded.user_name,
          show_completed = excluded.show_completed,
          updated_at = excluded.updated_at`
      ).bind(
        session.userId,
        nextSettings.dailyGoalTasks,
        nextSettings.dailyGoalMinutes,
        nextSettings.soundEnabled ? 1 : 0,
        nextSettings.userName,
        nextSettings.showCompleted ? 1 : 0,
        nowIso
      )
    );
  }

  if (stmts.length > 0) {
    await env.DB.batch(stmts);
  }

  const workspace = await loadWorkspaceForUser(env.DB, session.userId);
  return jsonResponse({
    ok: true,
    mode,
    imported: {
      tasks: normalizedTasks.length,
      routines: normalizedRoutines.length,
      reflections: normalizedReflections.length
    },
    workspace
  });
}

async function handlePutSettings(request, session, env) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return errorResponse(400, parsed.error, 'VALIDATION_ERROR');
  }
  const body = parsed.data;

  if (body.timezone !== undefined && !isValidTimeZone(body.timezone)) {
    return errorResponse(400, 'Invalid IANA timezone identifier', 'VALIDATION_ERROR');
  }

  const [userRow, existingSettingsRow] = await Promise.all([
    env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(session.userId).first(),
    env.DB.prepare('SELECT * FROM user_settings WHERE user_id = ?').bind(session.userId).first()
  ]);
  if (!userRow) {
    return errorResponse(404, 'User not found', 'NOT_FOUND');
  }

  const curSettings = formatSettings(existingSettingsRow);
  const curUser = formatUser(userRow);
  const nowIso = new Date().toISOString();

  const nextSettings = {
    dailyGoalTasks: body.dailyGoalTasks !== undefined
      ? clampInt(body.dailyGoalTasks, 1, 50, curSettings.dailyGoalTasks)
      : curSettings.dailyGoalTasks,
    dailyGoalMinutes: body.dailyGoalMinutes !== undefined
      ? clampInt(body.dailyGoalMinutes, 15, 720, curSettings.dailyGoalMinutes)
      : curSettings.dailyGoalMinutes,
    soundEnabled: body.soundEnabled !== undefined ? Boolean(body.soundEnabled) : curSettings.soundEnabled,
    userName: typeof body.userName === 'string' && body.userName.trim()
      ? body.userName.trim().slice(0, 60)
      : curSettings.userName,
    showCompleted: body.showCompleted !== undefined ? Boolean(body.showCompleted) : curSettings.showCompleted
  };

  const nextTimezone = body.timezone !== undefined ? body.timezone.trim() : curUser.timezone;
  const nextTgEnabled = body.telegramNotificationsEnabled !== undefined
    ? Boolean(body.telegramNotificationsEnabled)
    : curUser.telegramNotificationsEnabled;
  const nextMorningHour = body.morningReminderHour !== undefined
    ? clampInt(body.morningReminderHour, 0, 23, curUser.morningReminderHour)
    : curUser.morningReminderHour;
  const nextEveningHour = body.eveningReminderHour !== undefined
    ? clampInt(body.eveningReminderHour, 0, 23, curUser.eveningReminderHour)
    : curUser.eveningReminderHour;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO user_settings (
        user_id, daily_goal_tasks, daily_goal_minutes, sound_enabled, user_name, show_completed, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        daily_goal_tasks = excluded.daily_goal_tasks,
        daily_goal_minutes = excluded.daily_goal_minutes,
        sound_enabled = excluded.sound_enabled,
        user_name = excluded.user_name,
        show_completed = excluded.show_completed,
        updated_at = excluded.updated_at`
    ).bind(
      session.userId,
      nextSettings.dailyGoalTasks,
      nextSettings.dailyGoalMinutes,
      nextSettings.soundEnabled ? 1 : 0,
      nextSettings.userName,
      nextSettings.showCompleted ? 1 : 0,
      nowIso
    ),
    env.DB.prepare(
      `UPDATE users
       SET timezone = ?,
           telegram_notifications_enabled = ?,
           morning_reminder_hour = ?,
           evening_reminder_hour = ?,
           updated_at = ?
       WHERE id = ?`
    ).bind(
      nextTimezone,
      nextTgEnabled ? 1 : 0,
      nextMorningHour,
      nextEveningHour,
      nowIso,
      session.userId
    )
  ]);

  const updatedUserRow = await env.DB.prepare('SELECT * FROM users WHERE id = ?')
    .bind(session.userId)
    .first();

  return jsonResponse({
    ok: true,
    settings: nextSettings,
    user: formatUser(updatedUserRow)
  });
}

async function handleCreateTask(request, session, env) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return errorResponse(400, parsed.error, 'VALIDATION_ERROR');
  }

  const body = parsed.data;
  const defaultDate = getDateKeyInTimezone(session.user.timezone);
  const normalized = normalizeTaskInput(body, null, defaultDate);
  if (!normalized.ok) {
    return errorResponse(400, normalized.error, 'VALIDATION_ERROR');
  }
  const task = normalized.task;

  const existing = await env.DB.prepare('SELECT user_id FROM tasks WHERE id = ?')
    .bind(task.id)
    .first();
  if (existing && existing.user_id !== session.userId) {
    return errorResponse(409, 'Task ID conflicts with an existing record', 'CONFLICT');
  }

  if (body.order === undefined && !existing) {
    const maxRow = await env.DB.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM tasks WHERE user_id = ? AND date = ?'
    ).bind(session.userId, task.date).first();
    task.order = Number(maxRow?.max_order ?? -1) + 1;
  }

  if (existing) {
    await buildTaskUpsertSameUserStmt(env.DB, session.userId, task).run();
    return jsonResponse({ ok: true, task }, 200);
  }

  await buildTaskInsertStmt(env.DB, session.userId, task).run();
  return jsonResponse({ ok: true, task }, 201);
}

async function handlePatchTask(taskId, request, session, env) {
  const existingRow = await env.DB.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?')
    .bind(taskId, session.userId)
    .first();
  if (!existingRow) {
    return errorResponse(404, 'Task not found', 'NOT_FOUND');
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return errorResponse(400, parsed.error, 'VALIDATION_ERROR');
  }

  const existingTask = formatTask(existingRow);
  const normalized = normalizeTaskInput(parsed.data, existingTask, existingTask.date);
  if (!normalized.ok) {
    return errorResponse(400, normalized.error, 'VALIDATION_ERROR');
  }
  const task = normalized.task;

  await env.DB.prepare(
    `UPDATE tasks
     SET title = ?,
         notes = ?,
         date = ?,
         time_block = ?,
         scheduled_time = ?,
         estimated_minutes = ?,
         actual_minutes = ?,
         priority = ?,
         category = ?,
         status = ?,
         subtasks_json = ?,
         routine_id = ?,
         sort_order = ?,
         completed_at = ?
     WHERE id = ? AND user_id = ?`
  ).bind(
    task.title,
    task.notes,
    task.date,
    task.timeBlock,
    task.scheduledTime,
    task.estimatedMinutes,
    task.actualMinutes,
    task.priority,
    task.category,
    task.status,
    JSON.stringify(task.subtasks),
    task.routineId,
    task.order,
    task.completedAt,
    taskId,
    session.userId
  ).run();

  return jsonResponse({ ok: true, task });
}

async function handleDeleteTask(taskId, session, env) {
  const result = await env.DB.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?')
    .bind(taskId, session.userId)
    .run();
  if (!result?.meta?.changes) {
    return errorResponse(404, 'Task not found', 'NOT_FOUND');
  }
  return jsonResponse({ ok: true, id: taskId });
}

async function handleBatchTasks(request, session, env) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return errorResponse(400, parsed.error, 'VALIDATION_ERROR');
  }

  const body = parsed.data;
  const action = body.action;

  if (action === 'upsertMany') {
    if (!Array.isArray(body.tasks)) {
      return errorResponse(400, 'tasks must be an array', 'VALIDATION_ERROR');
    }
    if (body.tasks.length === 0) {
      return jsonResponse({ ok: true, tasks: [] });
    }

    const defaultDate = getDateKeyInTimezone(session.user.timezone);
    const normalizedTasks = [];
    for (let i = 0; i < body.tasks.length; i += 1) {
      const res = normalizeTaskInput(body.tasks[i], null, defaultDate);
      if (!res.ok) {
        return errorResponse(400, `Invalid task at index ${i}: ${res.error}`, 'VALIDATION_ERROR');
      }
      normalizedTasks.push(res.task);
    }

    const owners = await fetchExistingOwners(env.DB, 'tasks', normalizedTasks.map((t) => t.id));
    for (const task of normalizedTasks) {
      const owner = owners.get(task.id);
      if (owner && owner !== session.userId) {
        return errorResponse(409, `Task ID "${task.id}" belongs to another account`, 'CONFLICT');
      }
    }

    await env.DB.batch(
      normalizedTasks.map((task) => buildTaskUpsertSameUserStmt(env.DB, session.userId, task))
    );
    return jsonResponse({ ok: true, tasks: normalizedTasks });
  }

  if (action === 'deleteMany') {
    if (!Array.isArray(body.ids)) {
      return errorResponse(400, 'ids must be an array', 'VALIDATION_ERROR');
    }
    const ids = body.ids.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim());
    if (ids.length === 0) {
      return jsonResponse({ ok: true, deleted: 0 });
    }

    const results = await env.DB.batch(
      ids.map((id) => env.DB.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').bind(id, session.userId))
    );
    const deleted = results.reduce((sum, r) => sum + (Number(r?.meta?.changes) || 0), 0);
    return jsonResponse({ ok: true, deleted });
  }

  if (action === 'reorder') {
    if (!Array.isArray(body.updates)) {
      return errorResponse(400, 'updates must be an array', 'VALIDATION_ERROR');
    }
    if (body.updates.length === 0) {
      return jsonResponse({ ok: true, count: 0 });
    }

    const stmts = [];
    for (let i = 0; i < body.updates.length; i += 1) {
      const u = body.updates[i];
      if (!u || typeof u !== 'object' || typeof u.id !== 'string' || !u.id.trim()) {
        return errorResponse(400, `Invalid reorder entry at index ${i}`, 'VALIDATION_ERROR');
      }
      if (!Number.isFinite(Number(u.order))) {
        return errorResponse(400, `Invalid order at index ${i}`, 'VALIDATION_ERROR');
      }
      if (u.date !== undefined && !isValidDateKey(u.date)) {
        return errorResponse(400, `Invalid date at index ${i}`, 'VALIDATION_ERROR');
      }
      const nextBlock = u.timeBlock !== undefined && VALID_TIME_BLOCKS.has(u.timeBlock)
        ? u.timeBlock
        : null;
      const nextDate = u.date !== undefined ? u.date : null;

      stmts.push(
        env.DB.prepare(
          `UPDATE tasks
           SET sort_order = ?,
               time_block = COALESCE(?, time_block),
               date = COALESCE(?, date)
           WHERE id = ? AND user_id = ?`
        ).bind(Math.round(Number(u.order)), nextBlock, nextDate, u.id.trim(), session.userId)
      );
    }

    const results = await env.DB.batch(stmts);
    const count = results.reduce((sum, r) => sum + (Number(r?.meta?.changes) || 0), 0);
    return jsonResponse({ ok: true, count });
  }

  return errorResponse(400, 'action must be "upsertMany", "deleteMany", or "reorder"', 'VALIDATION_ERROR');
}

async function handleCreateRoutine(request, session, env) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return errorResponse(400, parsed.error, 'VALIDATION_ERROR');
  }

  const normalized = normalizeRoutineInput(parsed.data);
  if (!normalized.ok) {
    return errorResponse(400, normalized.error, 'VALIDATION_ERROR');
  }
  const routine = normalized.routine;

  const existing = await env.DB.prepare('SELECT user_id FROM routines WHERE id = ?')
    .bind(routine.id)
    .first();
  if (existing && existing.user_id !== session.userId) {
    return errorResponse(409, 'Routine ID conflicts with an existing record', 'CONFLICT');
  }

  const nowIso = new Date().toISOString();
  await buildRoutineUpsertSameUserStmt(env.DB, session.userId, routine, nowIso).run();
  return jsonResponse({ ok: true, routine }, existing ? 200 : 201);
}

async function handlePatchRoutine(routineId, request, session, env) {
  const existingRow = await env.DB.prepare('SELECT * FROM routines WHERE id = ? AND user_id = ?')
    .bind(routineId, session.userId)
    .first();
  if (!existingRow) {
    return errorResponse(404, 'Routine not found', 'NOT_FOUND');
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return errorResponse(400, parsed.error, 'VALIDATION_ERROR');
  }

  const existingRoutine = formatRoutine(existingRow);
  const normalized = normalizeRoutineInput(parsed.data, existingRoutine);
  if (!normalized.ok) {
    return errorResponse(400, normalized.error, 'VALIDATION_ERROR');
  }
  const routine = normalized.routine;

  await env.DB.prepare(
    `UPDATE routines
     SET title = ?,
         category = ?,
         priority = ?,
         time_block = ?,
         estimated_minutes = ?,
         schedule = ?,
         active = ?,
         subtasks_json = ?
     WHERE id = ? AND user_id = ?`
  ).bind(
    routine.title,
    routine.category,
    routine.priority,
    routine.timeBlock,
    routine.estimatedMinutes,
    routine.schedule,
    routine.active ? 1 : 0,
    JSON.stringify(routine.subtasks),
    routineId,
    session.userId
  ).run();

  return jsonResponse({ ok: true, routine });
}

async function handleDeleteRoutine(routineId, session, env) {
  const result = await env.DB.prepare('DELETE FROM routines WHERE id = ? AND user_id = ?')
    .bind(routineId, session.userId)
    .run();
  if (!result?.meta?.changes) {
    return errorResponse(404, 'Routine not found', 'NOT_FOUND');
  }
  return jsonResponse({ ok: true, id: routineId });
}

async function handlePutReflection(dateKey, request, session, env) {
  if (!isValidDateKey(dateKey)) {
    return errorResponse(400, 'Reflection date must be a valid YYYY-MM-DD calendar date', 'VALIDATION_ERROR');
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return errorResponse(400, parsed.error, 'VALIDATION_ERROR');
  }

  const existing = await env.DB.prepare(
    'SELECT * FROM reflections WHERE user_id = ? AND date = ?'
  ).bind(session.userId, dateKey).first();

  const body = parsed.data;
  const mood = body.mood !== undefined
    ? (body.mood === null ? null : clampInt(body.mood, 1, 5, null))
    : (existing?.mood ?? null);
  const intention = body.intention !== undefined
    ? (typeof body.intention === 'string' ? body.intention.slice(0, 4000) : '')
    : (existing?.intention ?? '');
  const reflectionText = body.reflection !== undefined
    ? (typeof body.reflection === 'string' ? body.reflection.slice(0, 4000) : '')
    : (existing?.reflection ?? '');
  const updatedAt = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO reflections (user_id, date, mood, intention, reflection, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET
       mood = excluded.mood,
       intention = excluded.intention,
       reflection = excluded.reflection,
       updated_at = excluded.updated_at`
  ).bind(session.userId, dateKey, mood, intention, reflectionText, updatedAt).run();

  return jsonResponse({
    ok: true,
    date: dateKey,
    reflection: {
      mood,
      intention,
      reflection: reflectionText,
      updatedAt
    }
  });
}

/* ============================================================================
 * Telegram Helpers & Route Handlers
 * ========================================================================== */

async function sendTelegramMessage(botToken, chatId, text) {
  if (!botToken) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN is not configured' };
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { ok: false, status: response.status, error: detail || `Telegram HTTP ${response.status}` };
    }
    const payload = await response.json().catch(() => ({ ok: true }));
    return { ok: true, payload };
  } catch (err) {
    return { ok: false, error: err?.message || 'Telegram network error' };
  }
}

function buildTodaySummaryMessage(userRow, dateKey, tasks, settingsRow) {
  const goalTasks = clampInt(settingsRow?.daily_goal_tasks, 1, 50, 5);
  const goalMinutes = clampInt(settingsRow?.daily_goal_minutes, 15, 720, 120);
  const total = tasks.length;
  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const actualMinutes = tasks.reduce((sum, t) => sum + (Number(t.actual_minutes) || 0), 0);
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  const lines = [
    `📋 <b>Tasks for ${escapeHtml(dateKey)}</b>`,
    `👤 ${escapeHtml(userRow.name || userRow.email || 'TaskFlow Cabinet')}`,
    `✅ Progress: <b>${doneCount}/${total}</b> (${pct}%) • Goal: <b>${doneCount}/${goalTasks}</b>`,
    `⏱️ Focus: <b>${formatMinutes(actualMinutes)}</b> / ${formatMinutes(goalMinutes)}`,
    ''
  ];

  if (tasks.length === 0) {
    lines.push('No tasks scheduled for this date yet.');
    lines.push('Send <code>/add Task title</code> to add one right now.');
  } else {
    tasks.forEach((task, idx) => {
      const icon = task.status === 'done'
        ? '✅'
        : (task.status === 'in_progress' ? '⏳' : '⬜');
      const pri = task.priority === 'high' ? ' 🔴' : '';
      const timeHint = task.scheduled_time ? ` <i>(${escapeHtml(task.scheduled_time)})</i>` : '';
      lines.push(`${idx + 1}. ${icon} ${escapeHtml(task.title)}${timeHint}${pri}`);
    });
    lines.push('');
    lines.push('Send <code>/done &lt;number&gt;</code> to mark a task complete.');
  }

  return lines.join('\n');
}

async function computeUserStatsMessage(db, userRow, todayDateKey) {
  const start7d = addDaysToDateKey(todayDateKey, -6);
  const lookbackStart = addDaysToDateKey(todayDateKey, -89);

  const [settingsRow, tasksRes] = await db.batch([
    db.prepare('SELECT * FROM user_settings WHERE user_id = ?').bind(userRow.id),
    db.prepare(
      'SELECT date, status, actual_minutes FROM tasks WHERE user_id = ? AND date >= ? AND date <= ?'
    ).bind(userRow.id, lookbackStart, todayDateKey)
  ]);

  const settings = settingsRow?.results?.[0];
  const goalTasks = clampInt(settings?.daily_goal_tasks, 1, 50, 5);
  const rows = tasksRes?.results || [];

  let todayTotal = 0;
  let todayDone = 0;
  let todayFocus = 0;
  let weekTotal = 0;
  let weekDone = 0;
  let weekFocus = 0;
  const doneByDate = new Set();

  for (const row of rows) {
    const mins = Number(row.actual_minutes) || 0;
    if (row.date === todayDateKey) {
      todayTotal += 1;
      todayFocus += mins;
      if (row.status === 'done') todayDone += 1;
    }
    if (row.date >= start7d) {
      weekTotal += 1;
      weekFocus += mins;
      if (row.status === 'done') weekDone += 1;
    }
    if (row.status === 'done') {
      doneByDate.add(row.date);
    }
  }

  let currentStreak = 0;
  let cursor = doneByDate.has(todayDateKey) ? todayDateKey : addDaysToDateKey(todayDateKey, -1);
  while (doneByDate.has(cursor)) {
    currentStreak += 1;
    cursor = addDaysToDateKey(cursor, -1);
  }

  const todayPct = todayTotal > 0 ? Math.round((todayDone / todayTotal) * 100) : 0;
  const weekPct = weekTotal > 0 ? Math.round((weekDone / weekTotal) * 100) : 0;

  return [
    `📊 <b>TaskFlow Stats</b> (${escapeHtml(userRow.timezone || DEFAULT_TIMEZONE)})`,
    '',
    `📅 <b>Today (${escapeHtml(todayDateKey)}):</b>`,
    `• Completed: <b>${todayDone}/${todayTotal}</b> (${todayPct}%) • Goal: ${todayDone}/${goalTasks}`,
    `• Focus logged: <b>${formatMinutes(todayFocus)}</b>`,
    '',
    `📈 <b>Last 7 Days:</b>`,
    `• Completed: <b>${weekDone}/${weekTotal}</b> (${weekPct}%)`,
    `• Total focus: <b>${formatMinutes(weekFocus)}</b>`,
    `🔥 <b>Current streak:</b> ${currentStreak} day(s)`
  ].join('\n');
}

async function handleTelegramLinkCode(session, env) {
  const code = generatePairingCode(8);
  const expiresAt = Date.now() + LINK_CODE_TTL_MS;

  await env.DB.batch([
    env.DB.prepare('DELETE FROM telegram_link_codes WHERE user_id = ? OR expires_at < ?')
      .bind(session.userId, Date.now()),
    env.DB.prepare('INSERT INTO telegram_link_codes (code, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(code, session.userId, expiresAt)
  ]);

  const botUsername = sanitizeBotUsername(env?.TELEGRAM_BOT_USERNAME);
  const deepLink = botUsername ? `https://t.me/${botUsername}?start=link_${code}` : null;

  return jsonResponse({
    code,
    botUsername,
    deepLink,
    expiresAt
  });
}

async function handleTelegramUnlink(session, env) {
  const nowIso = new Date().toISOString();
  await env.DB.prepare(
    'UPDATE users SET telegram_chat_id = NULL, telegram_username = NULL, updated_at = ? WHERE id = ?'
  ).bind(nowIso, session.userId).run();
  return jsonResponse({ ok: true });
}

async function handleTelegramSendSummary(request, session, env) {
  if (!env?.TELEGRAM_BOT_TOKEN) {
    return errorResponse(503, 'Telegram bot token is not configured', 'TELEGRAM_NOT_CONFIGURED');
  }

  const parsed = await readOptionalJsonBody(request);
  if (!parsed.ok) {
    return errorResponse(400, parsed.error, 'VALIDATION_ERROR');
  }

  const userRow = session.userRow;
  if (!userRow.telegram_chat_id) {
    return errorResponse(400, 'Telegram account is not linked yet', 'TELEGRAM_NOT_LINKED');
  }

  const targetDate = isValidDateKey(parsed.data.date)
    ? parsed.data.date
    : getDateKeyInTimezone(userRow.timezone || DEFAULT_TIMEZONE);

  const [tasksRes, settingsRes] = await env.DB.batch([
    env.DB.prepare(
      'SELECT * FROM tasks WHERE user_id = ? AND date = ? ORDER BY sort_order ASC, created_at ASC'
    ).bind(session.userId, targetDate),
    env.DB.prepare('SELECT * FROM user_settings WHERE user_id = ?').bind(session.userId)
  ]);

  const text = buildTodaySummaryMessage(
    userRow,
    targetDate,
    tasksRes?.results || [],
    settingsRes?.results?.[0] || null
  );

  const sent = await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, userRow.telegram_chat_id, text);
  if (!sent.ok) {
    return errorResponse(502, 'Failed to send summary to Telegram', 'TELEGRAM_API_ERROR', sent.error);
  }

  return jsonResponse({
    ok: true,
    date: targetDate,
    sentAt: new Date().toISOString()
  });
}

async function processTelegramWebhookUpdate(update, env) {
  const message = update?.message || update?.edited_message;
  const chatIdRaw = message?.chat?.id;
  const rawText = typeof message?.text === 'string' ? message.text.trim() : '';
  if (chatIdRaw === undefined || chatIdRaw === null || !rawText) {
    return;
  }

  const chatId = String(chatIdRaw);
  const tgUsername = typeof message?.from?.username === 'string' && message.from.username.trim()
    ? message.from.username.trim()
    : null;

  const firstSpace = rawText.search(/\s/);
  const rawCommand = (firstSpace === -1 ? rawText : rawText.slice(0, firstSpace)).toLowerCase();
  const cmd = rawCommand.split('@')[0];
  const arg = firstSpace === -1 ? '' : rawText.slice(firstSpace + 1).trim();

  let linkCodeToApply = null;
  if (cmd === '/start' && arg.toLowerCase().startsWith('link_')) {
    linkCodeToApply = arg.slice(5).trim().toUpperCase();
  } else if (cmd === '/link') {
    linkCodeToApply = arg.trim().toUpperCase();
  }

  if (cmd === '/link' || linkCodeToApply !== null) {
    if (!linkCodeToApply) {
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        'Please include your pairing code: <code>/link ABCDEF12</code>'
      );
      return;
    }

    const codeRow = await env.DB.prepare('SELECT * FROM telegram_link_codes WHERE code = ?')
      .bind(linkCodeToApply)
      .first();
    if (!codeRow || Number(codeRow.expires_at) <= Date.now()) {
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        '❌ That pairing code is invalid or expired. Generate a fresh code in TaskFlow → Account Cabinet → Telegram.'
      );
      return;
    }

    const nowIso = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        'UPDATE users SET telegram_chat_id = NULL, telegram_username = NULL, updated_at = ? WHERE telegram_chat_id = ? AND id != ?'
      ).bind(nowIso, chatId, codeRow.user_id),
      env.DB.prepare(
        'UPDATE users SET telegram_chat_id = ?, telegram_username = ?, updated_at = ? WHERE id = ?'
      ).bind(chatId, tgUsername, nowIso, codeRow.user_id),
      env.DB.prepare('DELETE FROM telegram_link_codes WHERE code = ?').bind(linkCodeToApply)
    ]);

    const linkedUser = await env.DB.prepare('SELECT name, email FROM users WHERE id = ?')
      .bind(codeRow.user_id)
      .first();
    const label = escapeHtml(linkedUser?.name || linkedUser?.email || 'your TaskFlow cabinet');

    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `✅ Connected to <b>${label}</b>!\n\nTry:\n• <code>/today</code> — view today's tasks\n• <code>/add Task title</code> — add a task\n• <code>/done 1</code> — complete task #1\n• <code>/stats</code> — progress & streak\n• <code>/help</code> — all commands`
    );
    return;
  }

  const userRow = await env.DB.prepare('SELECT * FROM users WHERE telegram_chat_id = ?')
    .bind(chatId)
    .first();

  if (cmd === '/start') {
    if (userRow) {
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        `👋 Welcome back, <b>${escapeHtml(userRow.name || userRow.email || 'there')}</b>!\n\nCommands:\n• <code>/today</code> — today's agenda\n• <code>/add &lt;title&gt;</code> — quick add\n• <code>/done &lt;n&gt;</code> — mark task done\n• <code>/stats</code> — streak & focus stats\n• <code>/help</code> — command list`
      );
    } else {
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        '👋 Welcome to <b>TaskFlow</b>!\n\nTo link your personal Google cabinet:\n1. Sign in to TaskFlow on the web\n2. Open <b>Account Cabinet → Telegram</b>\n3. Click <b>Generate Pairing Code</b> and send <code>/link CODE</code> here.'
      );
    }
    return;
  }

  if (cmd === '/help') {
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `🛠 <b>TaskFlow Bot Commands</b>\n\n• <code>/today</code> — list today's tasks & progress\n• <code>/add &lt;title&gt;</code> — add a task for today\n• <code>/done &lt;n&gt;</code> — mark today's task #n as done\n• <code>/stats</code> — today, 7-day, and streak stats\n• <code>/link &lt;CODE&gt;</code> — link your Google cabinet\n• <code>/help</code> — show this message`
    );
    return;
  }

  if (!userRow) {
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '🔗 This chat is not linked to a TaskFlow cabinet yet.\nOpen TaskFlow → Account Cabinet → Telegram to generate a pairing code, then send <code>/link CODE</code>.'
    );
    return;
  }

  const todayKey = getDateKeyInTimezone(userRow.timezone || DEFAULT_TIMEZONE);

  if (cmd === '/today') {
    const [tasksRes, settingsRes] = await env.DB.batch([
      env.DB.prepare(
        'SELECT * FROM tasks WHERE user_id = ? AND date = ? ORDER BY sort_order ASC, created_at ASC'
      ).bind(userRow.id, todayKey),
      env.DB.prepare('SELECT * FROM user_settings WHERE user_id = ?').bind(userRow.id)
    ]);
    const text = buildTodaySummaryMessage(
      userRow,
      todayKey,
      tasksRes?.results || [],
      settingsRes?.results?.[0] || null
    );
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text);
    return;
  }

  if (cmd === '/add') {
    if (!arg) {
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        'Usage: <code>/add Finalize quarterly report</code>'
      );
      return;
    }

    const title = arg.slice(0, 500);
    const maxRow = await env.DB.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM tasks WHERE user_id = ? AND date = ?'
    ).bind(userRow.id, todayKey).first();
    const nextOrder = Number(maxRow?.max_order ?? -1) + 1;
    const nowIso = new Date().toISOString();

    const task = {
      id: `task_${crypto.randomUUID()}`,
      title,
      notes: '',
      date: todayKey,
      timeBlock: 'anytime',
      scheduledTime: '',
      estimatedMinutes: 30,
      actualMinutes: 0,
      priority: 'medium',
      category: 'work',
      status: 'todo',
      subtasks: [],
      routineId: null,
      order: nextOrder,
      createdAt: nowIso,
      completedAt: null
    };

    await buildTaskInsertStmt(env.DB, userRow.id, task).run();
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `✅ Added to <code>${escapeHtml(todayKey)}</code>:\n<b>${escapeHtml(title)}</b>\n\nSend <code>/today</code> to see your full list.`
    );
    return;
  }

  if (cmd === '/done') {
    const cleanNum = arg.replace(/^#/, '').trim();
    const idx = parseInt(cleanNum, 10);
    if (!Number.isFinite(idx) || idx < 1 || !/^\d+$/.test(cleanNum)) {
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        'Usage: <code>/done 1</code> (use the task number from <code>/today</code>)'
      );
      return;
    }

    const tasksRes = await env.DB.prepare(
      'SELECT * FROM tasks WHERE user_id = ? AND date = ? ORDER BY sort_order ASC, created_at ASC'
    ).bind(userRow.id, todayKey).all();
    const tasks = tasksRes?.results || [];

    if (idx > tasks.length) {
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        `Task #${idx} not found. Today has ${tasks.length} task(s) — send <code>/today</code> to inspect.`
      );
      return;
    }

    const target = tasks[idx - 1];
    const nowIso = new Date().toISOString();
    if (target.status !== 'done') {
      await env.DB.prepare(
        `UPDATE tasks
         SET status = 'done',
             completed_at = COALESCE(completed_at, ?)
         WHERE id = ? AND user_id = ?`
      ).bind(nowIso, target.id, userRow.id).run();
    }

    const doneCount = tasks.filter((t, i) => i === idx - 1 || t.status === 'done').length;
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `🎉 Completed #${idx}: <b>${escapeHtml(target.title)}</b>\nToday's progress: <b>${doneCount}/${tasks.length}</b>`
    );
    return;
  }

  if (cmd === '/stats') {
    const msg = await computeUserStatsMessage(env.DB, userRow, todayKey);
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
    return;
  }

  await sendTelegramMessage(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    `Unknown command. Send <code>/help</code> to see available commands.`
  );
}

async function handleTelegramWebhook(request, env, ctx) {
  if (env?.TELEGRAM_WEBHOOK_SECRET) {
    const providedSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
    const secretOk = providedSecret.length > 0
      && (await constantTimeEqualStrings(env.TELEGRAM_WEBHOOK_SECRET, providedSecret));
    if (!secretOk) {
      return errorResponse(401, 'Invalid webhook secret token', 'UNAUTHORIZED');
    }
  }

  const parsed = await readOptionalJsonBody(request);
  if (!parsed.ok) {
    return errorResponse(400, parsed.error, 'INVALID_JSON');
  }

  const work = processTelegramWebhookUpdate(parsed.data, env).catch((err) => {
    console.error('Telegram webhook processing error:', err);
  });

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(work);
  } else {
    await work;
  }

  return jsonResponse({ ok: true });
}

async function verifyTelegramMiniAppInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hashHex = params.get('hash');
  if (!hashHex) return { ok: false, reason: 'missing_hash' };

  const hashBytes = hexToBytes(hashHex);
  if (!hashBytes || hashBytes.length !== 32) {
    return { ok: false, reason: 'invalid_hash_format' };
  }

  const authDate = Number(params.get('auth_date'));
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authDate) || authDate <= 0 || nowSec - authDate > MINIAPP_AUTH_MAX_AGE_SECONDS) {
    return { ok: false, reason: 'expired_auth_date' };
  }

  params.delete('hash');
  const entries = Array.from(params.entries()).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

  const webAppKey = await importHmacKey(textEncoder.encode('WebAppData'), ['sign']);
  const secretKeyBytes = await crypto.subtle.sign('HMAC', webAppKey, textEncoder.encode(botToken));
  const dataVerifyKey = await importHmacKey(secretKeyBytes, ['verify']);

  const verified = await crypto.subtle.verify(
    'HMAC',
    dataVerifyKey,
    hashBytes,
    textEncoder.encode(dataCheckString)
  );
  if (!verified) {
    return { ok: false, reason: 'invalid_signature' };
  }

  const rawUser = params.get('user');
  if (!rawUser) {
    return { ok: false, reason: 'missing_user' };
  }
  try {
    const tgUser = JSON.parse(rawUser);
    if (!tgUser || (tgUser.id === undefined || tgUser.id === null)) {
      return { ok: false, reason: 'invalid_user' };
    }
    return { ok: true, tgUser };
  } catch {
    return { ok: false, reason: 'invalid_user_json' };
  }
}

async function handleTelegramMiniAppAuth(request, env) {
  if (!env?.TELEGRAM_BOT_TOKEN) {
    return errorResponse(503, 'Telegram bot token is not configured', 'TELEGRAM_NOT_CONFIGURED');
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return errorResponse(400, parsed.error, 'VALIDATION_ERROR');
  }
  const initData = parsed.data.initData;
  if (typeof initData !== 'string' || !initData.trim()) {
    return errorResponse(400, 'initData is required', 'VALIDATION_ERROR');
  }

  const verification = await verifyTelegramMiniAppInitData(initData, env.TELEGRAM_BOT_TOKEN);
  if (!verification.ok) {
    return errorResponse(401, 'Invalid Telegram Mini App authentication data', 'INVALID_INIT_DATA');
  }

  const tgUser = verification.tgUser;
  const telegramUser = {
    id: String(tgUser.id),
    username: tgUser.username || null,
    firstName: tgUser.first_name || '',
    first_name: tgUser.first_name || '',
    lastName: tgUser.last_name || '',
    last_name: tgUser.last_name || '',
    photoUrl: tgUser.photo_url || null
  };

  const userRow = await env.DB.prepare('SELECT * FROM users WHERE telegram_chat_id = ?')
    .bind(telegramUser.id)
    .first();

  if (!userRow) {
    return jsonResponse({
      ok: true,
      linked: false,
      telegramUser
    });
  }

  if (!env?.SESSION_SECRET) {
    return errorResponse(500, 'Session secret is not configured', 'SESSION_SECRET_MISSING');
  }

  const url = new URL(request.url);
  const sessionToken = await signTokenPayload(
    {
      typ: 'session',
      uid: userRow.id,
      exp: Date.now() + SESSION_TTL_SECONDS * 1000
    },
    env.SESSION_SECRET
  );

  const headers = new Headers();
  appendSessionCookie(headers, sessionToken, url);

  return jsonResponse(
    {
      ok: true,
      linked: true,
      user: formatUser(userRow),
      telegramUser
    },
    200,
    headers
  );
}

/* ============================================================================
 * Main Router & Cloudflare Pages Entrypoints
 * ========================================================================== */

export async function handleApiRequest(request, env, ctx) {
  try {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const rawPath = url.pathname.replace(/\/+$/, '') || '/';
    const segments = rawPath.split('/').filter(Boolean).map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });

    if (segments[0] !== 'api') {
      return errorResponse(404, 'API route not found', 'NOT_FOUND');
    }

    // Public auth & status endpoints
    if (segments.length === 3 && segments[1] === 'auth' && segments[2] === 'status') {
      if (method !== 'GET') return errorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
      return handleAuthStatus(request, env);
    }

    if (segments.length === 3 && segments[1] === 'auth' && segments[2] === 'google') {
      if (method !== 'GET') return errorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
      return handleGoogleAuthStart(request, env);
    }

    if (segments.length === 4 && segments[1] === 'auth' && segments[2] === 'google' && segments[3] === 'callback') {
      if (method !== 'GET') return errorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
      return handleGoogleAuthCallback(request, env);
    }

    if (segments.length === 3 && segments[1] === 'auth' && segments[2] === 'logout') {
      if (method !== 'POST') return errorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
      return handleAuthLogout(request);
    }

    // All remaining routes require D1 binding
    if (!env?.DB) {
      return errorResponse(500, 'D1 database binding (DB) is not configured', 'DB_NOT_CONFIGURED');
    }

    if (segments.length === 3 && segments[1] === 'auth' && segments[2] === 'me') {
      if (method !== 'GET') return errorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
      return handleAuthMe(request, env);
    }

    // Public Telegram webhook & Mini App endpoints (signature-verified)
    if (segments.length === 3 && segments[1] === 'telegram' && segments[2] === 'webhook') {
      if (method !== 'POST') return errorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
      return handleTelegramWebhook(request, env, ctx);
    }

    if (segments.length === 3 && segments[1] === 'telegram' && segments[2] === 'miniapp-auth') {
      if (method !== 'POST') return errorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
      return handleTelegramMiniAppAuth(request, env);
    }

    // Authenticated user cabinet endpoints
    const session = await authenticateRequest(request, env);
    if (!session) {
      return errorResponse(401, 'Authentication required', 'UNAUTHORIZED');
    }

    if (segments.length === 2 && segments[1] === 'workspace') {
      if (method !== 'GET') return errorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
      return handleGetWorkspace(session, env);
    }

    if (segments.length === 3 && segments[1] === 'workspace' && segments[2] === 'import') {
      if (method !== 'POST') return errorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
      return handleImportWorkspace(request, session, env);
    }

    if (segments.length === 2 && segments[1] === 'settings') {
      if (method !== 'PUT') return errorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
      return handlePutSettings(request, session, env);
    }

    if (segments.length === 3 && segments[1] === 'tasks' && segments[2] === 'batch') {
      if (method !== 'POST') return errorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
      return handleBatchTasks(request, session, env);
    }

    if (segments.length === 2 && segments[1] === 'tasks') {
      if (method !== 'POST') return errorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
      return handleCreateTask(request, session, env);
    }

    if (segments.length === 3 && segments[1] === 'tasks') {
      const taskId = segments[2];
      if (method === 'PATCH') return handlePatchTask(taskId, request, session, env);
      if (method === 'DELETE') return handleDeleteTask(taskId, session, env);
      return errorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
    }

    if (segments.length === 2 && segments[1] === 'routines') {
      if (method !== 'POST') return errorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
      return handleCreateRoutine(request, session, env);
    }

    if (segments.length === 3 && segments[1] === 'routines') {
      const routineId = segments[2];
      if (method === 'PATCH') return handlePatchRoutine(routineId, request, session, env);
      if (method === 'DELETE') return handleDeleteRoutine(routineId, session, env);
      return errorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
    }

    if (segments.length === 3 && segments[1] === 'reflections') {
      if (method !== 'PUT') return errorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
      return handlePutReflection(segments[2], request, session, env);
    }

    if (segments.length === 3 && segments[1] === 'telegram' && segments[2] === 'link-code') {
      if (method !== 'POST') return errorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
      return handleTelegramLinkCode(session, env);
    }

    if (segments.length === 3 && segments[1] === 'telegram' && segments[2] === 'unlink') {
      if (method !== 'POST') return errorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
      return handleTelegramUnlink(session, env);
    }

    if (segments.length === 3 && segments[1] === 'telegram' && segments[2] === 'send-summary') {
      if (method !== 'POST') return errorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
      return handleTelegramSendSummary(request, session, env);
    }

    return errorResponse(404, 'API route not found', 'NOT_FOUND');
  } catch (err) {
    console.error('Unhandled API error:', err);
    return errorResponse(500, 'Internal server error', 'INTERNAL_ERROR');
  }
}

export function createHandler() {
  return (request, env, ctx) => handleApiRequest(request, env, ctx);
}

export async function onRequest(context) {
  const ctx = typeof context?.waitUntil === 'function'
    ? { waitUntil: (promise) => context.waitUntil(promise) }
    : undefined;
  return handleApiRequest(context.request, context.env, ctx);
}
