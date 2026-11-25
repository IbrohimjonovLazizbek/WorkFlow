const DEFAULT_TIMEZONE = 'Asia/Tashkent';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

export function getLocalDateAndHour(date, timeZone) {
  const safeTz = resolveValidTimezone(timeZone);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  });

  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
  }

  return {
    timeZone: safeTz,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24
  };
}

function resolveValidTimezone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone.trim()) {
    return DEFAULT_TIMEZONE;
  }
  const candidate = timeZone.trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function formatPriorityBadge(priority) {
  if (priority === 'high') return '🔴';
  if (priority === 'low') return '🟢';
  return '🟡';
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

function buildMorningMessage(user, dateKey, tasks, settings) {
  const displayName = escapeHtml(user.name || settings?.user_name || 'there');
  const goalTasks = Number(settings?.daily_goal_tasks) || 5;
  const openTasks = tasks.filter((t) => t.status !== 'done');
  const doneCount = tasks.length - openTasks.length;

  const lines = [
    `☀️ <b>Good morning, ${displayName}!</b>`,
    `📅 Agenda for <code>${escapeHtml(dateKey)}</code> (${escapeHtml(user.timezone || DEFAULT_TIMEZONE)})`,
    ''
  ];

  if (tasks.length === 0) {
    lines.push('No tasks planned for today yet.');
    lines.push('Send <code>/add Your task title</code> to capture your top priority.');
  } else {
    const preview = tasks.slice(0, 10);
    preview.forEach((task, idx) => {
      const icon = task.status === 'done' ? '✅' : formatPriorityBadge(task.priority);
      const timeHint = task.scheduled_time ? ` (${escapeHtml(task.scheduled_time)})` : '';
      lines.push(`${idx + 1}. ${icon} ${escapeHtml(task.title)}${timeHint}`);
    });
    if (tasks.length > preview.length) {
      lines.push(`<i>…and ${tasks.length - preview.length} more task(s)</i>`);
    }
    lines.push('');
    lines.push(`🎯 Daily goal: <b>${doneCount}/${goalTasks}</b> completed • Open: <b>${openTasks.length}</b>`);
    lines.push('Tip: reply <code>/done 1</code> to check off a task or <code>/today</code> anytime.');
  }

  return lines.join('\n');
}

function buildEveningMessage(user, dateKey, tasks, settings) {
  const displayName = escapeHtml(user.name || settings?.user_name || 'there');
  const goalTasks = Number(settings?.daily_goal_tasks) || 5;
  const goalMinutes = Number(settings?.daily_goal_minutes) || 120;
  const total = tasks.length;
  const doneTasks = tasks.filter((t) => t.status === 'done');
  const openTasks = tasks.filter((t) => t.status !== 'done');
  const actualMinutes = tasks.reduce((sum, t) => sum + (Number(t.actual_minutes) || 0), 0);
  const pct = total > 0 ? Math.round((doneTasks.length / total) * 100) : 0;

  const lines = [
    `🌙 <b>Evening check-in, ${displayName}</b>`,
    `📅 Summary for <code>${escapeHtml(dateKey)}</code>`,
    '',
    `✅ Completed: <b>${doneTasks.length}/${total}</b> (${pct}%)`,
    `🎯 Daily goal: <b>${doneTasks.length}/${goalTasks}</b> tasks`,
    `⏱️ Focus logged: <b>${formatMinutes(actualMinutes)}</b> / ${formatMinutes(goalMinutes)}`
  ];

  if (openTasks.length > 0) {
    lines.push('');
    lines.push(`📌 <b>Remaining (${openTasks.length}):</b>`);
    openTasks.slice(0, 5).forEach((task) => {
      lines.push(`• ${escapeHtml(task.title)}`);
    });
    if (openTasks.length > 5) {
      lines.push(`<i>…and ${openTasks.length - 5} more</i>`);
    }
  } else if (total > 0) {
    lines.push('');
    lines.push('🎉 All planned tasks for today are complete!');
  }

  lines.push('');
  lines.push('Reply <code>/today</code> to review or <code>/stats</code> for your streak.');
  return lines.join('\n');
}

const DEFAULT_APP_URL = 'https://workflow.myclass.uz';

function buildBriefingInlineKeyboard(appUrl = DEFAULT_APP_URL) {
  return {
    inline_keyboard: [
      [
        { text: "📋 Interactive Tasks", callback_data: 'act:today' },
        { text: '➕ Add Task', callback_data: 'act:add' }
      ],
      [
        { text: '📊 Progress & Stats', callback_data: 'act:stats' },
        { text: '🌐 Open TaskFlow', web_app: { url: appUrl } }
      ]
    ]
  };
}

async function sendTelegramMessage(botToken, chatId, text, replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Telegram sendMessage failed (${response.status}): ${errText}`);
  }
  return response.json();
}

export async function runHourlyBriefings(env, now = new Date()) {
  if (!env?.DB || !env?.TELEGRAM_BOT_TOKEN) {
    return { ok: false, skipped: true, reason: 'missing_bindings', sentMorning: 0, sentEvening: 0 };
  }

  const usersResult = await env.DB.prepare(
    `SELECT id, name, email, timezone, telegram_chat_id,
            telegram_notifications_enabled,
            morning_reminder_hour, evening_reminder_hour,
            last_morning_sent_date, last_evening_sent_date
     FROM users
     WHERE telegram_chat_id IS NOT NULL
       AND telegram_notifications_enabled = 1`
  ).all();

  const users = usersResult?.results || [];
  let sentMorning = 0;
  let sentEvening = 0;
  let errors = 0;

  for (const user of users) {
    try {
      const { dateKey, hour } = getLocalDateAndHour(now, user.timezone);
      const morningHour =
        user.morning_reminder_hour !== null &&
        user.morning_reminder_hour !== undefined &&
        user.morning_reminder_hour !== '' &&
        Number.isFinite(Number(user.morning_reminder_hour))
          ? Number(user.morning_reminder_hour)
          : 8;
      const eveningHour =
        user.evening_reminder_hour !== null &&
        user.evening_reminder_hour !== undefined &&
        user.evening_reminder_hour !== '' &&
        Number.isFinite(Number(user.evening_reminder_hour))
          ? Number(user.evening_reminder_hour)
          : 21;

      const shouldMorning = hour === morningHour && user.last_morning_sent_date !== dateKey;
      const shouldEvening = hour === eveningHour && user.last_evening_sent_date !== dateKey;

      if (!shouldMorning && !shouldEvening) {
        continue;
      }

      const [tasksRes, settingsRes] = await env.DB.batch([
        env.DB.prepare(
          `SELECT id, title, status, priority, scheduled_time, time_block, estimated_minutes, actual_minutes
           FROM tasks
           WHERE user_id = ? AND date = ?
           ORDER BY sort_order ASC, created_at ASC`
        ).bind(user.id, dateKey),
        env.DB.prepare(
          `SELECT daily_goal_tasks, daily_goal_minutes, user_name
           FROM user_settings
           WHERE user_id = ?`
        ).bind(user.id)
      ]);

      const tasks = tasksRes?.results || [];
      const settings = settingsRes?.results?.[0] || null;
      const nowIso = now.toISOString();

      const appUrl = env.APP_URL || DEFAULT_APP_URL;

      if (shouldMorning) {
        try {
          const text = buildMorningMessage(user, dateKey, tasks, settings);
          await sendTelegramMessage(
            env.TELEGRAM_BOT_TOKEN,
            user.telegram_chat_id,
            text,
            buildBriefingInlineKeyboard(appUrl)
          );
          await env.DB.prepare(
            `UPDATE users SET last_morning_sent_date = ?, updated_at = ? WHERE id = ?`
          )
            .bind(dateKey, nowIso, user.id)
            .run();
          sentMorning += 1;
        } catch (err) {
          errors += 1;
          console.error(`Morning briefing error for user ${user.id}:`, err);
        }
      }

      if (shouldEvening) {
        try {
          const text = buildEveningMessage(user, dateKey, tasks, settings);
          await sendTelegramMessage(
            env.TELEGRAM_BOT_TOKEN,
            user.telegram_chat_id,
            text,
            buildBriefingInlineKeyboard(appUrl)
          );
          await env.DB.prepare(
            `UPDATE users SET last_evening_sent_date = ?, updated_at = ? WHERE id = ?`
          )
            .bind(dateKey, nowIso, user.id)
            .run();
          sentEvening += 1;
        } catch (err) {
          errors += 1;
          console.error(`Evening briefing error for user ${user.id}:`, err);
        }
      }
    } catch (err) {
      errors += 1;
      console.error(`Cron user processing error for ${user?.id}:`, err);
    }
  }

  return { ok: true, checkedUsers: users.length, sentMorning, sentEvening, errors };
}

export default {
  async scheduled(controller, env, ctx) {
    const runAt = controller?.scheduledTime ? new Date(controller.scheduledTime) : new Date();
    const promise = runHourlyBriefings(env, runAt);
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(promise);
    }
    return promise;
  },

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return jsonResponse({ ok: true, worker: 'taskflow-telegram-cron' });
    }
    return jsonResponse({ error: 'Not found', code: 'NOT_FOUND' }, 404);
  }
};
