(function (global) {
  'use strict';

  var TaskFlow = global.TaskFlow = global.TaskFlow || {};

  var GUEST_STORAGE_KEY = 'taskflow_state_v1';
  var CLOUD_CACHE_PREFIX = 'taskflow_cloud_cache_v1_';
  var VALID_VIEWS = ['today', 'upcoming', 'analytics', 'routines'];
  var VALID_THEMES = ['light', 'dark'];
  var VALID_TIME_BLOCKS = ['morning', 'afternoon', 'evening', 'anytime'];
  var VALID_PRIORITIES = ['high', 'medium', 'low'];
  var VALID_CATEGORIES = ['work', 'health', 'learning', 'personal', 'admin'];
  var VALID_STATUSES = ['todo', 'in_progress', 'done'];
  var VALID_SORTS = ['manual', 'priority', 'time', 'scheduledTime', 'duration', 'estimatedMinutes'];
  var VALID_FILTER_STATUSES = ['all', 'active', 'todo', 'in_progress', 'done'];

  var CATEGORY_META = {
    work: { label: 'Work', color: '#4f46e5' },
    health: { label: 'Health', color: '#10b981' },
    learning: { label: 'Learning', color: '#0ea5e9' },
    personal: { label: 'Personal', color: '#f59e0b' },
    admin: { label: 'Admin', color: '#8b5cf6' }
  };

  var PRIORITY_WEIGHT = { high: 0, medium: 1, low: 2 };
  var BLOCK_WEIGHT = { morning: 0, afternoon: 1, evening: 2, anytime: 3 };

  /* =========================================================================
   * Utils
   * ========================================================================= */
  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function isValidDateKey(str) {
    if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
    var parts = str.split('-');
    var y = Number(parts[0]);
    var m = Number(parts[1]);
    var d = Number(parts[2]);
    var dt = new Date(y, m - 1, d, 12, 0, 0, 0);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  function parseDateKey(dateStr) {
    if (!isValidDateKey(dateStr)) return null;
    var parts = dateStr.split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0, 0);
  }

  function toDateKey(dateObj) {
    return dateObj.getFullYear() + '-' + pad2(dateObj.getMonth() + 1) + '-' + pad2(dateObj.getDate());
  }

  function todayKey() {
    return toDateKey(new Date());
  }

  function addDays(dateStr, delta) {
    var base = parseDateKey(dateStr) || parseDateKey(todayKey());
    base.setDate(base.getDate() + (Number(delta) || 0));
    return toDateKey(base);
  }

  function diffDays(fromStr, toStr) {
    var a = parseDateKey(fromStr);
    var b = parseDateKey(toStr);
    if (!a || !b) return 0;
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }

  var SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function formatDateLabel(dateStr) {
    var dt = parseDateKey(dateStr);
    if (!dt) return String(dateStr || '');
    var today = todayKey();
    var monthDay = SHORT_MONTHS[dt.getMonth()] + ' ' + dt.getDate();
    if (dateStr === today) return 'Today, ' + monthDay;
    if (dateStr === addDays(today, 1)) return 'Tomorrow, ' + monthDay;
    if (dateStr === addDays(today, -1)) return 'Yesterday, ' + monthDay;
    return SHORT_DAYS[dt.getDay()] + ', ' + monthDay;
  }

  function formatMinutes(mins) {
    var m = Math.max(0, Math.round(Number(mins) || 0));
    if (m === 0) return '0m';
    var h = Math.floor(m / 60);
    var rem = m % 60;
    if (h === 0) return rem + 'm';
    if (rem === 0) return h + 'h';
    return h + 'h ' + rem + 'm';
  }

  var uidCounter = 0;
  function uid(prefix) {
    uidCounter += 1;
    var p = prefix || 'id';
    return p + '_' + Date.now().toString(36) + '_' + uidCounter.toString(36) + Math.random().toString(36).slice(2, 5);
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clamp(n, min, max) {
    var num = Number(n);
    if (!Number.isFinite(num)) return min;
    return Math.min(max, Math.max(min, num));
  }

  var Utils = {
    todayKey: todayKey,
    addDays: addDays,
    diffDays: diffDays,
    parseDateKey: parseDateKey,
    toDateKey: toDateKey,
    isValidDateKey: isValidDateKey,
    formatDateLabel: formatDateLabel,
    formatMinutes: formatMinutes,
    uid: uid,
    escapeHtml: escapeHtml,
    clamp: clamp,
    CATEGORIES: VALID_CATEGORIES.slice(),
    CATEGORY_META: CATEGORY_META,
    PRIORITIES: VALID_PRIORITIES.slice(),
    TIME_BLOCKS: VALID_TIME_BLOCKS.slice(),
    SHORT_MONTHS: SHORT_MONTHS.slice(),
    SHORT_DAYS: SHORT_DAYS.slice()
  };

  /* =========================================================================
   * Normalizers & Defaults
   * ========================================================================= */
  function defaultSettings() {
    return {
      dailyGoalTasks: 5,
      dailyGoalMinutes: 120,
      soundEnabled: true,
      userName: 'Daily Workspace',
      showCompleted: true
    };
  }

  function defaultFilters() {
    return {
      status: 'all',
      category: 'all',
      priority: 'all',
      sort: 'manual',
      search: ''
    };
  }

  function normalizeSubtask(sub) {
    if (!sub) return null;
    if (typeof sub === 'string') {
      var text = sub.trim();
      if (!text) return null;
      return { id: uid('sub'), title: text, done: false };
    }
    var title = typeof sub.title === 'string' ? sub.title.trim() : '';
    if (!title) return null;
    return {
      id: typeof sub.id === 'string' && sub.id ? sub.id : uid('sub'),
      title: title,
      done: Boolean(sub.done)
    };
  }

  function normalizeTime(val) {
    if (typeof val !== 'string') return '';
    var trimmed = val.trim();
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(trimmed) ? trimmed : '';
  }

  function normalizeTask(raw, fallbackDate, fallbackOrder) {
    if (!raw || typeof raw !== 'object') return null;
    var title = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (!title) return null;

    var status = VALID_STATUSES.indexOf(raw.status) !== -1 ? raw.status : 'todo';
    var date = isValidDateKey(raw.date) ? raw.date : (isValidDateKey(fallbackDate) ? fallbackDate : todayKey());
    var subtasks = Array.isArray(raw.subtasks)
      ? raw.subtasks.map(normalizeSubtask).filter(Boolean)
      : [];
    var nowIso = new Date().toISOString();

    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid('task'),
      title: title,
      notes: typeof raw.notes === 'string' ? raw.notes : '',
      date: date,
      timeBlock: VALID_TIME_BLOCKS.indexOf(raw.timeBlock) !== -1 ? raw.timeBlock : 'anytime',
      scheduledTime: normalizeTime(raw.scheduledTime),
      estimatedMinutes: clamp(raw.estimatedMinutes !== undefined ? raw.estimatedMinutes : 30, 0, 1440),
      actualMinutes: clamp(raw.actualMinutes !== undefined ? raw.actualMinutes : 0, 0, 1440),
      priority: VALID_PRIORITIES.indexOf(raw.priority) !== -1 ? raw.priority : 'medium',
      category: VALID_CATEGORIES.indexOf(raw.category) !== -1 ? raw.category : 'work',
      status: status,
      subtasks: subtasks,
      routineId: typeof raw.routineId === 'string' && raw.routineId ? raw.routineId : null,
      order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : (Number(fallbackOrder) || 0),
      createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : nowIso,
      completedAt: status === 'done'
        ? (typeof raw.completedAt === 'string' && raw.completedAt ? raw.completedAt : nowIso)
        : null
    };
  }

  function normalizeRoutine(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var title = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (!title) return null;

    var subtasks = Array.isArray(raw.subtasks)
      ? raw.subtasks
          .map(function (s) {
            if (typeof s === 'string') return s.trim();
            if (s && typeof s.title === 'string') return s.title.trim();
            return '';
          })
          .filter(Boolean)
      : [];

    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid('rtn'),
      title: title,
      category: VALID_CATEGORIES.indexOf(raw.category) !== -1 ? raw.category : 'work',
      priority: VALID_PRIORITIES.indexOf(raw.priority) !== -1 ? raw.priority : 'medium',
      timeBlock: VALID_TIME_BLOCKS.indexOf(raw.timeBlock) !== -1 ? raw.timeBlock : 'morning',
      estimatedMinutes: clamp(raw.estimatedMinutes !== undefined ? raw.estimatedMinutes : 20, 5, 480),
      schedule: raw.schedule === 'weekdays' ? 'weekdays' : 'daily',
      active: raw.active !== undefined ? Boolean(raw.active) : true,
      subtasks: subtasks
    };
  }

  function normalizeReflection(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var mood = raw.mood === null || raw.mood === undefined ? null : clamp(Math.round(Number(raw.mood)), 1, 5);
    return {
      mood: Number.isFinite(Number(raw.mood)) && raw.mood !== null ? mood : null,
      intention: typeof raw.intention === 'string' ? raw.intention : '',
      reflection: typeof raw.reflection === 'string' ? raw.reflection : '',
      updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : new Date().toISOString()
    };
  }

  function normalizeSettings(raw) {
    var def = defaultSettings();
    if (!raw || typeof raw !== 'object') return def;
    var userName = typeof raw.userName === 'string' && raw.userName.trim() ? raw.userName.trim().slice(0, 60) : def.userName;
    return {
      dailyGoalTasks: clamp(Math.round(raw.dailyGoalTasks !== undefined ? raw.dailyGoalTasks : def.dailyGoalTasks), 1, 50),
      dailyGoalMinutes: clamp(Math.round(raw.dailyGoalMinutes !== undefined ? raw.dailyGoalMinutes : def.dailyGoalMinutes), 15, 720),
      soundEnabled: raw.soundEnabled !== undefined ? Boolean(raw.soundEnabled) : def.soundEnabled,
      userName: userName,
      showCompleted: raw.showCompleted !== undefined ? Boolean(raw.showCompleted) : def.showCompleted
    };
  }

  function normalizeFilters(raw) {
    var def = defaultFilters();
    if (!raw || typeof raw !== 'object') return def;
    return {
      status: VALID_FILTER_STATUSES.indexOf(raw.status) !== -1 ? raw.status : 'all',
      category: raw.category === 'all' || VALID_CATEGORIES.indexOf(raw.category) !== -1 ? raw.category : 'all',
      priority: raw.priority === 'all' || VALID_PRIORITIES.indexOf(raw.priority) !== -1 ? raw.priority : 'all',
      sort: VALID_SORTS.indexOf(raw.sort) !== -1 ? raw.sort : 'manual',
      search: typeof raw.search === 'string' ? raw.search : ''
    };
  }

  function normalizeUser(raw) {
    if (!raw || typeof raw !== 'object' || !raw.id) return null;
    return {
      id: String(raw.id),
      email: raw.email ? String(raw.email) : '',
      name: raw.name ? String(raw.name) : (raw.email ? String(raw.email).split('@')[0] : 'TaskFlow User'),
      avatarUrl: raw.avatarUrl || raw.avatar_url || '',
      timezone: raw.timezone ? String(raw.timezone) : 'Asia/Tashkent',
      telegramChatId: raw.telegramChatId !== undefined ? raw.telegramChatId : (raw.telegram_chat_id || null),
      telegramUsername: raw.telegramUsername !== undefined ? raw.telegramUsername : (raw.telegram_username || null),
      telegramNotificationsEnabled: raw.telegramNotificationsEnabled !== undefined
        ? Boolean(raw.telegramNotificationsEnabled)
        : (raw.telegram_notifications_enabled !== undefined ? Boolean(raw.telegram_notifications_enabled) : true),
      morningReminderHour: clamp(
        Math.round(raw.morningReminderHour !== undefined ? raw.morningReminderHour : (raw.morning_reminder_hour !== undefined ? raw.morning_reminder_hour : 8)),
        0, 23
      ),
      eveningReminderHour: clamp(
        Math.round(raw.eveningReminderHour !== undefined ? raw.eveningReminderHour : (raw.evening_reminder_hour !== undefined ? raw.evening_reminder_hour : 21)),
        0, 23
      )
    };
  }

  function createEmptyState() {
    return {
      version: 1,
      selectedDate: todayKey(),
      activeView: 'today',
      theme: 'light',
      settings: defaultSettings(),
      tasks: [],
      routines: [],
      reflections: {},
      filters: defaultFilters(),
      isSampleData: false
    };
  }

  /* =========================================================================
   * First-run Seed Dataset (14 days history + today + upcoming + 4 routines)
   * ========================================================================= */
  function isWeekday(dateStr) {
    var dt = parseDateKey(dateStr);
    if (!dt) return true;
    var day = dt.getDay();
    return day >= 1 && day <= 5;
  }

  function createSeedState() {
    var today = todayKey();
    var routines = [
      {
        id: 'rtn_morning_plan',
        title: 'Morning Planning & Top 3 Priorities',
        category: 'work',
        priority: 'high',
        timeBlock: 'morning',
        estimatedMinutes: 15,
        schedule: 'daily',
        active: true,
        subtasks: ['Review calendar & deadlines', 'Pick 3 non-negotiable outcomes', 'Clear urgent messages']
      },
      {
        id: 'rtn_deep_sprint',
        title: 'Deep Focus Work Sprint',
        category: 'work',
        priority: 'high',
        timeBlock: 'morning',
        estimatedMinutes: 50,
        schedule: 'weekdays',
        active: true,
        subtasks: ['Silence notifications', 'Ship core milestone without context switching']
      },
      {
        id: 'rtn_midday_walk',
        title: 'Midday Walk & Hydration Reset',
        category: 'health',
        priority: 'medium',
        timeBlock: 'afternoon',
        estimatedMinutes: 20,
        schedule: 'daily',
        active: true,
        subtasks: ['15-minute outdoor walk', 'Stretch shoulders & refill water']
      },
      {
        id: 'rtn_evening_shutdown',
        title: 'Evening Shutdown & Reflection',
        category: 'personal',
        priority: 'low',
        timeBlock: 'evening',
        estimatedMinutes: 15,
        schedule: 'daily',
        active: true,
        subtasks: ['Log completed tasks', 'Capture tomorrow top priority']
      }
    ];

    var pastTemplates = [
      { title: 'Draft Q4 product roadmap brief', category: 'work', priority: 'high', timeBlock: 'morning', est: 45, actual: 50, time: '09:30' },
      { title: 'Code review & PR feedback session', category: 'work', priority: 'medium', timeBlock: 'afternoon', est: 30, actual: 30, time: '14:00' },
      { title: 'Read 20 pages of Designing Data-Intensive Apps', category: 'learning', priority: 'medium', timeBlock: 'evening', est: 30, actual: 35, time: '20:00' },
      { title: 'Strength & mobility workout', category: 'health', priority: 'high', timeBlock: 'afternoon', est: 45, actual: 45, time: '17:30' },
      { title: 'Reconcile monthly invoices & receipts', category: 'admin', priority: 'low', timeBlock: 'afternoon', est: 25, actual: 20, time: '16:00' },
      { title: 'Practice TypeScript type-level patterns', category: 'learning', priority: 'medium', timeBlock: 'morning', est: 30, actual: 30, time: '11:00' },
      { title: 'Prepare weekly team sync agenda', category: 'work', priority: 'high', timeBlock: 'morning', est: 25, actual: 25, time: '09:00' },
      { title: 'Grocery restock & healthy meal prep', category: 'personal', priority: 'medium', timeBlock: 'evening', est: 40, actual: 40, time: '18:30' },
      { title: 'Audit cloud billing & storage alerts', category: 'admin', priority: 'medium', timeBlock: 'afternoon', est: 20, actual: 20, time: '15:00' },
      { title: 'Refactor dashboard SVG accessibility labels', category: 'work', priority: 'high', timeBlock: 'morning', est: 45, actual: 55, time: '10:00' }
    ];

    var reflectionNotes = [
      { mood: 4, intention: 'Protect the first 90 minutes for uninterrupted deep work.', reflection: 'Shipped core sprint early; midday walk kept afternoon energy steady.' },
      { mood: 5, intention: 'Close two high-leverage tasks before lunch.', reflection: 'Great momentum all day. Zero context switching during the morning block.' },
      { mood: 3, intention: 'Keep meetings concise and finish admin backlog.', reflection: 'Meetings ran slightly long, but still cleared 4 key tasks.' },
      { mood: 4, intention: 'Stay consistent with health reset and evening shutdown.', reflection: 'Felt calm wrapping up on time with tomorrow already mapped out.' },
      { mood: 5, intention: 'Focus on quality over speed in code reviews.', reflection: 'Caught an edge case early and finished reading chapter 4.' },
      { mood: 4, intention: 'Chip away at overdue admin items steadily.', reflection: 'Batching admin tasks into one 45m afternoon block worked really well.' }
    ];

    var tasks = [];
    var reflections = {};
    var seq = 1;

    function makePastTimestamp(dateStr, hhmm) {
      return dateStr + 'T' + (hhmm || '17:00') + ':00.000Z';
    }

    for (var offset = -14; offset <= -1; offset += 1) {
      var dStr = addDays(today, offset);
      var dayIdx = offset + 14;
      var order = 0;

      var morningRtn = routines[0];
      var middayRtn = routines[2];
      var eveningRtn = routines[3];

      var missDay = offset === -9;

      tasks.push({
        id: 'seed_t_' + (seq++),
        title: morningRtn.title,
        notes: 'Routine check-in completed.',
        date: dStr,
        timeBlock: morningRtn.timeBlock,
        scheduledTime: '08:15',
        estimatedMinutes: morningRtn.estimatedMinutes,
        actualMinutes: missDay ? 0 : 15,
        priority: morningRtn.priority,
        category: morningRtn.category,
        status: missDay ? 'todo' : 'done',
        subtasks: morningRtn.subtasks.map(function (st, idx) {
          return { id: 'seed_sub_' + (seq++), title: st, done: !missDay || idx === 0 };
        }),
        routineId: morningRtn.id,
        order: order++,
        createdAt: makePastTimestamp(dStr, '08:00'),
        completedAt: missDay ? null : makePastTimestamp(dStr, '08:30')
      });

      if (isWeekday(dStr)) {
        var sprintRtn = routines[1];
        var sprintDone = !missDay;
        tasks.push({
          id: 'seed_t_' + (seq++),
          title: sprintRtn.title,
          notes: 'Focused 50-minute uninterrupted sprint.',
          date: dStr,
          timeBlock: sprintRtn.timeBlock,
          scheduledTime: '09:00',
          estimatedMinutes: sprintRtn.estimatedMinutes,
          actualMinutes: sprintDone ? 50 : 0,
          priority: sprintRtn.priority,
          category: sprintRtn.category,
          status: sprintDone ? 'done' : 'todo',
          subtasks: sprintRtn.subtasks.map(function (st) {
            return { id: 'seed_sub_' + (seq++), title: st, done: sprintDone };
          }),
          routineId: sprintRtn.id,
          order: order++,
          createdAt: makePastTimestamp(dStr, '08:00'),
          completedAt: sprintDone ? makePastTimestamp(dStr, '09:55') : null
        });
      }

      if (!missDay && dayIdx % 2 === 0) {
        tasks.push({
          id: 'seed_t_' + (seq++),
          title: middayRtn.title,
          notes: '',
          date: dStr,
          timeBlock: middayRtn.timeBlock,
          scheduledTime: '13:00',
          estimatedMinutes: middayRtn.estimatedMinutes,
          actualMinutes: 20,
          priority: middayRtn.priority,
          category: middayRtn.category,
          status: 'done',
          subtasks: middayRtn.subtasks.map(function (st) {
            return { id: 'seed_sub_' + (seq++), title: st, done: true };
          }),
          routineId: middayRtn.id,
          order: order++,
          createdAt: makePastTimestamp(dStr, '08:00'),
          completedAt: makePastTimestamp(dStr, '13:25')
        });
      }

      if (!missDay && offset >= -7) {
        tasks.push({
          id: 'seed_t_' + (seq++),
          title: eveningRtn.title,
          notes: '',
          date: dStr,
          timeBlock: eveningRtn.timeBlock,
          scheduledTime: '18:30',
          estimatedMinutes: eveningRtn.estimatedMinutes,
          actualMinutes: 15,
          priority: eveningRtn.priority,
          category: eveningRtn.category,
          status: 'done',
          subtasks: eveningRtn.subtasks.map(function (st) {
            return { id: 'seed_sub_' + (seq++), title: st, done: true };
          }),
          routineId: eveningRtn.id,
          order: order++,
          createdAt: makePastTimestamp(dStr, '08:00'),
          completedAt: makePastTimestamp(dStr, '18:50')
        });
      }

      var countExtra = missDay ? 1 : (2 + (dayIdx % 3));
      for (var k = 0; k < countExtra; k += 1) {
        var tpl = pastTemplates[(dayIdx * 3 + k) % pastTemplates.length];
        var isRolloverCandidate = (offset === -1 && k === countExtra - 1) || (offset === -2 && k === countExtra - 1);
        var done = !missDay && !isRolloverCandidate && !(offset === -6 && k === 2);

        var customTitle = tpl.title;
        if (offset === -1 && k === countExtra - 1) {
          customTitle = 'Verify API rate-limit edge case tests';
        } else if (offset === -2 && k === countExtra - 1) {
          customTitle = 'Organize tax & expense folder for Q4';
        }

        tasks.push({
          id: 'seed_t_' + (seq++),
          title: customTitle,
          notes: done ? 'Wrapped up cleanly within planned estimate.' : 'Carried over — ready for next open focus slot.',
          date: dStr,
          timeBlock: tpl.timeBlock,
          scheduledTime: tpl.time,
          estimatedMinutes: tpl.est,
          actualMinutes: done ? tpl.actual : (isRolloverCandidate ? 10 : 0),
          priority: tpl.priority,
          category: tpl.category,
          status: done ? 'done' : (isRolloverCandidate ? 'in_progress' : 'todo'),
          subtasks: [],
          routineId: null,
          order: order++,
          createdAt: makePastTimestamp(dStr, '08:30'),
          completedAt: done ? makePastTimestamp(dStr, '16:45') : null
        });
      }

      if (!missDay) {
        var refTpl = reflectionNotes[dayIdx % reflectionNotes.length];
        reflections[dStr] = {
          mood: refTpl.mood,
          intention: refTpl.intention,
          reflection: refTpl.reflection,
          updatedAt: makePastTimestamp(dStr, '19:15')
        };
      }
    }

    var todayOrder = 0;
    tasks.push(
      {
        id: 'seed_today_1',
        title: routines[0].title,
        notes: 'Aligned top 3 outcomes before checking Slack.',
        date: today,
        timeBlock: 'morning',
        scheduledTime: '08:15',
        estimatedMinutes: 15,
        actualMinutes: 15,
        priority: 'high',
        category: 'work',
        status: 'done',
        subtasks: [
          { id: 'seed_sub_t1', title: 'Review calendar & deadlines', done: true },
          { id: 'seed_sub_t2', title: 'Pick 3 non-negotiable outcomes', done: true },
          { id: 'seed_sub_t3', title: 'Clear urgent messages', done: true }
        ],
        routineId: routines[0].id,
        order: todayOrder++,
        createdAt: makePastTimestamp(today, '08:00'),
        completedAt: makePastTimestamp(today, '08:35')
      },
      {
        id: 'seed_today_2',
        title: 'Finalize client milestone architecture deck',
        notes: 'Include latency benchmarks and phased rollout timeline.',
        date: today,
        timeBlock: 'morning',
        scheduledTime: '09:30',
        estimatedMinutes: 60,
        actualMinutes: 45,
        priority: 'high',
        category: 'work',
        status: 'in_progress',
        subtasks: [
          { id: 'seed_sub_t4', title: 'Export architecture flow diagram', done: true },
          { id: 'seed_sub_t5', title: 'Verify Q4 resource table', done: true },
          { id: 'seed_sub_t6', title: 'Write executive summary slide', done: false }
        ],
        routineId: null,
        order: todayOrder++,
        createdAt: makePastTimestamp(today, '08:20'),
        completedAt: null
      },
      {
        id: 'seed_today_3',
        title: routines[1].title,
        notes: 'First 50m sprint completed smoothly.',
        date: today,
        timeBlock: 'morning',
        scheduledTime: '11:00',
        estimatedMinutes: 50,
        actualMinutes: 50,
        priority: 'high',
        category: 'work',
        status: 'done',
        subtasks: [
          { id: 'seed_sub_t7', title: 'Silence notifications', done: true },
          { id: 'seed_sub_t8', title: 'Ship core milestone without context switching', done: true }
        ],
        routineId: routines[1].id,
        order: todayOrder++,
        createdAt: makePastTimestamp(today, '08:00'),
        completedAt: makePastTimestamp(today, '11:55')
      },
      {
        id: 'seed_today_4',
        title: routines[2].title,
        notes: '',
        date: today,
        timeBlock: 'afternoon',
        scheduledTime: '13:15',
        estimatedMinutes: 20,
        actualMinutes: 0,
        priority: 'medium',
        category: 'health',
        status: 'todo',
        subtasks: [
          { id: 'seed_sub_t9', title: '15-minute outdoor walk', done: false },
          { id: 'seed_sub_t10', title: 'Stretch shoulders & refill water', done: false }
        ],
        routineId: routines[2].id,
        order: todayOrder++,
        createdAt: makePastTimestamp(today, '08:00'),
        completedAt: null
      },
      {
        id: 'seed_today_5',
        title: 'Study Web Audio API synthesis & gain envelopes',
        notes: 'Bookmark reference curve examples for gentle UI chimes.',
        date: today,
        timeBlock: 'afternoon',
        scheduledTime: '15:00',
        estimatedMinutes: 35,
        actualMinutes: 0,
        priority: 'medium',
        category: 'learning',
        status: 'todo',
        subtasks: [
          { id: 'seed_sub_t11', title: 'Read AudioParam exponentialRampToValueAtTime notes', done: false },
          { id: 'seed_sub_t12', title: 'Test harmonic ratios', done: false }
        ],
        routineId: null,
        order: todayOrder++,
        createdAt: makePastTimestamp(today, '08:40'),
        completedAt: null
      },
      {
        id: 'seed_today_6',
        title: 'Submit monthly expense report',
        notes: 'Attach hotel & conference receipts.',
        date: today,
        timeBlock: 'anytime',
        scheduledTime: '',
        estimatedMinutes: 20,
        actualMinutes: 20,
        priority: 'low',
        category: 'admin',
        status: 'done',
        subtasks: [],
        routineId: null,
        order: todayOrder++,
        createdAt: makePastTimestamp(today, '09:00'),
        completedAt: makePastTimestamp(today, '12:15')
      },
      {
        id: 'seed_today_7',
        title: '45-minute evening run & cooldown stretch',
        notes: 'Easy Zone 2 pace along the park loop.',
        date: today,
        timeBlock: 'evening',
        scheduledTime: '18:00',
        estimatedMinutes: 45,
        actualMinutes: 0,
        priority: 'medium',
        category: 'health',
        status: 'todo',
        subtasks: [],
        routineId: null,
        order: todayOrder++,
        createdAt: makePastTimestamp(today, '09:10'),
        completedAt: null
      }
    );

    reflections[today] = {
      mood: 4,
      intention: 'Finish the architecture deck cleanly and take a real midday break.',
      reflection: '',
      updatedAt: makePastTimestamp(today, '08:30')
    };

    var tmrw = addDays(today, 1);
    var day2 = addDays(today, 2);
    var day3 = addDays(today, 3);

    tasks.push(
      {
        id: 'seed_up_1',
        title: 'Present architecture deck to engineering leads',
        notes: 'Walk through rollout milestones and risk mitigations.',
        date: tmrw,
        timeBlock: 'morning',
        scheduledTime: '10:00',
        estimatedMinutes: 45,
        actualMinutes: 0,
        priority: 'high',
        category: 'work',
        status: 'todo',
        subtasks: [
          { id: 'seed_sub_u1', title: 'Test screen-share demo', done: false },
          { id: 'seed_sub_u2', title: 'Share slides 15m early', done: false }
        ],
        routineId: null,
        order: 0,
        createdAt: makePastTimestamp(today, '10:00'),
        completedAt: null
      },
      {
        id: 'seed_up_2',
        title: 'Schedule dental cleaning & annual checkup',
        notes: '',
        date: tmrw,
        timeBlock: 'afternoon',
        scheduledTime: '14:30',
        estimatedMinutes: 15,
        actualMinutes: 0,
        priority: 'low',
        category: 'personal',
        status: 'todo',
        subtasks: [],
        routineId: null,
        order: 1,
        createdAt: makePastTimestamp(today, '10:05'),
        completedAt: null
      },
      {
        id: 'seed_up_3',
        title: 'Deep dive into CSS subgrid & container queries',
        notes: 'Build a reusable responsive card layout snippet.',
        date: day2,
        timeBlock: 'morning',
        scheduledTime: '09:30',
        estimatedMinutes: 50,
        actualMinutes: 0,
        priority: 'medium',
        category: 'learning',
        status: 'todo',
        subtasks: [],
        routineId: null,
        order: 0,
        createdAt: makePastTimestamp(today, '10:15'),
        completedAt: null
      },
      {
        id: 'seed_up_4',
        title: 'Weekly inbox zero & backup archive',
        notes: '',
        date: day3,
        timeBlock: 'afternoon',
        scheduledTime: '16:00',
        estimatedMinutes: 30,
        actualMinutes: 0,
        priority: 'low',
        category: 'admin',
        status: 'todo',
        subtasks: [],
        routineId: null,
        order: 0,
        createdAt: makePastTimestamp(today, '10:20'),
        completedAt: null
      }
    );

    return {
      version: 1,
      selectedDate: today,
      activeView: 'today',
      theme: 'light',
      settings: defaultSettings(),
      tasks: tasks,
      routines: routines,
      reflections: reflections,
      filters: defaultFilters(),
      isSampleData: true
    };
  }

  /* =========================================================================
   * Store State, Persistence, Cloud Sync & Listeners
   * ========================================================================= */
  var listeners = [];
  var undoStack = [];
  var MAX_UNDO = 25;
  var currentStorageKey = GUEST_STORAGE_KEY;

  var authState = {
    mode: 'guest', // 'guest' | 'cloud'
    authenticated: false,
    user: null,
    authStatus: {
      googleConfigured: false,
      telegramConfigured: false,
      telegramBotUsername: null,
      origin: ''
    },
    syncState: 'local', // 'local' | 'syncing' | 'synced' | 'error'
    lastSyncError: null,
    lastSyncedAt: null
  };

  var pendingSyncOps = 0;
  var syncChain = Promise.resolve();

  function cloneData(val) {
    return JSON.parse(JSON.stringify(val));
  }

  function sanitizeReflectionsMap(rawRefs) {
    var reflections = {};
    if (Array.isArray(rawRefs)) {
      rawRefs.forEach(function (item) {
        if (item && isValidDateKey(item.date)) {
          var norm = normalizeReflection(item);
          if (norm) reflections[item.date] = norm;
        }
      });
      return reflections;
    }
    if (rawRefs && typeof rawRefs === 'object') {
      Object.keys(rawRefs).forEach(function (dateKey) {
        if (isValidDateKey(dateKey)) {
          var norm = normalizeReflection(rawRefs[dateKey]);
          if (norm) reflections[dateKey] = norm;
        }
      });
    }
    return reflections;
  }

  function sanitizeFullState(parsed) {
    if (!parsed || typeof parsed !== 'object') return createSeedState();
    var today = todayKey();
    var tasks = Array.isArray(parsed.tasks)
      ? parsed.tasks.map(function (t, i) { return normalizeTask(t, today, i); }).filter(Boolean)
      : [];
    var routines = Array.isArray(parsed.routines)
      ? parsed.routines.map(normalizeRoutine).filter(Boolean)
      : [];
    var reflections = sanitizeReflectionsMap(parsed.reflections);

    return {
      version: 1,
      selectedDate: isValidDateKey(parsed.selectedDate) ? parsed.selectedDate : today,
      activeView: VALID_VIEWS.indexOf(parsed.activeView) !== -1 ? parsed.activeView : 'today',
      theme: VALID_THEMES.indexOf(parsed.theme) !== -1 ? parsed.theme : 'light',
      settings: normalizeSettings(parsed.settings),
      tasks: tasks,
      routines: routines,
      reflections: reflections,
      filters: normalizeFilters(parsed.filters),
      isSampleData: Boolean(parsed.isSampleData)
    };
  }

  function readStorageKey(key) {
    try {
      if (!global.localStorage) return null;
      var raw = global.localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function saveToStorage(key, nextState) {
    try {
      if (global.localStorage) {
        global.localStorage.setItem(key, JSON.stringify(nextState));
      }
    } catch (e) {
      /* ignore quota or privacy-mode storage errors cleanly */
    }
  }

  function loadInitialGuestState() {
    var parsed = readStorageKey(GUEST_STORAGE_KEY);
    if (!parsed) {
      var seed = createSeedState();
      saveToStorage(GUEST_STORAGE_KEY, seed);
      return seed;
    }
    return sanitizeFullState(parsed);
  }

  var state = loadInitialGuestState();

  function getState() {
    return {
      version: state.version,
      selectedDate: state.selectedDate,
      activeView: state.activeView,
      theme: state.theme,
      settings: Object.assign({}, state.settings),
      tasks: state.tasks,
      routines: state.routines,
      reflections: state.reflections,
      filters: Object.assign({}, state.filters),
      isSampleData: state.isSampleData
    };
  }

  function getAuthState() {
    return {
      mode: authState.mode,
      authenticated: authState.authenticated,
      user: authState.user ? Object.assign({}, authState.user) : null,
      authStatus: Object.assign({}, authState.authStatus),
      syncState: authState.syncState,
      lastSyncError: authState.lastSyncError,
      lastSyncedAt: authState.lastSyncedAt
    };
  }

  function getSyncState() {
    return authState.syncState;
  }

  function isCloudActive() {
    return authState.mode === 'cloud' && authState.authenticated && Boolean(authState.user);
  }

  function notifyListeners(reason) {
    var snapshot = getState();
    for (var i = 0; i < listeners.length; i += 1) {
      try {
        listeners[i](snapshot, { reason: reason || 'update' });
      } catch (err) {
        if (global.console && global.console.error) {
          global.console.error('TaskFlow listener error:', err);
        }
      }
    }
  }

  function apiRequest(path, method, body) {
    if (typeof global.fetch !== 'function') {
      return Promise.resolve({ ok: true, skipped: true });
    }
    var opts = {
      method: method || 'GET',
      credentials: 'same-origin',
      headers: {}
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return global.fetch(path, opts).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (txt) {
          var msg = 'Sync failed (' + res.status + ')';
          try {
            var parsed = JSON.parse(txt);
            if (parsed && parsed.error) msg = parsed.error;
          } catch (e) {
            /* ignore non-JSON error body */
          }
          var err = new Error(msg);
          err.status = res.status;
          throw err;
        });
      }
      var ct = res.headers && res.headers.get ? (res.headers.get('content-type') || '') : '';
      if (ct.indexOf('application/json') !== -1) {
        return res.json();
      }
      return { ok: true };
    });
  }

  function queueCloudOp(fn) {
    if (!isCloudActive() || typeof global.fetch !== 'function') return Promise.resolve();
    var opUserId = authState.user.id;
    pendingSyncOps += 1;
    if (authState.syncState !== 'syncing') {
      authState.syncState = 'syncing';
      notifyListeners('sync');
    }

    syncChain = syncChain.then(function () {
      if (!isCloudActive() || !authState.user || authState.user.id !== opUserId) return null;
      return fn();
    }).then(function () {
      pendingSyncOps = Math.max(0, pendingSyncOps - 1);
      if (pendingSyncOps === 0 && isCloudActive() && authState.user && authState.user.id === opUserId) {
        authState.syncState = 'synced';
        authState.lastSyncError = null;
        authState.lastSyncedAt = new Date().toISOString();
        notifyListeners('sync');
      }
    }).catch(function (err) {
      pendingSyncOps = Math.max(0, pendingSyncOps - 1);
      if (isCloudActive() && authState.user && authState.user.id === opUserId) {
        authState.syncState = 'error';
        authState.lastSyncError = err && err.message ? err.message : 'Cloud sync error';
        notifyListeners('sync');
      }
    });

    return syncChain;
  }

  function pushUndoSnapshot(label) {
    undoStack.push({
      label: label || 'Action undone',
      snapshot: cloneData({
        selectedDate: state.selectedDate,
        tasks: state.tasks,
        routines: state.routines,
        reflections: state.reflections,
        isSampleData: state.isSampleData
      })
    });
    if (undoStack.length > MAX_UNDO) {
      undoStack.shift();
    }
  }

  function commit(reason) {
    saveToStorage(currentStorageKey, state);
    notifyListeners(reason || 'update');
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    return function unsubscribe() {
      var idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  }

  /* =========================================================================
   * Multi-User Auth Session & Workspace Switching
   * ========================================================================= */
  function initAuthSession(statusObj) {
    if (statusObj && typeof statusObj === 'object') {
      authState.authStatus = {
        googleConfigured: Boolean(statusObj.googleConfigured),
        telegramConfigured: Boolean(statusObj.telegramConfigured),
        telegramBotUsername: statusObj.telegramBotUsername || null,
        origin: statusObj.origin || ''
      };
    }
    notifyListeners('authStatus');
  }

  function setCloudWorkspace(userObj, workspaceData) {
    var normUser = normalizeUser(userObj);
    if (!normUser) return;

    var prevTheme = state.theme;
    var prevView = state.activeView;
    var cacheKey = CLOUD_CACHE_PREFIX + normUser.id;
    var cached = readStorageKey(cacheKey);
    var ws = workspaceData && typeof workspaceData === 'object' ? workspaceData : (cached || {});

    currentStorageKey = cacheKey;
    undoStack = [];
    pendingSyncOps = 0;

    var clean = sanitizeFullState({
      version: 1,
      selectedDate: (cached && cached.selectedDate) || todayKey(),
      activeView: prevView || (cached && cached.activeView) || 'today',
      theme: prevTheme || (cached && cached.theme) || 'light',
      settings: ws.settings || (cached && cached.settings) || defaultSettings(),
      tasks: Array.isArray(ws.tasks) ? ws.tasks : ((cached && cached.tasks) || []),
      routines: Array.isArray(ws.routines) ? ws.routines : ((cached && cached.routines) || []),
      reflections: ws.reflections || (cached && cached.reflections) || {},
      filters: (cached && cached.filters) || defaultFilters(),
      isSampleData: false
    });

    state = clean;
    authState.mode = 'cloud';
    authState.authenticated = true;
    authState.user = normUser;
    authState.syncState = 'synced';
    authState.lastSyncError = null;
    authState.lastSyncedAt = new Date().toISOString();

    saveToStorage(currentStorageKey, state);
    notifyListeners('authSwitch');
  }

  function setGuestMode() {
    var prevTheme = state.theme;
    var prevView = state.activeView;

    currentStorageKey = GUEST_STORAGE_KEY;
    undoStack = [];
    pendingSyncOps = 0;

    var guestState = loadInitialGuestState();
    if (VALID_THEMES.indexOf(prevTheme) !== -1) guestState.theme = prevTheme;
    if (VALID_VIEWS.indexOf(prevView) !== -1) guestState.activeView = prevView;
    state = guestState;

    authState.mode = 'guest';
    authState.authenticated = false;
    authState.user = null;
    authState.syncState = 'local';
    authState.lastSyncError = null;
    authState.lastSyncedAt = null;

    saveToStorage(currentStorageKey, state);
    notifyListeners('authSwitch');
  }

  function updateUserProfile(partial) {
    if (!authState.user || !partial || typeof partial !== 'object') return;
    authState.user = normalizeUser(Object.assign({}, authState.user, partial));
    notifyListeners('sync');
  }

  function getLocalGuestSummary() {
    var raw = readStorageKey(GUEST_STORAGE_KEY);
    if (!raw || typeof raw !== 'object') {
      return { tasksCount: 0, routinesCount: 0, isSampleData: false };
    }
    var tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
    var routines = Array.isArray(raw.routines) ? raw.routines : [];
    return {
      tasksCount: tasks.length,
      routinesCount: routines.length,
      isSampleData: Boolean(raw.isSampleData)
    };
  }

  function hasLocalGuestTasks() {
    return getLocalGuestSummary().tasksCount > 0;
  }

  function importLocalGuestToCloud(mode) {
    if (!isCloudActive()) {
      return Promise.resolve({ ok: false, error: 'Sign in with Google first to import to cloud.' });
    }
    var guestRaw = readStorageKey(GUEST_STORAGE_KEY);
    if (!guestRaw || typeof guestRaw !== 'object') {
      return Promise.resolve({ ok: false, error: 'No local guest workspace found.' });
    }
    var guest = sanitizeFullState(guestRaw);
    var importMode = mode === 'replace' ? 'replace' : 'merge';

    authState.syncState = 'syncing';
    notifyListeners('sync');

    return apiRequest('/api/workspace/import', 'POST', {
      mode: importMode,
      tasks: guest.tasks,
      routines: guest.routines,
      reflections: guest.reflections,
      settings: guest.settings
    }).then(function () {
      return apiRequest('/api/workspace', 'GET');
    }).then(function (ws) {
      if (ws && ws.user) {
        setCloudWorkspace(ws.user, ws);
      } else {
        setCloudWorkspace(authState.user, ws || {});
      }
      return {
        ok: true,
        tasksCount: guest.tasks.length,
        routinesCount: guest.routines.length
      };
    }).catch(function (err) {
      authState.syncState = 'error';
      authState.lastSyncError = err && err.message ? err.message : 'Import failed';
      notifyListeners('sync');
      return { ok: false, error: authState.lastSyncError };
    });
  }

  function bootstrap() {
    return getState();
  }

  /* =========================================================================
   * Navigation, Theme, Settings & Filter Mutators
   * ========================================================================= */
  function setSelectedDate(dateStr) {
    if (!isValidDateKey(dateStr) || state.selectedDate === dateStr) return;
    state.selectedDate = dateStr;
    commit('selectedDate');
  }

  function setActiveView(view) {
    if (VALID_VIEWS.indexOf(view) === -1 || state.activeView === view) return;
    state.activeView = view;
    commit('activeView');
  }

  function setTheme(theme) {
    if (VALID_THEMES.indexOf(theme) === -1 || state.theme === theme) return;
    state.theme = theme;
    commit('theme');
    if (currentStorageKey !== GUEST_STORAGE_KEY) {
      var guestRaw = readStorageKey(GUEST_STORAGE_KEY);
      if (guestRaw && typeof guestRaw === 'object') {
        guestRaw.theme = theme;
        saveToStorage(GUEST_STORAGE_KEY, guestRaw);
      }
    }
  }

  function updateSettings(partial) {
    if (!partial || typeof partial !== 'object') return;
    state.settings = normalizeSettings(Object.assign({}, state.settings, partial));
    commit('settings');
    if (isCloudActive()) {
      var u = authState.user;
      queueCloudOp(function () {
        return apiRequest('/api/settings', 'PUT', Object.assign({}, state.settings, {
          timezone: u.timezone,
          telegramNotificationsEnabled: u.telegramNotificationsEnabled,
          morningReminderHour: u.morningReminderHour,
          eveningReminderHour: u.eveningReminderHour
        }));
      });
    }
  }

  function setFilters(partial) {
    if (!partial || typeof partial !== 'object') return;
    state.filters = normalizeFilters(Object.assign({}, state.filters, partial));
    commit('filters');
  }

  /* =========================================================================
   * Task Queries & Mutations
   * ========================================================================= */
  function getTasksForDate(dateStr) {
    var target = isValidDateKey(dateStr) ? dateStr : state.selectedDate;
    return state.tasks
      .filter(function (t) { return t.date === target; })
      .slice()
      .sort(function (a, b) {
        if (a.order !== b.order) return a.order - b.order;
        return a.createdAt < b.createdAt ? -1 : (a.createdAt > b.createdAt ? 1 : 0);
      });
  }

  function getFilteredTasksForDate(dateStr) {
    var list = getTasksForDate(dateStr);
    var f = state.filters;
    var showCompleted = state.settings.showCompleted;
    var q = (f.search || '').trim().toLowerCase();

    var filtered = list.filter(function (t) {
      if (f.status === 'all') {
        if (!showCompleted && t.status === 'done') return false;
      } else if (f.status === 'active') {
        if (t.status === 'done') return false;
      } else if (f.status === 'todo') {
        if (t.status !== 'todo') return false;
      } else if (f.status === 'in_progress') {
        if (t.status !== 'in_progress') return false;
      } else if (f.status === 'done') {
        if (t.status !== 'done') return false;
      }

      if (f.category !== 'all' && t.category !== f.category) return false;
      if (f.priority !== 'all' && t.priority !== f.priority) return false;

      if (q) {
        var inTitle = t.title.toLowerCase().indexOf(q) !== -1;
        var inNotes = (t.notes || '').toLowerCase().indexOf(q) !== -1;
        var inCat = t.category.toLowerCase().indexOf(q) !== -1;
        var inSub = t.subtasks.some(function (s) {
          return s.title.toLowerCase().indexOf(q) !== -1;
        });
        if (!inTitle && !inNotes && !inCat && !inSub) return false;
      }
      return true;
    });

    var sortMode = f.sort || 'manual';
    if (sortMode === 'priority') {
      filtered.sort(function (a, b) {
        var diff = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
        return diff !== 0 ? diff : a.order - b.order;
      });
    } else if (sortMode === 'time' || sortMode === 'scheduledTime') {
      filtered.sort(function (a, b) {
        if (a.scheduledTime && b.scheduledTime) {
          if (a.scheduledTime !== b.scheduledTime) return a.scheduledTime < b.scheduledTime ? -1 : 1;
        } else if (a.scheduledTime || b.scheduledTime) {
          return a.scheduledTime ? -1 : 1;
        }
        var bw = BLOCK_WEIGHT[a.timeBlock] - BLOCK_WEIGHT[b.timeBlock];
        return bw !== 0 ? bw : a.order - b.order;
      });
    } else if (sortMode === 'duration' || sortMode === 'estimatedMinutes') {
      filtered.sort(function (a, b) {
        var diff = b.estimatedMinutes - a.estimatedMinutes;
        return diff !== 0 ? diff : a.order - b.order;
      });
    }

    return filtered;
  }

  function getRolloverTasks(dateStr) {
    var target = isValidDateKey(dateStr) ? dateStr : state.selectedDate;
    var minDate = addDays(target, -7);
    return state.tasks
      .filter(function (t) {
        return t.status !== 'done' && t.date < target && t.date >= minDate;
      })
      .slice()
      .sort(function (a, b) {
        if (a.date !== b.date) return a.date > b.date ? -1 : 1;
        var pw = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
        return pw !== 0 ? pw : a.order - b.order;
      });
  }

  function nextOrderForDate(dateStr) {
    var maxOrder = -1;
    for (var i = 0; i < state.tasks.length; i += 1) {
      if (state.tasks[i].date === dateStr && state.tasks[i].order > maxOrder) {
        maxOrder = state.tasks[i].order;
      }
    }
    return maxOrder + 1;
  }

  function rolloverTasksToDate(ids, dateStr) {
    if (!Array.isArray(ids) || ids.length === 0) return 0;
    var target = isValidDateKey(dateStr) ? dateStr : state.selectedDate;
    var idSet = {};
    ids.forEach(function (id) { idSet[id] = true; });

    var hasAny = state.tasks.some(function (t) { return idSet[t.id] && t.date !== target; });
    if (!hasAny) return 0;

    pushUndoSnapshot('Moved rollover tasks');
    var nextOrd = nextOrderForDate(target);
    var moved = 0;
    var movedTasks = [];

    state.tasks = state.tasks.map(function (t) {
      if (idSet[t.id] && t.date !== target) {
        moved += 1;
        var nextTask = Object.assign({}, t, { date: target, order: nextOrd++ });
        movedTasks.push(nextTask);
        return nextTask;
      }
      return t;
    });

    if (moved > 0) {
      commit('rollover');
      if (isCloudActive()) {
        queueCloudOp(function () {
          return apiRequest('/api/tasks/batch', 'POST', { action: 'upsertMany', tasks: movedTasks });
        });
      }
    }
    return moved;
  }

  function addTask(data) {
    if (!data || typeof data !== 'object') return null;
    var date = isValidDateKey(data.date) ? data.date : state.selectedDate;
    var order = nextOrderForDate(date);
    var task = normalizeTask(data, date, order);
    if (!task) return null;

    state.tasks = state.tasks.concat([task]);
    commit('addTask');
    if (isCloudActive()) {
      queueCloudOp(function () {
        return apiRequest('/api/tasks', 'POST', task);
      });
    }
    return task;
  }

  function findTaskIndex(id) {
    for (var i = 0; i < state.tasks.length; i += 1) {
      if (state.tasks[i].id === id) return i;
    }
    return -1;
  }

  function syncTaskPatch(taskObj) {
    if (!isCloudActive() || !taskObj) return;
    queueCloudOp(function () {
      return apiRequest('/api/tasks/' + encodeURIComponent(taskObj.id), 'PATCH', {
        title: taskObj.title,
        notes: taskObj.notes,
        date: taskObj.date,
        timeBlock: taskObj.timeBlock,
        scheduledTime: taskObj.scheduledTime,
        estimatedMinutes: taskObj.estimatedMinutes,
        actualMinutes: taskObj.actualMinutes,
        priority: taskObj.priority,
        category: taskObj.category,
        status: taskObj.status,
        subtasks: taskObj.subtasks,
        routineId: taskObj.routineId,
        order: taskObj.order,
        completedAt: taskObj.completedAt
      });
    });
  }

  function updateTask(id, patch) {
    var idx = findTaskIndex(id);
    if (idx === -1 || !patch || typeof patch !== 'object') return null;

    var prev = state.tasks[idx];
    var merged = Object.assign({}, prev, patch, { id: prev.id, createdAt: prev.createdAt });

    if (patch.status === 'done' && prev.status !== 'done') {
      merged.completedAt = new Date().toISOString();
    } else if (patch.status && patch.status !== 'done') {
      merged.completedAt = null;
    }

    if (patch.date && patch.date !== prev.date && isValidDateKey(patch.date) && patch.order === undefined) {
      merged.order = nextOrderForDate(patch.date);
    }

    var updated = normalizeTask(merged, prev.date, prev.order);
    if (!updated) return null;

    var nextTasks = state.tasks.slice();
    nextTasks[idx] = updated;
    state.tasks = nextTasks;
    commit('updateTask');
    syncTaskPatch(updated);
    return updated;
  }

  function toggleTaskDone(id) {
    var idx = findTaskIndex(id);
    if (idx === -1) return null;
    var prev = state.tasks[idx];
    var nextStatus = prev.status === 'done' ? 'todo' : 'done';
    return updateTask(id, { status: nextStatus });
  }

  function deleteTask(id) {
    var idx = findTaskIndex(id);
    if (idx === -1) return null;
    var removed = state.tasks[idx];
    pushUndoSnapshot('Task deleted');
    state.tasks = state.tasks.filter(function (t) { return t.id !== id; });
    commit('deleteTask');
    if (isCloudActive()) {
      queueCloudOp(function () {
        return apiRequest('/api/tasks/' + encodeURIComponent(id), 'DELETE');
      });
    }
    return removed;
  }

  function duplicateTask(id) {
    var idx = findTaskIndex(id);
    if (idx === -1) return null;
    var orig = state.tasks[idx];
    var copy = normalizeTask({
      title: orig.title + ' (Copy)',
      notes: orig.notes,
      date: orig.date,
      timeBlock: orig.timeBlock,
      scheduledTime: orig.scheduledTime,
      estimatedMinutes: orig.estimatedMinutes,
      actualMinutes: 0,
      priority: orig.priority,
      category: orig.category,
      status: 'todo',
      subtasks: orig.subtasks.map(function (s) {
        return { id: uid('sub'), title: s.title, done: false };
      }),
      routineId: null,
      order: orig.order + 0.5
    }, orig.date, orig.order + 1);

    state.tasks = state.tasks.concat([copy]);
    reindexDateTasks(orig.date);
    commit('duplicateTask');

    if (isCloudActive()) {
      var dayUpdates = getTasksForDate(orig.date).map(function (t) {
        return { id: t.id, order: t.order, timeBlock: t.timeBlock, date: t.date };
      });
      queueCloudOp(function () {
        return apiRequest('/api/tasks', 'POST', copy).then(function () {
          return apiRequest('/api/tasks/batch', 'POST', { action: 'reorder', updates: dayUpdates });
        });
      });
    }
    return copy;
  }

  function reindexDateTasks(dateStr) {
    var dayTasks = getTasksForDate(dateStr);
    var orderMap = {};
    dayTasks.forEach(function (t, i) {
      orderMap[t.id] = i;
    });
    state.tasks = state.tasks.map(function (t) {
      if (t.date === dateStr && orderMap[t.id] !== undefined) {
        return Object.assign({}, t, { order: orderMap[t.id] });
      }
      return t;
    });
  }

  function reorderTask(dragId, targetId, targetTimeBlock) {
    if (!dragId || dragId === targetId) return false;
    var dragIdx = findTaskIndex(dragId);
    var targetIdx = targetId ? findTaskIndex(targetId) : -1;
    if (dragIdx === -1) return false;

    var dragTask = state.tasks[dragIdx];
    var targetTask = targetIdx !== -1 ? state.tasks[targetIdx] : null;
    var dateStr = targetTask ? targetTask.date : dragTask.date;

    var dayTasks = getTasksForDate(dateStr).filter(function (t) { return t.id !== dragId; });
    var updatedDrag = Object.assign({}, dragTask, { date: dateStr });

    if (targetTimeBlock && VALID_TIME_BLOCKS.indexOf(targetTimeBlock) !== -1) {
      updatedDrag.timeBlock = targetTimeBlock;
    } else if (targetTask) {
      updatedDrag.timeBlock = targetTask.timeBlock;
    }

    var insertPos = dayTasks.length;
    if (targetTask) {
      for (var i = 0; i < dayTasks.length; i += 1) {
        if (dayTasks[i].id === targetId) {
          insertPos = dragTask.order < targetTask.order ? i + 1 : i;
          break;
        }
      }
    }
    dayTasks.splice(insertPos, 0, updatedDrag);

    var orderMap = {};
    var updates = [];
    dayTasks.forEach(function (t, i) {
      orderMap[t.id] = { order: i, timeBlock: t.timeBlock, date: dateStr };
      updates.push({ id: t.id, order: i, timeBlock: t.timeBlock, date: dateStr });
    });

    state.tasks = state.tasks.map(function (t) {
      if (orderMap[t.id]) {
        return Object.assign({}, t, orderMap[t.id]);
      }
      return t;
    });

    commit('reorderTask');
    if (isCloudActive()) {
      queueCloudOp(function () {
        return apiRequest('/api/tasks/batch', 'POST', { action: 'reorder', updates: updates });
      });
    }
    return true;
  }

  function moveTaskOrder(id, direction) {
    var idx = findTaskIndex(id);
    if (idx === -1) return false;
    var task = state.tasks[idx];
    var dir = (direction === 'up' || direction === -1) ? -1 : 1;

    var sameDate = getTasksForDate(task.date);
    var sameBlock = sameDate.filter(function (t) { return t.timeBlock === task.timeBlock; });
    var list = sameBlock.length > 1 ? sameBlock : sameDate;

    var pos = -1;
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === id) {
        pos = i;
        break;
      }
    }
    var swapPos = pos + dir;
    if (pos === -1 || swapPos < 0 || swapPos >= list.length) return false;

    var a = list[pos];
    var b = list[swapPos];

    var aOrder = a.order;
    var bOrder = b.order;
    if (aOrder === bOrder) {
      bOrder = aOrder + dir;
    }

    state.tasks = state.tasks.map(function (t) {
      if (t.id === a.id) return Object.assign({}, t, { order: bOrder });
      if (t.id === b.id) return Object.assign({}, t, { order: aOrder });
      return t;
    });
    reindexDateTasks(task.date);
    commit('moveTaskOrder');

    if (isCloudActive()) {
      var updates = getTasksForDate(task.date).map(function (t) {
        return { id: t.id, order: t.order, timeBlock: t.timeBlock, date: t.date };
      });
      queueCloudOp(function () {
        return apiRequest('/api/tasks/batch', 'POST', { action: 'reorder', updates: updates });
      });
    }
    return true;
  }

  /* =========================================================================
   * Subtask Mutations
   * ========================================================================= */
  function addSubtask(taskId, title) {
    var idx = findTaskIndex(taskId);
    if (idx === -1) return null;
    var clean = typeof title === 'string' ? title.trim() : '';
    if (!clean) return null;

    var sub = { id: uid('sub'), title: clean, done: false };
    var prev = state.tasks[idx];
    var updated = Object.assign({}, prev, { subtasks: prev.subtasks.concat([sub]) });
    var nextTasks = state.tasks.slice();
    nextTasks[idx] = updated;
    state.tasks = nextTasks;
    commit('addSubtask');
    syncTaskPatch(updated);
    return sub;
  }

  function toggleSubtask(taskId, subId) {
    var idx = findTaskIndex(taskId);
    if (idx === -1) return null;
    var prev = state.tasks[idx];
    var changed = false;
    var nextSubs = prev.subtasks.map(function (s) {
      if (s.id === subId) {
        changed = true;
        return Object.assign({}, s, { done: !s.done });
      }
      return s;
    });
    if (!changed) return null;

    var updated = Object.assign({}, prev, { subtasks: nextSubs });
    var nextTasks = state.tasks.slice();
    nextTasks[idx] = updated;
    state.tasks = nextTasks;
    commit('toggleSubtask');
    syncTaskPatch(updated);
    return updated;
  }

  function deleteSubtask(taskId, subId) {
    var idx = findTaskIndex(taskId);
    if (idx === -1) return null;
    var prev = state.tasks[idx];
    var nextSubs = prev.subtasks.filter(function (s) { return s.id !== subId; });
    if (nextSubs.length === prev.subtasks.length) return null;

    var updated = Object.assign({}, prev, { subtasks: nextSubs });
    var nextTasks = state.tasks.slice();
    nextTasks[idx] = updated;
    state.tasks = nextTasks;
    commit('deleteSubtask');
    syncTaskPatch(updated);
    return updated;
  }

  /* =========================================================================
   * Routines & Reflections
   * ========================================================================= */
  function addRoutine(data) {
    var routine = normalizeRoutine(data);
    if (!routine) return null;
    state.routines = state.routines.concat([routine]);
    commit('addRoutine');
    if (isCloudActive()) {
      queueCloudOp(function () {
        return apiRequest('/api/routines', 'POST', routine);
      });
    }
    return routine;
  }

  function updateRoutine(id, patch) {
    if (!patch || typeof patch !== 'object') return null;
    var found = null;
    state.routines = state.routines.map(function (r) {
      if (r.id === id) {
        found = normalizeRoutine(Object.assign({}, r, patch, { id: r.id }));
        return found || r;
      }
      return r;
    });
    if (found) {
      commit('updateRoutine');
      if (isCloudActive()) {
        queueCloudOp(function () {
          return apiRequest('/api/routines/' + encodeURIComponent(id), 'PATCH', found);
        });
      }
    }
    return found;
  }

  function deleteRoutine(id) {
    var target = null;
    for (var i = 0; i < state.routines.length; i += 1) {
      if (state.routines[i].id === id) {
        target = state.routines[i];
        break;
      }
    }
    if (!target) return false;
    pushUndoSnapshot('Routine deleted');
    state.routines = state.routines.filter(function (r) { return r.id !== id; });
    commit('deleteRoutine');
    if (isCloudActive()) {
      queueCloudOp(function () {
        return apiRequest('/api/routines/' + encodeURIComponent(id), 'DELETE');
      });
    }
    return true;
  }

  function doesRoutineApplyToDate(routine, dateStr) {
    if (!routine.active) return false;
    if (routine.schedule === 'weekdays') return isWeekday(dateStr);
    return true;
  }

  function applyRoutinesToDate(dateStr) {
    var target = isValidDateKey(dateStr) ? dateStr : state.selectedDate;
    var existingRoutineIds = {};
    state.tasks.forEach(function (t) {
      if (t.date === target && t.routineId) {
        existingRoutineIds[t.routineId] = true;
      }
    });

    var nextOrder = nextOrderForDate(target);
    var created = [];

    state.routines.forEach(function (r) {
      if (!doesRoutineApplyToDate(r, target)) return;
      if (existingRoutineIds[r.id]) return;

      var newTask = normalizeTask({
        title: r.title,
        notes: '',
        date: target,
        timeBlock: r.timeBlock,
        scheduledTime: '',
        estimatedMinutes: r.estimatedMinutes,
        actualMinutes: 0,
        priority: r.priority,
        category: r.category,
        status: 'todo',
        subtasks: r.subtasks.map(function (st) {
          return { id: uid('sub'), title: st, done: false };
        }),
        routineId: r.id,
        order: nextOrder++
      }, target, nextOrder);

      if (newTask) created.push(newTask);
    });

    if (created.length > 0) {
      state.tasks = state.tasks.concat(created);
      commit('applyRoutines');
      if (isCloudActive()) {
        queueCloudOp(function () {
          return apiRequest('/api/tasks/batch', 'POST', { action: 'upsertMany', tasks: created });
        });
      }
    }
    return created;
  }

  function getRoutineStreak(routineId) {
    var routine = null;
    for (var i = 0; i < state.routines.length; i += 1) {
      if (state.routines[i].id === routineId) {
        routine = state.routines[i];
        break;
      }
    }
    var schedule = routine ? routine.schedule : 'daily';

    var doneByDate = {};
    state.tasks.forEach(function (t) {
      if (t.routineId === routineId && t.status === 'done') {
        doneByDate[t.date] = true;
      }
    });

    var today = todayKey();
    var streak = 0;

    for (var offset = 0; offset < 90; offset += 1) {
      var dStr = addDays(today, -offset);
      if (schedule === 'weekdays' && !isWeekday(dStr)) {
        continue;
      }
      if (doneByDate[dStr]) {
        streak += 1;
      } else if (offset === 0) {
        continue;
      } else {
        break;
      }
    }
    return streak;
  }

  function saveReflection(dateStr, partial) {
    var target = isValidDateKey(dateStr) ? dateStr : state.selectedDate;
    var existing = state.reflections[target] || { mood: null, intention: '', reflection: '', updatedAt: '' };
    var next = normalizeReflection(Object.assign({}, existing, partial, { updatedAt: new Date().toISOString() }));
    var nextReflections = Object.assign({}, state.reflections);
    nextReflections[target] = next;
    state.reflections = nextReflections;
    commit('saveReflection');
    if (isCloudActive()) {
      queueCloudOp(function () {
        return apiRequest('/api/reflections/' + encodeURIComponent(target), 'PUT', {
          mood: next.mood,
          intention: next.intention,
          reflection: next.reflection
        });
      });
    }
    return next;
  }

  /* =========================================================================
   * Undo, Clear, Reset, Export & Import
   * ========================================================================= */
  function syncFullSnapshotToCloud() {
    if (!isCloudActive()) return;
    var payload = {
      mode: 'replace',
      tasks: state.tasks,
      routines: state.routines,
      reflections: state.reflections,
      settings: state.settings
    };
    queueCloudOp(function () {
      return apiRequest('/api/workspace/import', 'POST', payload);
    });
  }

  function canUndo() {
    return undoStack.length > 0;
  }

  function undo() {
    if (undoStack.length === 0) return false;
    var entry = undoStack.pop();
    var snap = entry.snapshot;
    state.selectedDate = snap.selectedDate;
    state.tasks = snap.tasks;
    state.routines = snap.routines;
    state.reflections = snap.reflections;
    state.isSampleData = snap.isSampleData;
    commit('undo');
    syncFullSnapshotToCloud();
    return true;
  }

  function clearSampleData() {
    pushUndoSnapshot('Cleared workspace data');
    var empty = createEmptyState();
    state.tasks = empty.tasks;
    state.routines = empty.routines;
    state.reflections = empty.reflections;
    state.isSampleData = false;
    state.selectedDate = todayKey();
    commit('clearSampleData');
    syncFullSnapshotToCloud();
  }

  function resetDemoData() {
    pushUndoSnapshot('Restored demo workspace');
    var seed = createSeedState();
    state.tasks = seed.tasks;
    state.routines = seed.routines;
    state.reflections = seed.reflections;
    state.isSampleData = isCloudActive() ? false : true;
    state.selectedDate = todayKey();
    commit('resetDemoData');
    syncFullSnapshotToCloud();
  }

  function clearCompletedForDate(dateStr) {
    var target = isValidDateKey(dateStr) ? dateStr : state.selectedDate;
    var removedIds = [];
    state.tasks.forEach(function (t) {
      if (t.date === target && t.status === 'done') removedIds.push(t.id);
    });
    if (removedIds.length === 0) return 0;

    pushUndoSnapshot('Cleared completed tasks');
    state.tasks = state.tasks.filter(function (t) {
      return !(t.date === target && t.status === 'done');
    });
    commit('clearCompleted');
    if (isCloudActive()) {
      queueCloudOp(function () {
        return apiRequest('/api/tasks/batch', 'POST', { action: 'deleteMany', ids: removedIds });
      });
    }
    return removedIds.length;
  }

  function exportJSON() {
    return JSON.stringify({
      version: state.version,
      exportedAt: new Date().toISOString(),
      selectedDate: state.selectedDate,
      theme: state.theme,
      settings: state.settings,
      tasks: state.tasks,
      routines: state.routines,
      reflections: state.reflections,
      filters: state.filters,
      isSampleData: state.isSampleData
    }, null, 2);
  }

  function importJSON(jsonStr) {
    if (typeof jsonStr !== 'string' || !jsonStr.trim()) {
      return { ok: false, error: 'Empty JSON input.' };
    }
    var parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      return { ok: false, error: 'Invalid JSON syntax.' };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'Backup root must be a JSON object.' };
    }
    if (parsed.version !== 1) {
      return { ok: false, error: 'Unsupported backup schema version (expected version 1).' };
    }
    if (!Array.isArray(parsed.tasks)) {
      return { ok: false, error: 'Backup is missing a valid tasks array.' };
    }
    if (!Array.isArray(parsed.routines)) {
      return { ok: false, error: 'Backup is missing a valid routines array.' };
    }
    if (!parsed.reflections || typeof parsed.reflections !== 'object' || Array.isArray(parsed.reflections)) {
      return { ok: false, error: 'Backup is missing a valid reflections object.' };
    }

    for (var i = 0; i < parsed.tasks.length; i += 1) {
      var rawT = parsed.tasks[i];
      if (!rawT || typeof rawT !== 'object' || typeof rawT.title !== 'string' || !rawT.title.trim() || !isValidDateKey(rawT.date)) {
        return { ok: false, error: 'Invalid task entry at index ' + i + ' (requires title and YYYY-MM-DD date).' };
      }
    }

    for (var j = 0; j < parsed.routines.length; j += 1) {
      var rawR = parsed.routines[j];
      if (!rawR || typeof rawR !== 'object' || typeof rawR.title !== 'string' || !rawR.title.trim()) {
        return { ok: false, error: 'Invalid routine entry at index ' + j + ' (requires title).' };
      }
    }

    pushUndoSnapshot('Imported backup');
    var cleanState = sanitizeFullState(parsed);
    if (isCloudActive()) {
      cleanState.isSampleData = false;
    }
    state = cleanState;
    commit('importJSON');
    syncFullSnapshotToCloud();
    return {
      ok: true,
      tasksCount: state.tasks.length,
      routinesCount: state.routines.length
    };
  }

  function csvCell(val) {
    var s = val === null || val === undefined ? '' : String(val);
    if (/[",\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function exportCSV() {
    var headers = [
      'id', 'date', 'title', 'status', 'priority', 'category',
      'timeBlock', 'scheduledTime', 'estimatedMinutes', 'actualMinutes',
      'subtasksDone', 'subtasksTotal', 'routineId', 'completedAt', 'notes'
    ];
    var rows = [headers.join(',')];
    var sorted = state.tasks.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.order - b.order;
    });

    sorted.forEach(function (t) {
      var subsDone = t.subtasks.filter(function (s) { return s.done; }).length;
      rows.push([
        t.id, t.date, t.title, t.status, t.priority, t.category,
        t.timeBlock, t.scheduledTime, t.estimatedMinutes, t.actualMinutes,
        subsDone, t.subtasks.length, t.routineId || '', t.completedAt || '', t.notes
      ].map(csvCell).join(','));
    });

    return rows.join('\r\n');
  }

  /* =========================================================================
   * Analytics Helpers
   * ========================================================================= */
  function buildTasksByDateMap() {
    var map = {};
    for (var i = 0; i < state.tasks.length; i += 1) {
      var t = state.tasks[i];
      if (!map[t.date]) map[t.date] = [];
      map[t.date].push(t);
    }
    return map;
  }

  function computeDayStatsFromList(dateStr, list) {
    var total = list.length;
    var done = 0;
    var inProgress = 0;
    var todo = 0;
    var estimatedMinutes = 0;
    var actualMinutes = 0;
    var highTotal = 0;
    var highDone = 0;

    for (var i = 0; i < list.length; i += 1) {
      var t = list[i];
      if (t.status === 'done') done += 1;
      else if (t.status === 'in_progress') inProgress += 1;
      else todo += 1;

      estimatedMinutes += t.estimatedMinutes;
      actualMinutes += t.actualMinutes;

      if (t.priority === 'high') {
        highTotal += 1;
        if (t.status === 'done') highDone += 1;
      }
    }

    var completionRate = total > 0 ? Math.round((done / total) * 100) : 0;
    var goalTasks = state.settings.dailyGoalTasks;
    var goalMinutes = state.settings.dailyGoalMinutes;
    return {
      date: dateStr,
      total: total,
      done: done,
      inProgress: inProgress,
      todo: todo,
      completionRate: completionRate,
      estimatedMinutes: estimatedMinutes,
      actualMinutes: actualMinutes,
      highTotal: highTotal,
      highDone: highDone,
      goalTasks: goalTasks,
      goalMinutes: goalMinutes,
      goalMet: done >= goalTasks
    };
  }

  function getDayStats(dateStr) {
    var target = isValidDateKey(dateStr) ? dateStr : state.selectedDate;
    return computeDayStatsFromList(target, getTasksForDate(target));
  }

  function getStreakInfo() {
    var today = todayKey();
    var doneCountByDate = {};
    var earliestDate = today;

    for (var i = 0; i < state.tasks.length; i += 1) {
      var t = state.tasks[i];
      if (t.date < earliestDate) earliestDate = t.date;
      if (t.status === 'done') {
        doneCountByDate[t.date] = (doneCountByDate[t.date] || 0) + 1;
      }
    }

    var activeDates = Object.keys(doneCountByDate).filter(function (d) {
      return d <= today && doneCountByDate[d] >= 1;
    }).sort();

    var currentStreak = 0;
    var cursor = (doneCountByDate[today] || 0) >= 1 ? today : addDays(today, -1);
    while ((doneCountByDate[cursor] || 0) >= 1) {
      currentStreak += 1;
      cursor = addDays(cursor, -1);
    }

    var bestStreak = 0;
    var running = 0;
    var prevDate = null;
    for (var j = 0; j < activeDates.length; j += 1) {
      var d = activeDates[j];
      if (prevDate && diffDays(prevDate, d) === 1) {
        running += 1;
      } else {
        running = 1;
      }
      if (running > bestStreak) bestStreak = running;
      prevDate = d;
    }

    return {
      currentStreak: currentStreak,
      bestStreak: bestStreak,
      totalActiveDays: activeDates.length,
      todayQualified: (doneCountByDate[today] || 0) >= 1
    };
  }

  function aggregateWindow(startStr, endStr, byDate) {
    var daily = [];
    var totalTasks = 0;
    var doneTasks = 0;
    var estimatedMinutes = 0;
    var actualMinutes = 0;
    var highTotal = 0;
    var highDone = 0;
    var span = Math.max(1, diffDays(startStr, endStr) + 1);

    for (var i = 0; i < span; i += 1) {
      var dStr = addDays(startStr, i);
      var stats = computeDayStatsFromList(dStr, byDate[dStr] || []);
      daily.push(stats);
      totalTasks += stats.total;
      doneTasks += stats.done;
      estimatedMinutes += stats.estimatedMinutes;
      actualMinutes += stats.actualMinutes;
      highTotal += stats.highTotal;
      highDone += stats.highDone;
    }

    var completionRate = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
    var highCompletionRate = highTotal > 0 ? Math.round((highDone / highTotal) * 100) : 0;

    return {
      daily: daily,
      totals: {
        totalTasks: totalTasks,
        doneTasks: doneTasks,
        completionRate: completionRate,
        estimatedMinutes: estimatedMinutes,
        actualMinutes: actualMinutes,
        avgTasksPerDay: Math.round((doneTasks / span) * 10) / 10,
        avgFocusMinutesPerDay: Math.round(actualMinutes / span),
        highTotal: highTotal,
        highDone: highDone,
        highCompletionRate: highCompletionRate
      }
    };
  }

  function getDateRangeStats(days) {
    var span = clamp(Math.round(Number(days) || 7), 1, 365);
    var endDate = todayKey();
    var startDate = addDays(endDate, -(span - 1));
    var prevEndDate = addDays(startDate, -1);
    var prevStartDate = addDays(prevEndDate, -(span - 1));

    var byDate = buildTasksByDateMap();
    var current = aggregateWindow(startDate, endDate, byDate);
    var prev = aggregateWindow(prevStartDate, prevEndDate, byDate);

    return {
      days: span,
      startDate: startDate,
      endDate: endDate,
      daily: current.daily,
      totals: current.totals,
      previousTotals: {
        totalTasks: prev.totals.totalTasks,
        doneTasks: prev.totals.doneTasks,
        completionRate: prev.totals.completionRate,
        actualMinutes: prev.totals.actualMinutes
      },
      deltas: {
        doneTasksDelta: current.totals.doneTasks - prev.totals.doneTasks,
        completionRateDelta: current.totals.completionRate - prev.totals.completionRate,
        actualMinutesDelta: current.totals.actualMinutes - prev.totals.actualMinutes
      }
    };
  }

  function computeHeatmapLevel(done, completionRate, goalTasks) {
    if (done <= 0) return 0;
    if (done >= goalTasks || (done >= 3 && completionRate === 100)) return 4;
    if (done >= 3 || (done >= 2 && completionRate >= 70)) return 3;
    if (done >= 2 || completionRate >= 50) return 2;
    return 1;
  }

  function getHeatmapData(weeks) {
    var weekCount = clamp(Math.round(Number(weeks) || 12), 1, 52);
    var today = todayKey();
    var todayDt = parseDateKey(today);
    var todayMonOffset = (todayDt.getDay() + 6) % 7;
    var currentWeekMonday = addDays(today, -todayMonOffset);
    var startMonday = addDays(currentWeekMonday, -(weekCount - 1) * 7);

    var byDate = buildTasksByDateMap();
    var goalTasks = state.settings.dailyGoalTasks;
    var gridWeeks = [];
    var cells = [];

    for (var w = 0; w < weekCount; w += 1) {
      var col = [];
      for (var r = 0; r < 7; r += 1) {
        var dStr = addDays(startMonday, w * 7 + r);
        var dt = parseDateKey(dStr);
        var stats = computeDayStatsFromList(dStr, byDate[dStr] || []);
        var isFuture = dStr > today;
        var level = isFuture ? 0 : computeHeatmapLevel(stats.done, stats.completionRate, goalTasks);

        var cell = {
          date: dStr,
          dayOfWeek: r,
          weekIndex: w,
          monthLabel: SHORT_MONTHS[dt.getMonth()],
          done: stats.done,
          total: stats.total,
          completionRate: stats.completionRate,
          actualMinutes: stats.actualMinutes,
          level: level,
          isToday: dStr === today,
          isFuture: isFuture
        };
        col.push(cell);
        cells.push(cell);
      }
      gridWeeks.push(col);
    }

    return {
      weeksCount: weekCount,
      startDate: startMonday,
      endDate: addDays(startMonday, weekCount * 7 - 1),
      weeks: gridWeeks,
      cells: cells
    };
  }

  function getCategoryBreakdown(days) {
    var span = clamp(Math.round(Number(days) || 30), 1, 365);
    var endDate = todayKey();
    var startDate = addDays(endDate, -(span - 1));

    var catMap = {};
    VALID_CATEGORIES.forEach(function (c) {
      catMap[c] = {
        category: c,
        label: CATEGORY_META[c].label,
        color: CATEGORY_META[c].color,
        total: 0,
        done: 0,
        completionRate: 0,
        actualMinutes: 0,
        estimatedMinutes: 0,
        sharePercent: 0
      };
    });

    var priMap = {
      high: { priority: 'high', label: 'High', total: 0, done: 0, completionRate: 0 },
      medium: { priority: 'medium', label: 'Medium', total: 0, done: 0, completionRate: 0 },
      low: { priority: 'low', label: 'Low', total: 0, done: 0, completionRate: 0 }
    };

    var totalTasks = 0;
    var totalDone = 0;
    var totalMinutes = 0;

    for (var i = 0; i < state.tasks.length; i += 1) {
      var t = state.tasks[i];
      if (t.date < startDate || t.date > endDate) continue;

      totalTasks += 1;
      totalMinutes += t.actualMinutes;
      var cEntry = catMap[t.category] || catMap.work;
      cEntry.total += 1;
      cEntry.actualMinutes += t.actualMinutes;
      cEntry.estimatedMinutes += t.estimatedMinutes;

      var pEntry = priMap[t.priority] || priMap.medium;
      pEntry.total += 1;

      if (t.status === 'done') {
        totalDone += 1;
        cEntry.done += 1;
        pEntry.done += 1;
      }
    }

    var categories = VALID_CATEGORIES.map(function (c) {
      var item = catMap[c];
      item.completionRate = item.total > 0 ? Math.round((item.done / item.total) * 100) : 0;
      item.sharePercent = totalTasks > 0 ? Math.round((item.total / totalTasks) * 100) : 0;
      return item;
    });

    var priorities = VALID_PRIORITIES.map(function (p) {
      var item = priMap[p];
      item.completionRate = item.total > 0 ? Math.round((item.done / item.total) * 100) : 0;
      return item;
    });

    return {
      days: span,
      startDate: startDate,
      endDate: endDate,
      categories: categories,
      priorities: priorities,
      totalTasks: totalTasks,
      totalDone: totalDone,
      totalMinutes: totalMinutes
    };
  }

  var Store = {
    getState: getState,
    subscribe: subscribe,
    bootstrap: bootstrap,
    initAuthSession: initAuthSession,
    setCloudWorkspace: setCloudWorkspace,
    setGuestMode: setGuestMode,
    updateUserProfile: updateUserProfile,
    getAuthState: getAuthState,
    getSyncState: getSyncState,
    hasLocalGuestTasks: hasLocalGuestTasks,
    getLocalGuestSummary: getLocalGuestSummary,
    importLocalGuestToCloud: importLocalGuestToCloud,
    setSelectedDate: setSelectedDate,
    setActiveView: setActiveView,
    setTheme: setTheme,
    updateSettings: updateSettings,
    setFilters: setFilters,
    getTasksForDate: getTasksForDate,
    getFilteredTasksForDate: getFilteredTasksForDate,
    getRolloverTasks: getRolloverTasks,
    rolloverTasksToDate: rolloverTasksToDate,
    addTask: addTask,
    updateTask: updateTask,
    toggleTaskDone: toggleTaskDone,
    deleteTask: deleteTask,
    duplicateTask: duplicateTask,
    reorderTask: reorderTask,
    moveTaskOrder: moveTaskOrder,
    addSubtask: addSubtask,
    toggleSubtask: toggleSubtask,
    deleteSubtask: deleteSubtask,
    addRoutine: addRoutine,
    updateRoutine: updateRoutine,
    deleteRoutine: deleteRoutine,
    applyRoutinesToDate: applyRoutinesToDate,
    getRoutineStreak: getRoutineStreak,
    saveReflection: saveReflection,
    undo: undo,
    canUndo: canUndo,
    exportJSON: exportJSON,
    importJSON: importJSON,
    exportCSV: exportCSV,
    clearSampleData: clearSampleData,
    resetDemoData: resetDemoData,
    clearCompletedForDate: clearCompletedForDate,
    getDayStats: getDayStats,
    getStreakInfo: getStreakInfo,
    getDateRangeStats: getDateRangeStats,
    getHeatmapData: getHeatmapData,
    getCategoryBreakdown: getCategoryBreakdown
  };

  TaskFlow.Utils = Utils;
  TaskFlow.Store = Store;
})(window);
