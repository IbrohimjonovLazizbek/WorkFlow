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
      showCompleted: true,
      theme: 'light'
    };
  }
  return {
    dailyGoalTasks: clampInt(row.daily_goal_tasks, 1, 50, 5),
    dailyGoalMinutes: clampInt(row.daily_goal_minutes, 15, 720, 120),
    soundEnabled: Boolean(row.sound_enabled),
    userName: typeof row.user_name === 'string' && row.user_name.trim() ? row.user_name : 'Daily Workspace',
    showCompleted: Boolean(row.show_completed),
    theme: row.theme === 'dark' ? 'dark' : 'light'
  };
}

function mergeNormalizedSettings(existingRow, patch) {
  const current = formatSettings(existingRow);
  const s = patch && typeof patch === 'object' ? patch : {};
  return {
    dailyGoalTasks: s.dailyGoalTasks !== undefined
      ? clampInt(s.dailyGoalTasks, 1, 50, current.dailyGoalTasks)
      : current.dailyGoalTasks,
    dailyGoalMinutes: s.dailyGoalMinutes !== undefined
      ? clampInt(s.dailyGoalMinutes, 15, 720, current.dailyGoalMinutes)
      : current.dailyGoalMinutes,
    soundEnabled: s.soundEnabled !== undefined ? Boolean(s.soundEnabled) : current.soundEnabled,
    userName: typeof s.userName === 'string' && s.userName.trim()
      ? s.userName.trim().slice(0, 60)
      : current.userName,
    showCompleted: s.showCompleted !== undefined ? Boolean(s.showCompleted) : current.showCompleted,
    theme: s.theme === 'dark' || s.theme === 'light' ? s.theme : current.theme
  };
}

function buildSettingsUpsertStmt(db, userId, settings, updatedAtIso) {
  return db.prepare(
    `INSERT INTO user_settings (
      user_id, daily_goal_tasks, daily_goal_minutes, sound_enabled, user_name, show_completed, theme, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      daily_goal_tasks = excluded.daily_goal_tasks,
      daily_goal_minutes = excluded.daily_goal_minutes,
      sound_enabled = excluded.sound_enabled,
      user_name = excluded.user_name,
      show_completed = excluded.show_completed,
      theme = excluded.theme,
      updated_at = excluded.updated_at`
  ).bind(
    userId,
    settings.dailyGoalTasks,
    settings.dailyGoalMinutes,
    settings.soundEnabled ? 1 : 0,
    settings.userName,
    settings.showCompleted ? 1 : 0,
    settings.theme === 'dark' ? 'dark' : 'light',
    updatedAtIso
  );
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
    completionComment: typeof row.completion_comment === 'string' ? row.completion_comment : '',
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
      completionComment: typeof source.completionComment === 'string'
        ? source.completionComment.slice(0, 2000)
        : '',
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
    activeTimer: safeJsonParse(userRow.active_timer_json, null),
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
      subtasks_json, routine_id, completion_comment, sort_order, created_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    task.completionComment || '',
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
      subtasks_json, routine_id, completion_comment, sort_order, created_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      completion_comment = excluded.completion_comment,
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
    task.completionComment || '',
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
          user_id, daily_goal_tasks, daily_goal_minutes, sound_enabled, user_name, show_completed, theme, updated_at
        ) VALUES (?, 5, 120, 1, ?, 1, 'light', ?)`
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
          user_id, daily_goal_tasks, daily_goal_minutes, sound_enabled, user_name, show_completed, theme, updated_at
        ) VALUES (?, 5, 120, 1, ?, 1, 'light', ?)`
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
    const nextSettings = mergeNormalizedSettings(existingSettingsRow, body.settings);
    stmts.push(buildSettingsUpsertStmt(env.DB, session.userId, nextSettings, nowIso));
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

  const nextSettings = mergeNormalizedSettings(existingSettingsRow, body);
  const curUser = formatUser(userRow);
  const nowIso = new Date().toISOString();

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
    buildSettingsUpsertStmt(env.DB, session.userId, nextSettings, nowIso),
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

  const alertCleared = task.scheduledTime !== existingTask.scheduledTime || task.date !== existingTask.date;

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
         completion_comment = ?,
         alert_sent_for = CASE WHEN ? = 1 THEN NULL ELSE alert_sent_for END,
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
    task.completionComment || '',
    alertCleared ? 1 : 0,
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

const DEFAULT_PUBLIC_APP_URL = 'https://workflow.myclass.uz';

function utf8ByteLength(str) {
  return textEncoder.encode(String(str || '')).length;
}

function resolveTelegramAppUrl(origin) {
  if (typeof origin === 'string' && origin.startsWith('https://')) {
    return origin;
  }
  return DEFAULT_PUBLIC_APP_URL;
}

function formatHourClock(hour) {
  const h = ((Number(hour) || 0) % 24 + 24) % 24;
  return `${String(h).padStart(2, '0')}:00`;
}

