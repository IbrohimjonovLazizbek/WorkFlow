const DEFAULT_TIMEZONE = 'Asia/Tashkent';
const DEFAULT_APP_URL = 'https://workflow.myclass.uz';

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

function addDaysToDateKey(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta, 12, 0, 0));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function getLocalDateAndHour(date, timeZone) {
  const safeTz = resolveValidTimezone(timeZone);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
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
    weekday: parts.weekday || '',
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute) % 60
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

function resolveReminderHour(raw, fallback) {
  if (raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw))) {
    return Math.min(23, Math.max(0, Math.round(Number(raw))));
  }
  return fallback;
}

function parseScheduledTimeMinutes(hhmm) {
  if (typeof hhmm !== 'string') return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
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
    lines.push('Tap <b>➕ Add Task</b> below or send <code>/add Your task title</code>.');
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
  lines.push('Use the buttons below to check tasks, trigger routines, or review stats.');
  return lines.join('\n');
}

function buildWeeklyScorecardMessage(user, dateKey, weekTasks, weekReflections, lookbackDoneDates) {
  const displayName = escapeHtml(user.name || 'there');
  const startDate = addDaysToDateKey(dateKey, -6);
  const total = weekTasks.length;
  const done = weekTasks.filter((t) => t.status === 'done').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const totalFocus = weekTasks.reduce((sum, t) => sum + (Number(t.actual_minutes) || 0), 0);

  const catLabels = {
    work: '💼 Work',
    health: '💚 Health',
    learning: '📚 Learning',
    personal: '🏠 Personal',
    admin: '🗂 Admin'
  };
  const catCounts = {};
  for (const t of weekTasks) {
    const k = t.category || 'work';
    catCounts[k] = (catCounts[k] || 0) + (t.status === 'done' ? 2 : 1);
  }
  const topCatKey = Object.keys(catCounts).sort((a, b) => catCounts[b] - catCounts[a])[0];
  const topCatText = topCatKey ? (catLabels[topCatKey] || topCatKey) : '—';

  const moodValues = weekReflections
    .map((r) => Number(r.mood))
    .filter((m) => Number.isFinite(m) && m >= 1 && m <= 5);
  const avgMood = moodValues.length > 0
    ? `${(moodValues.reduce((s, v) => s + v, 0) / moodValues.length).toFixed(1)}/5`
    : 'Not logged';

  let streak = 0;
  let cursor = lookbackDoneDates.has(dateKey) ? dateKey : addDaysToDateKey(dateKey, -1);
  while (lookbackDoneDates.has(cursor)) {
    streak += 1;
    cursor = addDaysToDateKey(cursor, -1);
  }

  const openLeft = weekTasks.filter((t) => t.status !== 'done').slice(0, 3);
  const lines = [
    `🏆 <b>Weekly Scorecard for ${displayName}</b>`,
    `📆 <code>${escapeHtml(startDate)}</code> → <code>${escapeHtml(dateKey)}</code>`,
    '',
    `✅ Completion: <b>${done}/${total}</b> tasks (${pct}%)`,
    `⏱️ Total Focus: <b>${formatMinutes(totalFocus)}</b>`,
    `🏅 Top Focus Area: <b>${escapeHtml(topCatText)}</b>`,
    `😊 Avg Mood: <b>${escapeHtml(avgMood)}</b>`,
    `🔥 Active Streak: <b>${streak} day(s)</b>`
  ];

  if (openLeft.length > 0) {
    lines.push('');
    lines.push('📋 <b>Roll into next week:</b>');
    openLeft.forEach((t) => {
      lines.push(`• ${escapeHtml(t.title)}`);
    });
  }

  return lines.join('\n');
}

function buildBriefingInlineKeyboard(appUrl = DEFAULT_APP_URL) {
  return {
    inline_keyboard: [
      [
        { text: "📋 Today's Tasks", callback_data: 'act:today' },
        { text: '➕ Add Task', callback_data: 'act:add' }
      ],
      [
        { text: '🔄 Routines', callback_data: 'act:routines' },
        { text: '📊 Stats', callback_data: 'act:stats' },
        { text: '🌐 Open TaskFlow', web_app: { url: appUrl } }
      ]
    ]
  };
}