function truncateButtonLabel(text, maxChars = 34) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars - 1)}…`;
}

async function callTelegramApi(botToken, method, body) {
  if (!botToken) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN is not configured' };
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      if (method === 'editMessageText' && detail.includes('message is not modified')) {
        return { ok: true, unchanged: true };
      }
      return { ok: false, status: response.status, error: detail || `Telegram HTTP ${response.status}` };
    }
    const payload = await response.json().catch(() => ({ ok: true }));
    return { ok: true, payload };
  } catch (err) {
    return { ok: false, error: err?.message || 'Telegram network error' };
  }
}

async function sendTelegramMessage(botToken, chatId, text, replyMarkup = null) {
  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }
  return callTelegramApi(botToken, 'sendMessage', body);
}

async function editTelegramMessage(botToken, chatId, messageId, text, inlineKeyboard = null) {
  const body = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  if (inlineKeyboard) {
    body.reply_markup = inlineKeyboard;
  }
  return callTelegramApi(botToken, 'editMessageText', body);
}

async function answerTelegramCallback(botToken, callbackQueryId, text = '', showAlert = false) {
  if (!callbackQueryId) return { ok: true };
  return callTelegramApi(botToken, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text: text ? String(text).slice(0, 180) : undefined,
    show_alert: showAlert ? true : undefined
  });
}

function buildMainReplyKeyboard(isLinked, origin) {
  const appUrl = resolveTelegramAppUrl(origin);
  if (isLinked) {
    return {
      keyboard: [
        [{ text: "📋 Today's Tasks" }, { text: '➕ Add Task' }],
        [{ text: '✅ Quick Complete' }, { text: '🔄 Routines' }],
        [{ text: '📊 Progress & Stats' }, { text: '⏰ Reminders' }],
        [{ text: '🌐 Open TaskFlow', web_app: { url: appUrl } }]
      ],
      resize_keyboard: true,
      is_persistent: true
    };
  }
  return {
    keyboard: [
      [{ text: '🔗 Enter Pairing Code' }, { text: '🌐 Open TaskFlow', web_app: { url: appUrl } }],
      [{ text: '❓ How to Link' }]
    ],
    resize_keyboard: true,
    is_persistent: true
  };
}

function encodeTaskToggleData(task, dateKey, idx) {
  const direct = `t:${task.id}`;
  if (utf8ByteLength(direct) <= 64) {
    return direct;
  }
  return `ti:${dateKey}:${idx}`;
}

function encodeTaskSimpleData(prefix, task, dateKey, idx) {
  const direct = `${prefix}:${task.id}`;
  if (utf8ByteLength(direct) <= 64) {
    return direct;
  }
  return `${prefix}i:${dateKey}:${idx}`;
}

function encodeTaskAttrData(prefix, task, dateKey, idx, value) {
  const direct = `${prefix}:${task.id}:${value}`;
  if (utf8ByteLength(direct) <= 64) {
    return direct;
  }
  return `${prefix}i:${dateKey}:${idx}:${value}`;
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
    lines.push('Tap <b>➕ Add Task</b> below or send <code>/add Task title</code>.');
  } else {
    tasks.forEach((task, idx) => {
      const icon = task.status === 'done'
        ? '✅'
        : (task.status === 'in_progress' ? '⏳' : '⬜');
      const pri = task.priority === 'high' ? ' 🔴' : '';
      const timeHint = task.scheduled_time ? ` <i>(${escapeHtml(task.scheduled_time)})</i>` : '';
      const noteHint = task.completion_comment
        ? `\n   <i>💬 ${escapeHtml(truncateButtonLabel(task.completion_comment, 80))}</i>`
        : '';
      lines.push(`${idx + 1}. ${icon} ${escapeHtml(task.title)}${timeHint}${pri}${noteHint}`);
    });
    lines.push('');
    lines.push('Tap any task box below to toggle ✅ done / ⬜ open.');
  }

  return lines.join('\n');
}

function buildTodayChecklistView(userRow, dateKey, tasks, settingsRow, origin, openOnly = false, justCompleted = null) {
  const indexed = tasks.map((task, idx) => ({ task, idx }));
  const visible = openOnly ? indexed.filter((item) => item.task.status !== 'done') : indexed;
  const capped = visible.slice(0, 12);

  let text;
  if (openOnly && tasks.length > 0 && visible.length === 0) {
    const actualMinutes = tasks.reduce((sum, t) => sum + (Number(t.actual_minutes) || 0), 0);
    text = [
      `🎉 <b>All ${tasks.length} task(s) done for ${escapeHtml(dateKey)}!</b>`,
      `⏱️ Focus logged: <b>${formatMinutes(actualMinutes)}</b>`,
      '',
      'Want to plan another priority or review all tasks?'
    ].join('\n');
  } else {
    text = buildTodaySummaryMessage(userRow, dateKey, tasks, settingsRow);
    if (visible.length > capped.length) {
      text += `\n<i>Showing ${capped.length} of ${visible.length} clickable tasks.</i>`;
    }
  }

  const rows = capped.map(({ task, idx }) => {
    const icon = task.status === 'done' ? '✅' : (task.status === 'in_progress' ? '⏳' : '⬜');
    const pri = task.priority === 'high' ? ' 🔴' : '';
    return [{
      text: `${icon} ${idx + 1}. ${truncateButtonLabel(task.title, 32)}${pri}`,
      callback_data: encodeTaskToggleData(task, dateKey, idx)
    }];
  });

  if (justCompleted && justCompleted.task) {
    rows.push([{
      text: `💬 Add Done Comment: ${truncateButtonLabel(justCompleted.task.title, 22)}`,
      callback_data: encodeTaskSimpleData('tc', justCompleted.task, dateKey, justCompleted.idx)
    }]);
  }

  rows.push([
    { text: '➕ Add Task', callback_data: 'act:add' },
    { text: '🔄 Routines', callback_data: 'act:routines' },
    { text: '🔁 Refresh', callback_data: openOnly ? 'act:quick' : 'act:today' }
  ]);
  rows.push([
    { text: openOnly ? '📋 All Today' : '✅ Open Only', callback_data: openOnly ? 'act:today' : 'act:quick' },
    { text: '📊 Stats', callback_data: 'act:stats' },
    { text: '⏰ Reminders', callback_data: 'act:rem' }
  ]);

  if (resolveTelegramAppUrl(origin) === origin) {
    rows.push([{ text: '🌐 Open TaskFlow Workspace', web_app: { url: origin } }]);
  }

  return {
    text,
    inlineKeyboard: { inline_keyboard: rows }
  };
}

function buildTaskCreatedView(task, idxForFallback = 0, todayKeyForUser = null) {
  const priMap = { high: '🔴 High', medium: '🟡 Medium', low: '🟢 Low' };
  const blockMap = { morning: '🌅 Morning', afternoon: '☀️ Afternoon', evening: '🌙 Evening', anytime: '📥 Anytime' };
  const catMap = { work: '💼 Work', health: '💚 Health', learning: '📚 Learning', personal: '🏠 Personal', admin: '🗂 Admin' };
  const priLabel = priMap[task.priority] || '🟡 Medium';
  const blockLabel = blockMap[task.timeBlock] || '📥 Anytime';
  const catLabel = catMap[task.category] || '💼 Work';
  const statusIcon = task.status === 'done' ? '✅ Completed' : '⬜ Open';

  const baseToday = isValidDateKey(todayKeyForUser) ? todayKeyForUser : task.date;
  const isToday = task.date === baseToday;
  const isTomorrow = task.date === addDaysToDateKey(baseToday, 1);

  const lines = [
    `✅ <b>Saved for <code>${escapeHtml(task.date)}</code>${isTomorrow ? ' (Tomorrow)' : ''}:</b>`,
    `<b>${escapeHtml(task.title)}</b>`,
    `${statusIcon} • ${priLabel} • ${catLabel} • ${blockLabel}`
  ];
  if (task.completionComment) {
    lines.push(`<i>💬 ${escapeHtml(task.completionComment)}</i>`);
  }
  lines.push('');
  lines.push('Tap any box below to customize schedule, category, priority, or status:');

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: isToday ? '📅 Today ✓' : '📅 Today', callback_data: encodeTaskAttrData('td', task, task.date, idxForFallback, 'today') },
        { text: isTomorrow ? '📆 Tomorrow ✓' : '📆 Tomorrow', callback_data: encodeTaskAttrData('td', task, task.date, idxForFallback, 'tomorrow') }
      ],
      [
        { text: task.category === 'work' ? '💼 Work ✓' : '💼 Work', callback_data: encodeTaskAttrData('cat', task, task.date, idxForFallback, 'work') },
        { text: task.category === 'health' ? '💚 Health ✓' : '💚 Health', callback_data: encodeTaskAttrData('cat', task, task.date, idxForFallback, 'health') },
        { text: task.category === 'learning' ? '📚 Learn ✓' : '📚 Learn', callback_data: encodeTaskAttrData('cat', task, task.date, idxForFallback, 'learning') },
        { text: task.category === 'personal' ? '🏠 Personal ✓' : '🏠 Personal', callback_data: encodeTaskAttrData('cat', task, task.date, idxForFallback, 'personal') }
      ],
      [
        { text: task.priority === 'high' ? '🔴 High ✓' : '🔴 High', callback_data: encodeTaskAttrData('tp', task, task.date, idxForFallback, 'high') },
        { text: task.priority === 'medium' ? '🟡 Med ✓' : '🟡 Med', callback_data: encodeTaskAttrData('tp', task, task.date, idxForFallback, 'medium') },
        { text: task.priority === 'low' ? '🟢 Low ✓' : '🟢 Low', callback_data: encodeTaskAttrData('tp', task, task.date, idxForFallback, 'low') }
      ],
      [
        { text: task.timeBlock === 'morning' ? '🌅 Morning ✓' : '🌅 Morning', callback_data: encodeTaskAttrData('tb', task, task.date, idxForFallback, 'morning') },
        { text: task.timeBlock === 'afternoon' ? '☀️ Afternoon ✓' : '☀️ Afternoon', callback_data: encodeTaskAttrData('tb', task, task.date, idxForFallback, 'afternoon') },
        { text: task.timeBlock === 'evening' ? '🌙 Evening ✓' : '🌙 Evening', callback_data: encodeTaskAttrData('tb', task, task.date, idxForFallback, 'evening') }
      ],
      [
        { text: task.status === 'done' ? '↩️ Reopen Task' : '✅ Mark Done', callback_data: encodeTaskToggleData(task, task.date, idxForFallback) },
        ...(task.status === 'done' ? [{ text: '💬 Done Comment', callback_data: encodeTaskSimpleData('tc', task, task.date, idxForFallback) }] : []),
        { text: "📋 Today's Tasks", callback_data: 'act:today' }
      ]
    ]
  };

  return { text: lines.join('\n'), inlineKeyboard };
}

function buildRemindersView(userRow) {
  const user = formatUser(userRow);
  const statusLine = user.telegramNotificationsEnabled ? '🔔 Enabled' : '🔕 Paused';
  const text = [
    `⏰ <b>Daily Telegram Briefings</b>`,
    '',
    `• Status: <b>${statusLine}</b>`,
    `• Timezone: <code>${escapeHtml(user.timezone)}</code>`,
    `• Morning Agenda: <b>${formatHourClock(user.morningReminderHour)}</b>`,
    `• Evening Check-in: <b>${formatHourClock(user.eveningReminderHour)}</b>`,
    '',
    'Tap any box below to update right now:'
  ].join('\n');

  const inlineKeyboard = {
    inline_keyboard: [
      [
        {
          text: user.telegramNotificationsEnabled ? '🔕 Pause Daily Briefings' : '🔔 Enable Daily Briefings',
          callback_data: 'rem:toggle'
        }
      ],
      [
        { text: '☀️ -1h', callback_data: 'rem:mh:-1' },
        { text: `Morning ${formatHourClock(user.morningReminderHour)}`, callback_data: 'act:rem' },
        { text: '☀️ +1h', callback_data: 'rem:mh:1' }
      ],
      [
        { text: '🌙 -1h', callback_data: 'rem:eh:-1' },
        { text: `Evening ${formatHourClock(user.eveningReminderHour)}`, callback_data: 'act:rem' },
        { text: '🌙 +1h', callback_data: 'rem:eh:1' }
      ],
      [
        { text: '📤 Send Today Summary', callback_data: 'act:summary' },
        { text: "📋 Today's Tasks", callback_data: 'act:today' }
      ]
    ]
  };

  return { text, inlineKeyboard };
}

function buildStatsInlineKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🔄 Refresh Stats', callback_data: 'act:stats' },
        { text: "📋 Today's Tasks", callback_data: 'act:today' }
      ],
      [
        { text: '➕ Add Task', callback_data: 'act:add' },
        { text: '⏰ Reminders', callback_data: 'act:rem' }
      ]
    ]
  };
}

async function getChatState(db, chatId) {
  try {
    return await db.prepare('SELECT chat_id, action, draft_text FROM telegram_chat_states WHERE chat_id = ?')
      .bind(chatId)
      .first();
  } catch {
    return null;
  }
}

async function setChatState(db, chatId, action, draftText = null) {
  try {
    await db.prepare(
      `INSERT INTO telegram_chat_states (chat_id, action, draft_text, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET
         action = excluded.action,
         draft_text = excluded.draft_text,
         updated_at = excluded.updated_at`
    ).bind(chatId, action, draftText, new Date().toISOString()).run();
  } catch {
    /* ignore cleanly if state table absent */
  }
}

async function clearChatState(db, chatId) {
  try {
    await db.prepare('DELETE FROM telegram_chat_states WHERE chat_id = ?').bind(chatId).run();
  } catch {
    /* ignore cleanly if state table absent */
  }
}

async function loadTodayTasksAndSettings(db, userId, dateKey) {
  const [tasksRes, settingsRes] = await db.batch([
    db.prepare(
      'SELECT * FROM tasks WHERE user_id = ? AND date = ? ORDER BY sort_order ASC, created_at ASC'
    ).bind(userId, dateKey),
    db.prepare('SELECT * FROM user_settings WHERE user_id = ?').bind(userId)
  ]);
  return {
    tasks: tasksRes?.results || [],
    settingsRow: settingsRes?.results?.[0] || null
  };
}

async function createQuickTaskForTelegramUser(db, userRow, todayKey, title) {
  const cleanTitle = String(title || '').trim().slice(0, 500);
  const maxRow = await db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM tasks WHERE user_id = ? AND date = ?'
  ).bind(userRow.id, todayKey).first();
  const nextOrder = Number(maxRow?.max_order ?? -1) + 1;
  const nowIso = new Date().toISOString();

  const task = {
    id: `task_${crypto.randomUUID()}`,
    title: cleanTitle,
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

  await buildTaskInsertStmt(db, userRow.id, task).run();
  return { task, indexInDay: nextOrder };
}

async function resolveTaskFromCallbackToken(db, userId, modePrefix, payload) {
  if (['t', 'tp', 'tb', 'td', 'cat', 'tc', 'ts'].includes(modePrefix)) {
    const row = await db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?')
      .bind(payload.id, userId)
      .first();
    return row ? { row, indexInDay: 0 } : null;
  }
  const res = await db.prepare(
    'SELECT * FROM tasks WHERE user_id = ? AND date = ? ORDER BY sort_order ASC, created_at ASC'
  ).bind(userId, payload.dateKey).all();
  const rows = res?.results || [];
  const row = rows[payload.idx] || null;
  return row ? { row, indexInDay: payload.idx } : null;
}

function isWeekdayDateKey(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const day = dt.getUTCDay();
  return day >= 1 && day <= 5;
}

async function buildRoutinesView(db, userRow, todayKey, origin) {
  const [routinesRes, todayTasksRes] = await db.batch([
    db.prepare('SELECT * FROM routines WHERE user_id = ? ORDER BY created_at ASC').bind(userRow.id),
    db.prepare('SELECT id, routine_id, status FROM tasks WHERE user_id = ? AND date = ?').bind(userRow.id, todayKey)
  ]);

  const routines = (routinesRes?.results || []).filter((r) => Boolean(r.active));
  const byRoutineId = new Map();
  for (const t of todayTasksRes?.results || []) {
    if (t.routine_id) byRoutineId.set(t.routine_id, t);
  }

  if (routines.length === 0) {
    return {
      text: '🔄 <b>Daily Routines</b>\n\nNo active routines yet. Create recurring routines in TaskFlow → Routines on the web!',
      inlineKeyboard: {
        inline_keyboard: [
          [{ text: "📋 Today's Tasks", callback_data: 'act:today' }],
          ...(resolveTelegramAppUrl(origin) === origin ? [[{ text: '🌐 Open Routines', web_app: { url: origin } }]] : [])
        ]
      }
    };
  }

  const lines = [
    `🔄 <b>Daily Routines (${escapeHtml(todayKey)})</b>`,
    ''
  ];

  const rows = [];
  routines.slice(0, 12).forEach((r, idx) => {
    const linkedTask = byRoutineId.get(r.id);
    const statusIcon = linkedTask
      ? (linkedTask.status === 'done' ? '✅' : '⬜')
      : '➕';
    const schedNote = r.schedule === 'weekdays' ? ' (weekdays)' : '';
    lines.push(`${statusIcon} ${escapeHtml(r.title)}${schedNote}`);
    const cb = utf8ByteLength(`rt:${r.id}`) <= 64 ? `rt:${r.id}` : `rti:${idx}`;
    rows.push([{
      text: `${statusIcon} ${truncateButtonLabel(r.title, 34)}`,
      callback_data: cb
    }]);
  });

  lines.push('');
  lines.push('Tap any routine box to add & check off for today.');

  rows.push([
    { text: '✨ Apply All Due Today', callback_data: 'act:apply_routines' },
    { text: "📋 Today's Tasks", callback_data: 'act:today' }
  ]);

  return {
    text: lines.join('\n'),
    inlineKeyboard: { inline_keyboard: rows }
  };
}

async function applyActiveRoutinesForUser(db, userId, todayKey) {
  const [routinesRes, todayTasksRes, maxRes] = await db.batch([
    db.prepare('SELECT * FROM routines WHERE user_id = ? AND active = 1 ORDER BY created_at ASC').bind(userId),
    db.prepare('SELECT routine_id FROM tasks WHERE user_id = ? AND date = ? AND routine_id IS NOT NULL').bind(userId, todayKey),
    db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM tasks WHERE user_id = ? AND date = ?').bind(userId, todayKey)
  ]);

  const existingIds = new Set((todayTasksRes?.results || []).map((r) => r.routine_id));
  let nextOrder = Number(maxRes?.results?.[0]?.max_order ?? -1) + 1;
  const stmts = [];
  const nowIso = new Date().toISOString();

  for (const rRow of routinesRes?.results || []) {
    const routine = formatRoutine(rRow);
    if (!routine.active) continue;
    if (routine.schedule === 'weekdays' && !isWeekdayDateKey(todayKey)) continue;
    if (existingIds.has(routine.id)) continue;

    stmts.push(buildTaskInsertStmt(db, userId, {
      id: `task_${crypto.randomUUID()}`,
      title: routine.title,
      notes: '',
      date: todayKey,
      timeBlock: routine.timeBlock,
      scheduledTime: '',
      estimatedMinutes: routine.estimatedMinutes,
      actualMinutes: 0,
      priority: routine.priority,
      category: routine.category,
      status: 'todo',
      subtasks: routine.subtasks.map((st) => ({ id: `sub_${crypto.randomUUID().slice(0, 8)}`, title: st, done: false })),
      routineId: routine.id,
      completionComment: '',
      order: nextOrder++,
      createdAt: nowIso,
      completedAt: null
    }));
  }

  if (stmts.length > 0) {
    await db.batch(stmts);
  }
  return stmts.length;
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

  const { tasks, settingsRow } = await loadTodayTasksAndSettings(env.DB, session.userId, targetDate);
  const view = buildTodayChecklistView(userRow, targetDate, tasks, settingsRow, new URL(request.url).origin, false);

  const sent = await sendTelegramMessage(
    env.TELEGRAM_BOT_TOKEN,
    userRow.telegram_chat_id,
    view.text,
    view.inlineKeyboard
  );
  if (!sent.ok) {
    return errorResponse(502, 'Failed to send summary to Telegram', 'TELEGRAM_API_ERROR', sent.error);
  }

  return jsonResponse({
    ok: true,
    date: targetDate,
    sentAt: new Date().toISOString()
  });
}

async function applyPairingCodeForChat(env, chatId, tgUsername, rawCode, origin) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) {
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      'Paste your 8-character pairing code from <b>TaskFlow → Cabinet → Telegram</b> (no command needed):',
      { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'act:cancel' }]] }
    );
    return;
  }

  const codeRow = await env.DB.prepare('SELECT * FROM telegram_link_codes WHERE code = ?')
    .bind(code)
    .first();
  if (!codeRow || Number(codeRow.expires_at) <= Date.now()) {
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '❌ That pairing code is invalid or expired. Generate a fresh code in TaskFlow → Personal Cabinet → Telegram and paste it here.',
      { inline_keyboard: [[{ text: '🔗 Try Another Code', callback_data: 'act:prompt_link' }]] }
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
    env.DB.prepare('DELETE FROM telegram_link_codes WHERE code = ?').bind(code)
  ]);
  await clearChatState(env.DB, chatId);

  const linkedUser = await env.DB.prepare('SELECT * FROM users WHERE id = ?')
    .bind(codeRow.user_id)
    .first();
  const label = escapeHtml(linkedUser?.name || linkedUser?.email || 'your TaskFlow cabinet');

  await sendTelegramMessage(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    `✅ Connected to <b>${label}</b>!\n\nUse the menu boxes below anytime — no commands needed:`,
    buildMainReplyKeyboard(true, origin)
  );
}

async function processTelegramCallbackQuery(callbackQuery, env, origin) {
  const chatIdRaw = callbackQuery?.message?.chat?.id;
  const messageId = callbackQuery?.message?.message_id;
  const callbackId = callbackQuery?.id;
  const data = typeof callbackQuery?.data === 'string' ? callbackQuery.data : '';
  if (chatIdRaw === undefined || chatIdRaw === null || !data) {
    await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callbackId);
    return;
  }

  const chatId = String(chatIdRaw);
  const userRow = await env.DB.prepare('SELECT * FROM users WHERE telegram_chat_id = ?')
    .bind(chatId)
    .first();

  if (data === 'act:cancel') {
    await clearChatState(env.DB, chatId);
    await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callbackId, 'Cancelled');
    if (messageId) {
      await editTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, messageId, 'Cancelled.');
    }
    return;
  }

  if (data === 'act:prompt_link') {
    await setChatState(env.DB, chatId, 'awaiting_link_code');
    await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callbackId);
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '🔗 Paste your 8-character pairing code from <b>TaskFlow → Personal Cabinet → Telegram</b>:',
      { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'act:cancel' }]] }
    );
    return;
  }

  if (!userRow) {
    await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callbackId, 'Link your Google cabinet first', true);
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '🔗 Connect this chat to your TaskFlow Google cabinet first.',
      {
        inline_keyboard: [[{ text: '🔗 Enter Pairing Code', callback_data: 'act:prompt_link' }]]
      }
    );
    return;
  }

  const todayKey = getDateKeyInTimezone(userRow.timezone || DEFAULT_TIMEZONE);

  if (data === 'act:today' || data === 'act:quick') {
    const openOnly = data === 'act:quick';
    const { tasks, settingsRow } = await loadTodayTasksAndSettings(env.DB, userRow.id, todayKey);
    const view = buildTodayChecklistView(userRow, todayKey, tasks, settingsRow, origin, openOnly);
    await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callbackId);
    if (messageId) {
      await editTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, messageId, view.text, view.inlineKeyboard);
    } else {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, view.text, view.inlineKeyboard);
    }
    return;
  }

  if (data === 'act:add') {
    await setChatState(env.DB, chatId, 'awaiting_task_title');
    await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callbackId);
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '➕ <b>New Task for Today</b>\nJust send the task title below — no commands needed:',
      { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'act:cancel' }]] }
    );
    return;
  }

  if (data === 'act:save_draft') {
    const chatState = await getChatState(env.DB, chatId);
    const draft = chatState?.draft_text ? chatState.draft_text.trim() : '';
    await clearChatState(env.DB, chatId);
    if (!draft) {
      await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callbackId, 'Nothing to save');
      return;
    }
    const { task, indexInDay } = await createQuickTaskForTelegramUser(env.DB, userRow, todayKey, draft);
    const card = buildTaskCreatedView(task, indexInDay);
    await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callbackId, '✅ Task added!');
    if (messageId) {
      await editTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, messageId, card.text, card.inlineKeyboard);
    } else {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, card.text, card.inlineKeyboard);
    }
    return;
  }

  if (data === 'act:stats') {
    const msg = await computeUserStatsMessage(env.DB, userRow, todayKey);
    await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callbackId);
    if (messageId) {
      await editTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, messageId, msg, buildStatsInlineKeyboard());
    } else {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg, buildStatsInlineKeyboard());
    }
    return;
  }

  if (data === 'act:rem') {
    const view = buildRemindersView(userRow);
    await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callbackId);
    if (messageId) {
      await editTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, messageId, view.text, view.inlineKeyboard);
    } else {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, view.text, view.inlineKeyboard);
    }
    return;
  }

  if (data === 'act:summary') {
    const { tasks, settingsRow } = await loadTodayTasksAndSettings(env.DB, userRow.id, todayKey);
    const view = buildTodayChecklistView(userRow, todayKey, tasks, settingsRow, origin, false);
    await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callbackId, 'Summary sent!');
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, view.text, view.inlineKeyboard);
    return;
  }

  if (data === 'act:routines') {
    const view = await buildRoutinesView(env.DB, userRow, todayKey, origin);
    await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callbackId);
    if (messageId) {
      await editTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, messageId, view.text, view.inlineKeyboard);
    } else {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, view.text, view.inlineKeyboard);
    }
    return;
  }

  if (data === 'act:apply_routines') {
    const createdCount = await applyActiveRoutinesForUser(env.DB, userRow.id, todayKey);
    const view = await buildRoutinesView(env.DB, userRow, todayKey, origin);
    await answerTelegramCallback(
      env.TELEGRAM_BOT_TOKEN,
      callbackId,
      createdCount > 0 ? `✨ Applied ${createdCount} routine(s)` : 'Already up to date'
    );
    if (messageId) {
      await editTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, messageId, view.text, view.inlineKeyboard);
    }
    return;
  }

  if (data.startsWith('rt:') || data.startsWith('rti:')) {
    const routinesRes = await env.DB.prepare('SELECT * FROM routines WHERE user_id = ? AND active = 1 ORDER BY created_at ASC')
      .bind(userRow.id)
      .all();
    const routines = routinesRes?.results || [];
    const targetRoutine = data.startsWith('rt:')
      ? routines.find((r) => r.id === data.slice(3))
      : routines[Number(data.slice(4))];

    if (!targetRoutine) {
      await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callbackId, 'Routine not found', true);
      return;
    }

    const existingTask = await env.DB.prepare(
      'SELECT * FROM tasks WHERE user_id = ? AND date = ? AND routine_id = ?'
    ).bind(userRow.id, todayKey, targetRoutine.id).first();

    let toastText = '';
    if (!existingTask) {
      const rNorm = formatRoutine(targetRoutine);
      const maxRow = await env.DB.prepare(
        'SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM tasks WHERE user_id = ? AND date = ?'
      ).bind(userRow.id, todayKey).first();
      const nowIso = new Date().toISOString();
      await buildTaskInsertStmt(env.DB, userRow.id, {
        id: `task_${crypto.randomUUID()}`,
        title: rNorm.title,
        notes: '',
        date: todayKey,
        timeBlock: rNorm.timeBlock,
        scheduledTime: '',
        estimatedMinutes: rNorm.estimatedMinutes,
        actualMinutes: 0,
        priority: rNorm.priority,
        category: rNorm.category,
        status: 'done',
        subtasks: rNorm.subtasks.map((st) => ({ id: `sub_${crypto.randomUUID().slice(0, 8)}`, title: st, done: true })),
        routineId: rNorm.id,
        completionComment: '',
        order: Number(maxRow?.max_order ?? -1) + 1,
        createdAt: nowIso,
        completedAt: nowIso
      }).run();
      toastText = '✅ Routine checked off!';
    } else {
      const nextStatus = existingTask.status === 'done' ? 'todo' : 'done';
      const nextCompleted = nextStatus === 'done' ? (existingTask.completed_at || new Date().toISOString()) : null;
      await env.DB.prepare('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ? AND user_id = ?')
        .bind(nextStatus, nextCompleted, existingTask.id, userRow.id)
        .run();
      toastText = nextStatus === 'done' ? '✅ Routine completed!' : '↩️ Routine reopened';
    }

    const view = await buildRoutinesView(env.DB, userRow, todayKey, origin);
    await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callbackId, toastText);
    if (messageId) {
      await editTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, messageId, view.text, view.inlineKeyboard);
    }
    return;
  }

  if (data.startsWith('rem:')) {
    const parts = data.split(':');
    const nowIso = new Date().toISOString();
    let nextEnabled = Boolean(userRow.telegram_notifications_enabled);
    let nextMorning = Number.isFinite(Number(userRow.morning_reminder_hour)) ? Number(userRow.morning_reminder_hour) : 8;
    let nextEvening = Number.isFinite(Number(userRow.evening_reminder_hour)) ? Number(userRow.evening_reminder_hour) : 21;

    if (parts[1] === 'toggle') {
      nextEnabled = !nextEnabled;
    } else if (parts[1] === 'mh') {
      nextMorning = (nextMorning + Number(parts[2] || 0) + 24) % 24;
    } else if (parts[1] === 'eh') {
      nextEvening = (nextEvening + Number(parts[2] || 0) + 24) % 24;
    }

    await env.DB.prepare(
      `UPDATE users
       SET telegram_notifications_enabled = ?,
           morning_reminder_hour = ?,
           evening_reminder_hour = ?,
           updated_at = ?
       WHERE id = ?`
    ).bind(nextEnabled ? 1 : 0, nextMorning, nextEvening, nowIso, userRow.id).run();

    const updatedUserRow = await env.DB.prepare('SELECT * FROM users WHERE id = ?')
      .bind(userRow.id)
      .first();
    const view = buildRemindersView(updatedUserRow || userRow);
    await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callbackId, 'Preferences updated');
    if (messageId) {
      await editTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, messageId, view.text, view.inlineKeyboard);
    }
    return;
  }

  // Task priority / time block / date / category / snooze / comment / toggle callbacks
  let taskOp = null;
  const colonParts = data.split(':');
  const p0 = colonParts[0];
  if ((p0 === 't' || p0 === 'tc') && colonParts.length === 2) {
    taskOp = { kind: p0 === 'tc' ? 'commentPrompt' : 'toggle', lookupMode: p0, id: colonParts[1] };
  } else if ((p0 === 'ti' || p0 === 'tci') && colonParts.length === 3) {
    taskOp = { kind: p0 === 'tci' ? 'commentPrompt' : 'toggle', lookupMode: p0, dateKey: colonParts[1], idx: Number(colonParts[2]) };
  } else if ((p0 === 'tp' || p0 === 'tb' || p0 === 'td' || p0 === 'cat' || p0 === 'ts') && colonParts.length === 3) {
    taskOp = { kind: p0, lookupMode: p0, id: colonParts[1], value: colonParts[2] };
  } else if ((p0 === 'tpi' || p0 === 'tbi' || p0 === 'tdi' || p0 === 'cati' || p0 === 'tsi') && colonParts.length === 4) {
    taskOp = {
      kind: p0.slice(0, -1),
      lookupMode: p0,
      dateKey: colonParts[1],
      idx: Number(colonParts[2]),
      value: colonParts[3]
    };
  }

  if (taskOp) {
    const resolved = await resolveTaskFromCallbackToken(env.DB, userRow.id, taskOp.lookupMode, taskOp);
    if (!resolved) {
      await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callbackId, 'Task not found', true);
      return;
    }

    const row = resolved.row;
    const isTaskCreationMessage = Boolean(
      callbackQuery?.message?.reply_markup?.inline_keyboard?.some((r) =>
        r.some((btn) => typeof btn.callback_data === 'string' && btn.callback_data.startsWith('tp'))
      )
    );
    const isOpenOnlyMessage = Boolean(
      callbackQuery?.message?.reply_markup?.inline_keyboard?.some((r) =>
        r.some((btn) => btn.callback_data === 'act:today' && String(btn.text || '').includes('All Today'))
      )
    );

    if (taskOp.kind === 'commentPrompt') {
      await setChatState(env.DB, chatId, 'awaiting_done_comment', row.id);
      await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callbackId);
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        `💬 Send your completion comment for:\n<b>${escapeHtml(row.title)}</b>`,
        { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'act:cancel' }]] }
      );
      return;
    }

    if (taskOp.kind === 'ts') {
      const addMins = Math.max(15, Math.min(240, Number(taskOp.value) || 60));
      const baseDate = isValidDateKey(row.date) ? row.date : todayKey;
      let nextMins = 9 * 60 + addMins;
      const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(row.scheduled_time || ''));
      if (m) nextMins = Number(m[1]) * 60 + Number(m[2]) + addMins;
      let nextDate = baseDate;
      if (nextMins >= 24 * 60) {
        nextDate = addDaysToDateKey(baseDate, Math.floor(nextMins / (24 * 60)));
        nextMins = nextMins % (24 * 60);
      }
      const nextTime = `${String(Math.floor(nextMins / 60)).padStart(2, '0')}:${String(nextMins % 60).padStart(2, '0')}`;
      await env.DB.prepare(
        'UPDATE tasks SET date = ?, scheduled_time = ?, alert_sent_for = NULL WHERE id = ? AND user_id = ?'
      ).bind(nextDate, nextTime, row.id, userRow.id).run();
      await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callbackId, `⏰ Snoozed to ${nextTime}`);
      if (messageId) {
        await editTelegramMessage(
          env.TELEGRAM_BOT_TOKEN,
          chatId,
          messageId,
          `⏰ <b>Snoozed to ${escapeHtml(nextTime)}</b> (<code>${escapeHtml(nextDate)}</code>)\n<b>${escapeHtml(row.title)}</b>`,
          { inline_keyboard: [[{ text: '✅ Mark Done Now', callback_data: encodeTaskToggleData(row, nextDate, resolved.indexInDay) }, { text: "📋 Today's Tasks", callback_data: 'act:today' }]] }
        );
      }
      return;
    }

    if (taskOp.kind === 'toggle') {
      const nextStatus = row.status === 'done' ? 'todo' : 'done';
      const nextCompletedAt = nextStatus === 'done' ? (row.completed_at || new Date().toISOString()) : null;
      await env.DB.prepare(
        'UPDATE tasks SET status = ?, completed_at = ? WHERE id = ? AND user_id = ?'
      ).bind(nextStatus, nextCompletedAt, row.id, userRow.id).run();

      await answerTelegramCallback(
        env.TELEGRAM_BOT_TOKEN,
        callbackId,
        nextStatus === 'done' ? '✅ Completed!' : '↩️ Reopened'
      );

      if (messageId) {
        const freshRow = await env.DB.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?')
          .bind(row.id, userRow.id)
          .first();
        if (isTaskCreationMessage && freshRow) {
          const card = buildTaskCreatedView(formatTask(freshRow), resolved.indexInDay, todayKey);
          await editTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, messageId, card.text, card.inlineKeyboard);
        } else {
          const targetDate = row.date || todayKey;
          const { tasks, settingsRow } = await loadTodayTasksAndSettings(env.DB, userRow.id, targetDate);
          const completedPayload = nextStatus === 'done' && freshRow
            ? { task: formatTask(freshRow), idx: resolved.indexInDay }
            : null;
          const view = buildTodayChecklistView(userRow, targetDate, tasks, settingsRow, origin, isOpenOnlyMessage, completedPayload);
          await editTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, messageId, view.text, view.inlineKeyboard);
        }
      }
      return;
    }

    if (taskOp.kind === 'tp' && VALID_PRIORITIES.has(taskOp.value)) {
      await env.DB.prepare('UPDATE tasks SET priority = ? WHERE id = ? AND user_id = ?')
        .bind(taskOp.value, row.id, userRow.id)
        .run();
      await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callbackId, `Priority: ${taskOp.value}`);
    } else if (taskOp.kind === 'tb' && VALID_TIME_BLOCKS.has(taskOp.value)) {
      await env.DB.prepare('UPDATE tasks SET time_block = ? WHERE id = ? AND user_id = ?')
        .bind(taskOp.value, row.id, userRow.id)
        .run();
      await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callbackId, `Time block: ${taskOp.value}`);
    } else if (taskOp.kind === 'td') {
      const nextDate = taskOp.value === 'tomorrow' ? addDaysToDateKey(todayKey, 1) : todayKey;
      await env.DB.prepare('UPDATE tasks SET date = ?, alert_sent_for = NULL WHERE id = ? AND user_id = ?')
        .bind(nextDate, row.id, userRow.id)
        .run();
      await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callbackId, taskOp.value === 'tomorrow' ? 'Moved to Tomorrow' : 'Scheduled for Today');
    } else if (taskOp.kind === 'cat' && VALID_CATEGORIES.has(taskOp.value)) {
      await env.DB.prepare('UPDATE tasks SET category = ? WHERE id = ? AND user_id = ?')
        .bind(taskOp.value, row.id, userRow.id)
        .run();
      await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callbackId, `Category: ${taskOp.value}`);
    }

    if (messageId) {
      const freshRow = await env.DB.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?')
        .bind(row.id, userRow.id)
        .first();
      if (freshRow) {
        const card = buildTaskCreatedView(formatTask(freshRow), resolved.indexInDay, todayKey);
        await editTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, messageId, card.text, card.inlineKeyboard);
      }
    }
    return;
  }

  await answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callbackId);
}

async function processTelegramWebhookUpdate(update, env, origin = DEFAULT_PUBLIC_APP_URL) {
  if (update?.callback_query) {
    await processTelegramCallbackQuery(update.callback_query, env, origin);
    return;
  }

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

  const isSlash = rawText.startsWith('/');
  const firstSpace = rawText.search(/\s/);
  const rawCommand = isSlash
    ? (firstSpace === -1 ? rawText : rawText.slice(0, firstSpace)).toLowerCase()
    : '';
  const cmd = rawCommand ? rawCommand.split('@')[0] : '';
  const arg = isSlash && firstSpace !== -1 ? rawText.slice(firstSpace + 1).trim() : '';

  let linkCodeToApply = null;
  if (cmd === '/start' && arg.toLowerCase().startsWith('link_')) {
    linkCodeToApply = arg.slice(5).trim().toUpperCase();
  } else if (cmd === '/link') {
    linkCodeToApply = arg.trim().toUpperCase();
  }

  if (cmd === '/link' || linkCodeToApply !== null) {
    await applyPairingCodeForChat(env, chatId, tgUsername, linkCodeToApply, origin);
    return;
  }

  const userRow = await env.DB.prepare('SELECT * FROM users WHERE telegram_chat_id = ?')
    .bind(chatId)
    .first();

  if (cmd === '/start') {
    await clearChatState(env.DB, chatId);
    if (userRow) {
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        `👋 Welcome back, <b>${escapeHtml(userRow.name || userRow.email || 'there')}</b>!\n\nTap any button box below — no need to type commands:`,
        buildMainReplyKeyboard(true, origin)
      );
    } else {
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        '👋 Welcome to <b>TaskFlow</b>!\n\nTo connect your personal Google cabinet:\n1. Open TaskFlow and sign in with Google\n2. Go to <b>Personal Cabinet → Telegram Bot → Generate Pairing Code</b>\n3. Tap <b>🔗 Enter Pairing Code</b> below and paste the 8-character code.',
        buildMainReplyKeyboard(false, origin)
      );
    }
    return;
  }

  if (cmd === '/help' || rawText === '❓ How to Link') {
    await clearChatState(env.DB, chatId);
    if (userRow) {
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        `🛠 <b>TaskFlow Controls</b>\n\nJust tap the menu boxes at the bottom:\n• <b>📋 Today's Tasks</b> — interactive task checklist\n• <b>➕ Add Task</b> — type a title with no commands\n• <b>✅ Quick Complete</b> — tap remaining tasks done\n• <b>📊 Progress &amp; Stats</b> — streak &amp; focus stats\n• <b>⏰ Reminders</b> — morning &amp; evening alerts\n\n<i>Slash shortcuts (/today, /add, /done, /stats) also work anytime.</i>`,
        buildMainReplyKeyboard(true, origin)
      );
    } else {
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        '🔗 Open <b>TaskFlow → Personal Cabinet → Telegram Bot</b>, generate an 8-character pairing code, tap <b>🔗 Enter Pairing Code</b> below, and paste the code here.',
        buildMainReplyKeyboard(false, origin)
      );
    }
    return;
  }

  if (rawText === '🔗 Enter Pairing Code') {
    await setChatState(env.DB, chatId, 'awaiting_link_code');
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '🔗 Paste your 8-character pairing code now (no <code>/link</code> needed):',
      { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'act:cancel' }]] }
    );
    return;
  }

  if (!userRow) {
    const chatState = await getChatState(env.DB, chatId);
    const cleanedCandidate = rawText.replace(/^\/link\s+/i, '').trim().toUpperCase();
    if (chatState?.action === 'awaiting_link_code' || /^[A-HJ-NP-Z2-9]{8}$/.test(cleanedCandidate)) {
      await applyPairingCodeForChat(env, chatId, tgUsername, cleanedCandidate, origin);
      return;
    }
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '🔗 This chat is not linked to a TaskFlow cabinet yet.\nTap <b>🔗 Enter Pairing Code</b> below after generating your code in TaskFlow.',
      buildMainReplyKeyboard(false, origin)
    );
    return;
  }

  const todayKey = getDateKeyInTimezone(userRow.timezone || DEFAULT_TIMEZONE);

  // Tap-button routes (clear any pending prompt state automatically)
  if (cmd === '/today' || rawText === "📋 Today's Tasks") {
    await clearChatState(env.DB, chatId);
    const { tasks, settingsRow } = await loadTodayTasksAndSettings(env.DB, userRow.id, todayKey);
    const view = buildTodayChecklistView(userRow, todayKey, tasks, settingsRow, origin, false);
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, view.text, view.inlineKeyboard);
    return;
  }

  if (rawText === '✅ Quick Complete') {
    await clearChatState(env.DB, chatId);
    const { tasks, settingsRow } = await loadTodayTasksAndSettings(env.DB, userRow.id, todayKey);
    const view = buildTodayChecklistView(userRow, todayKey, tasks, settingsRow, origin, true);
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, view.text, view.inlineKeyboard);
    return;
  }

  if (rawText === '➕ Add Task') {
    await setChatState(env.DB, chatId, 'awaiting_task_title');
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '➕ <b>New Task for Today</b>\nJust send the task title below — no commands needed:',
      { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'act:cancel' }]] }
    );
    return;
  }

  if (cmd === '/stats' || rawText === '📊 Progress & Stats') {
    await clearChatState(env.DB, chatId);
    const msg = await computeUserStatsMessage(env.DB, userRow, todayKey);
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg, buildStatsInlineKeyboard());
    return;
  }

  if (rawText === '⏰ Reminders') {
    await clearChatState(env.DB, chatId);
    const view = buildRemindersView(userRow);
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, view.text, view.inlineKeyboard);
    return;
  }

  if (cmd === '/routines' || rawText === '🔄 Routines') {
    await clearChatState(env.DB, chatId);
    const view = await buildRoutinesView(env.DB, userRow, todayKey, origin);
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, view.text, view.inlineKeyboard);
    return;
  }

  if (cmd === '/add') {
    await clearChatState(env.DB, chatId);
    if (!arg) {
      await setChatState(env.DB, chatId, 'awaiting_task_title');
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        '➕ <b>New Task for Today</b>\nSend your task title below:',
        { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'act:cancel' }]] }
      );
      return;
    }

    const { task, indexInDay } = await createQuickTaskForTelegramUser(env.DB, userRow, todayKey, arg);
    const card = buildTaskCreatedView(task, indexInDay, todayKey);
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      card.text,
      card.inlineKeyboard
    );
    return;
  }

  if (cmd === '/done') {
    await clearChatState(env.DB, chatId);
    const doneTokens = arg.trim().split(/\s+/);
    const cleanNum = (doneTokens[0] || '').replace(/^#/, '');
    const doneComment = arg.trim().slice((doneTokens[0] || '').length).trim().slice(0, 2000);
    const idx = parseInt(cleanNum, 10);
    if (!Number.isFinite(idx) || idx < 1 || !/^\d+$/.test(cleanNum)) {
      const { tasks, settingsRow } = await loadTodayTasksAndSettings(env.DB, userRow.id, todayKey);
      const view = buildTodayChecklistView(userRow, todayKey, tasks, settingsRow, origin, true);
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, view.text, view.inlineKeyboard);
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
        `Task #${idx} not found. Today has ${tasks.length} task(s).`,
        { inline_keyboard: [[{ text: "📋 Today's Tasks", callback_data: 'act:today' }]] }
      );
      return;
    }

    const target = tasks[idx - 1];
    const nowIso = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE tasks
       SET status = 'done',
           completed_at = COALESCE(completed_at, ?),
           completion_comment = CASE WHEN ? != '' THEN ? ELSE completion_comment END
       WHERE id = ? AND user_id = ?`
    ).bind(nowIso, doneComment, doneComment, target.id, userRow.id).run();

    const doneCount = tasks.filter((t, i) => i === idx - 1 || t.status === 'done').length;
    const commentLine = doneComment ? `\n💬 <i>${escapeHtml(doneComment)}</i>` : '';
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `🎉 Completed #${idx}: <b>${escapeHtml(target.title)}</b>${commentLine}\nToday's progress: <b>${doneCount}/${tasks.length}</b>`,
      {
        inline_keyboard: [
          [{ text: '💬 Add / Edit Comment', callback_data: encodeTaskSimpleData('tc', target, todayKey, idx - 1) }],
          [{ text: '✅ Quick Complete More', callback_data: 'act:quick' }, { text: "📋 Today's Tasks", callback_data: 'act:today' }]
        ]
      }
    );
    return;
  }

  if (isSlash) {
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      'Use the interactive boxes below anytime — no slash commands needed!',
      buildMainReplyKeyboard(true, origin)
    );
    return;
  }

  // Plain text handling for linked users: completion comment, guided task add, or 1-tap confirm draft
  const chatState = await getChatState(env.DB, chatId);
  if (chatState?.action === 'awaiting_done_comment' && chatState.draft_text) {
    const taskId = chatState.draft_text;
    await clearChatState(env.DB, chatId);
    const cleanComment = rawText.slice(0, 2000);
    const updatedRes = await env.DB.prepare(
      `UPDATE tasks SET completion_comment = ? WHERE id = ? AND user_id = ?`
    ).bind(cleanComment, taskId, userRow.id).run();
    if (!updatedRes?.meta?.changes) {
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        'Task not found. Tap Today\'s Tasks to continue.',
        buildMainReplyKeyboard(true, origin)
      );
      return;
    }
    const row = await env.DB.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?')
      .bind(taskId, userRow.id)
      .first();
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `💬 <b>Comment saved</b> on <b>${escapeHtml(row?.title || 'task')}</b>:\n<i>"${escapeHtml(cleanComment)}"</i>`,
      { inline_keyboard: [[{ text: "📋 Today's Tasks", callback_data: 'act:today' }, { text: '✅ Quick Complete', callback_data: 'act:quick' }]] }
    );
    return;
  }

  if (chatState?.action === 'awaiting_task_title') {
    await clearChatState(env.DB, chatId);
    const { task, indexInDay } = await createQuickTaskForTelegramUser(env.DB, userRow, todayKey, rawText);
    const card = buildTaskCreatedView(task, indexInDay, todayKey);
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, card.text, card.inlineKeyboard);
    return;
  }

  const trimmedDraft = rawText.slice(0, 500);
  await setChatState(env.DB, chatId, 'confirm_draft', trimmedDraft);
  await sendTelegramMessage(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    `💡 Add this as a task for today?\n<b>${escapeHtml(truncateButtonLabel(trimmedDraft, 120))}</b>`,
    {
      inline_keyboard: [[
        { text: '✅ Yes, Add Task', callback_data: 'act:save_draft' },
        { text: '❌ Dismiss', callback_data: 'act:cancel' }
      ]]
    }
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

  const origin = new URL(request.url).origin;
  const work = processTelegramWebhookUpdate(parsed.data, env, origin).catch((err) => {
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
 * Cross-Device Focus Timer & Account Deletion Handlers
 * ========================================================================== */

const VALID_TIMER_MODES = new Set(['pomodoro', 'deep', 'break', 'stopwatch']);
const VALID_TIMER_STATUSES = new Set(['idle', 'running', 'paused', 'completed']);

function normalizeTimerPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const mode = VALID_TIMER_MODES.has(raw.mode) ? raw.mode : 'pomodoro';
  const status = VALID_TIMER_STATUSES.has(raw.status) ? raw.status : 'idle';
  return {
    mode,
    status,
    durationSeconds: clampInt(raw.durationSeconds, 0, 14400, mode === 'stopwatch' ? 0 : 1500),
    startedAtMs: Number.isFinite(Number(raw.startedAtMs)) ? Math.max(0, Math.round(Number(raw.startedAtMs))) : 0,
    elapsedBeforePauseSeconds: clampInt(raw.elapsedBeforePauseSeconds, 0, 86400, 0),
    attachedTaskId: typeof raw.attachedTaskId === 'string' && raw.attachedTaskId.trim()
      ? raw.attachedTaskId.trim().slice(0, 128)
      : null,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : new Date().toISOString()
  };
}

async function handlePutTimer(request, session, env) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return errorResponse(400, parsed.error, 'VALIDATION_ERROR');
  }
  const normalized = normalizeTimerPayload(parsed.data);
  if (!normalized) {
    return errorResponse(400, 'Invalid timer payload', 'VALIDATION_ERROR');
  }

  const nowIso = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE users
     SET active_timer_json = ?,
         timer_notified_for = CASE WHEN ? != 'running' THEN NULL ELSE timer_notified_for END,
         updated_at = ?
     WHERE id = ?`
  ).bind(JSON.stringify(normalized), normalized.status, nowIso, session.userId).run();

  return jsonResponse({ ok: true, activeTimer: normalized });
}

async function handleDeleteAccount(request, session, env) {
  const url = new URL(request.url);
  const stmts = [
    env.DB.prepare('DELETE FROM tasks WHERE user_id = ?').bind(session.userId),
    env.DB.prepare('DELETE FROM routines WHERE user_id = ?').bind(session.userId),
    env.DB.prepare('DELETE FROM reflections WHERE user_id = ?').bind(session.userId),
    env.DB.prepare('DELETE FROM user_settings WHERE user_id = ?').bind(session.userId),
    env.DB.prepare('DELETE FROM telegram_link_codes WHERE user_id = ?').bind(session.userId)
  ];
  if (session.userRow?.telegram_chat_id) {
    stmts.push(
      env.DB.prepare('DELETE FROM telegram_chat_states WHERE chat_id = ?').bind(session.userRow.telegram_chat_id)
    );
  }
  stmts.push(env.DB.prepare('DELETE FROM users WHERE id = ?').bind(session.userId));

  await env.DB.batch(stmts);

  const headers = new Headers();
  clearSessionCookie(headers, url);
  return jsonResponse({ ok: true }, 200, headers);
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

    if (segments.length === 2 && segments[1] === 'timer') {
      if (method !== 'PUT') return errorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
      return handlePutTimer(request, session, env);
    }

    if (segments.length === 2 && segments[1] === 'account') {
      if (method !== 'DELETE') return errorResponse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
      return handleDeleteAccount(request, session, env);
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