function buildTaskAlertInlineKeyboard(task, dateKey, idx) {
  const canDirect = new TextEncoder().encode(`t:${task.id}`).length <= 64;
  const doneCb = canDirect ? `t:${task.id}` : `ti:${dateKey}:${idx}`;
  const snoozeCb = canDirect ? `ts:${task.id}:60` : `tsi:${dateKey}:${idx}:60`;
  return {
    inline_keyboard: [
      [
        { text: '✅ Mark Done', callback_data: doneCb },
        { text: '⏰ Snooze +1h', callback_data: snoozeCb }
      ],
      [
        { text: "📋 Today's Tasks", callback_data: 'act:today' },
        { text: '➕ Add Task', callback_data: 'act:add' }
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
    return { ok: false, skipped: true, reason: 'missing_bindings', sentMorning: 0, sentEvening: 0, sentWeekly: 0, sentTaskAlerts: 0, sentTimerAlerts: 0 };
  }

  const usersResult = await env.DB.prepare(
    `SELECT id, name, email, timezone, telegram_chat_id,
            telegram_notifications_enabled,
            morning_reminder_hour, evening_reminder_hour,
            last_morning_sent_date, last_evening_sent_date,
            last_weekly_sent_date, active_timer_json, timer_notified_for
     FROM users
     WHERE telegram_chat_id IS NOT NULL
       AND telegram_notifications_enabled = 1`
  ).all();

  const users = usersResult?.results || [];
  let sentMorning = 0;
  let sentEvening = 0;
  let sentWeekly = 0;
  let sentTaskAlerts = 0;
  let sentTimerAlerts = 0;
  let errors = 0;

  const appUrl = env.APP_URL || DEFAULT_APP_URL;

  for (const user of users) {
    try {
      const { dateKey, weekday, hour, minute } = getLocalDateAndHour(now, user.timezone);
      const morningHour = resolveReminderHour(user.morning_reminder_hour, 8);
      const eveningHour = resolveReminderHour(user.evening_reminder_hour, 21);
      const nowMinutes = hour * 60 + minute;

      const shouldMorning = hour === morningHour && user.last_morning_sent_date !== dateKey;
      const shouldEvening = hour === eveningHour && user.last_evening_sent_date !== dateKey;
      const shouldWeekly = weekday === 'Sun' && hour === eveningHour && user.last_weekly_sent_date !== dateKey;

      const [tasksRes, settingsRes] = await env.DB.batch([
        env.DB.prepare(
          `SELECT id, title, status, priority, scheduled_time, time_block, estimated_minutes, actual_minutes, alert_sent_for
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
          ).bind(dateKey, nowIso, user.id).run();
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
          ).bind(dateKey, nowIso, user.id).run();
          sentEvening += 1;
        } catch (err) {
          errors += 1;
          console.error(`Evening briefing error for user ${user.id}:`, err);
        }
      }

      if (shouldWeekly) {
        try {
          const weekStart = addDaysToDateKey(dateKey, -6);
          const streakLookbackStart = addDaysToDateKey(dateKey, -89);
          const [weekTasksRes, weekRefsRes, streakRes] = await env.DB.batch([
            env.DB.prepare(
              `SELECT status, category, actual_minutes, title FROM tasks WHERE user_id = ? AND date >= ? AND date <= ?`
            ).bind(user.id, weekStart, dateKey),
            env.DB.prepare(
              `SELECT mood FROM reflections WHERE user_id = ? AND date >= ? AND date <= ?`
            ).bind(user.id, weekStart, dateKey),
            env.DB.prepare(
              `SELECT DISTINCT date FROM tasks WHERE user_id = ? AND status = 'done' AND date >= ? AND date <= ?`
            ).bind(user.id, streakLookbackStart, dateKey)
          ]);
          const doneDates = new Set((streakRes?.results || []).map((r) => r.date));
          const weeklyMsg = buildWeeklyScorecardMessage(
            user,
            dateKey,
            weekTasksRes?.results || [],
            weekRefsRes?.results || [],
            doneDates
          );
          await sendTelegramMessage(
            env.TELEGRAM_BOT_TOKEN,
            user.telegram_chat_id,
            weeklyMsg,
            buildBriefingInlineKeyboard(appUrl)
          );
          await env.DB.prepare(
            `UPDATE users SET last_weekly_sent_date = ?, updated_at = ? WHERE id = ?`
          ).bind(dateKey, nowIso, user.id).run();
          sentWeekly += 1;
        } catch (err) {
          errors += 1;
          console.error(`Weekly scorecard error for user ${user.id}:`, err);
        }
      }

      // Per-task scheduled_time alerts (~10 min before scheduled time up to +4 min window)
      for (let i = 0; i < tasks.length; i += 1) {
        const task = tasks[i];
        if (task.status === 'done' || !task.scheduled_time) continue;
        const schedMinutes = parseScheduledTimeMinutes(task.scheduled_time);
        if (schedMinutes === null) continue;
        const delta = schedMinutes - nowMinutes;
        if (delta < -4 || delta > 10) continue;

        const alertKey = `${dateKey} ${task.scheduled_time}`;
        if (task.alert_sent_for === alertKey) continue;

        try {
          const priIcon = formatPriorityBadge(task.priority);
          const whenLabel = delta > 0 ? `in ${delta} min` : (delta === 0 ? 'now' : `${Math.abs(delta)}m ago`);
          const alertMsg = [
            `⏰ <b>Scheduled Task (${escapeHtml(task.scheduled_time)} • ${whenLabel})</b>`,
            `${priIcon} <b>${escapeHtml(task.title)}</b>`,
            task.estimated_minutes ? `⏱️ Est: ${formatMinutes(task.estimated_minutes)}` : ''
          ].filter(Boolean).join('\n');

          await sendTelegramMessage(
            env.TELEGRAM_BOT_TOKEN,
            user.telegram_chat_id,
            alertMsg,
            buildTaskAlertInlineKeyboard(task, dateKey, i)
          );
          await env.DB.prepare(
            `UPDATE tasks SET alert_sent_for = ? WHERE id = ? AND user_id = ?`
          ).bind(alertKey, task.id, user.id).run();
          sentTaskAlerts += 1;
        } catch (err) {
          errors += 1;
          console.error(`Task alert error for task ${task.id}:`, err);
        }
      }

      // Cross-device focus timer completion ping
      if (user.active_timer_json) {
        try {
          const tState = JSON.parse(user.active_timer_json);
          if (tState && tState.status === 'running' && tState.mode !== 'stopwatch' && Number(tState.startedAtMs) > 0 && Number(tState.durationSeconds) > 0) {
            const elapsedBefore = Math.max(0, Number(tState.elapsedBeforePauseSeconds) || 0);
            const endsAtMs = Number(tState.startedAtMs) + Math.max(0, Number(tState.durationSeconds) - elapsedBefore) * 1000;
            const notifyKey = `${tState.startedAtMs}:${tState.durationSeconds}:${elapsedBefore}`;
            if (now.getTime() >= endsAtMs && user.timer_notified_for !== notifyKey) {
              let taskTitle = '';
              if (tState.attachedTaskId) {
                const taskRow = await env.DB.prepare('SELECT title FROM tasks WHERE id = ? AND user_id = ?')
                  .bind(tState.attachedTaskId, user.id)
                  .first();
                if (taskRow?.title) taskTitle = taskRow.title;
              }
              const modeNames = { pomodoro: 'Pomodoro (25m)', deep: 'Deep Focus (50m)', break: 'Short Break (5m)' };
              const msg = [
                `🔔 <b>Focus Sprint Complete!</b>`,
                `Mode: <b>${escapeHtml(modeNames[tState.mode] || tState.mode)}</b>`,
                taskTitle ? `Task: <b>${escapeHtml(taskTitle)}</b>` : 'Great focus block — time for a quick break!'
              ].join('\n');

              await sendTelegramMessage(
                env.TELEGRAM_BOT_TOKEN,
                user.telegram_chat_id,
                msg,
                buildBriefingInlineKeyboard(appUrl)
              );
              await env.DB.prepare(
                `UPDATE users SET timer_notified_for = ?, updated_at = ? WHERE id = ?`
              ).bind(notifyKey, nowIso, user.id).run();
              sentTimerAlerts += 1;
            }
          }
        } catch (err) {
          errors += 1;
          console.error(`Timer alert error for user ${user.id}:`, err);
        }
      }
    } catch (err) {
      errors += 1;
      console.error(`Cron user processing error for ${user?.id}:`, err);
    }
  }

  return {
    ok: true,
    checkedUsers: users.length,
    sentMorning,
    sentEvening,
    sentWeekly,
    sentTaskAlerts,
    sentTimerAlerts,
    errors
  };
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
