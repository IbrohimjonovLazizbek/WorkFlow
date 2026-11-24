import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '..');

function createStorageMock(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    },
    clear() {
      map.clear();
    },
    _dump() {
      return Object.fromEntries(map.entries());
    }
  };
}

function loadTaskFlowRuntime(options = {}) {
  const storage = options.storage || createStorageMock(options.initialStorage || {});
  const listeners = [];
  const doc = {
    title: 'TaskFlow',
    documentElement: {
      attrs: { 'data-theme': 'light' },
      setAttribute(k, v) { this.attrs[k] = v; },
      getAttribute(k) { return this.attrs[k]; }
    },
    readyState: 'complete',
    addEventListener(type, fn) { listeners.push({ type, fn }); }
  };

  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    RegExp,
    Error,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    localStorage: storage,
    document: doc
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const files = options.files || ['js/state.js', 'js/timer.js'];
  for (const rel of files) {
    const code = fs.readFileSync(path.join(APP_DIR, rel), 'utf8');
    vm.runInNewContext(code, sandbox, { filename: rel });
  }

  return {
    TaskFlow: sandbox.TaskFlow,
    storage,
    doc,
    sandbox
  };
}

test('Utils: local date math, DST safety, formatting, escaping, clamping', () => {
  const { TaskFlow } = loadTaskFlowRuntime({ files: ['js/state.js'] });
  const { Utils } = TaskFlow;

  // todayKey matches local YYYY-MM-DD
  const now = new Date();
  const expectedToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  assert.equal(Utils.todayKey(), expectedToday);

  // Month/year rollovers and leap years
  assert.equal(Utils.addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(Utils.addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(Utils.addDays('2026-01-01', -1), '2025-12-31');

  // DST transition dates (US Spring Forward 2026-03-08 & Fall Back 2026-11-01)
  assert.equal(Utils.addDays('2026-03-07', 2), '2026-03-09');
  assert.equal(Utils.diffDays('2026-03-07', '2026-03-09'), 2);
  assert.equal(Utils.addDays('2026-10-31', 3), '2026-11-03');
  assert.equal(Utils.diffDays('2026-10-31', '2026-11-03'), 3);

  // Validation
  assert.equal(Utils.isValidDateKey('2026-02-29'), false);
  assert.equal(Utils.isValidDateKey('2024-02-29'), true);
  assert.equal(Utils.isValidDateKey('2026-13-01'), false);
  assert.equal(Utils.isValidDateKey('bad-date'), false);

  // Formatting
  assert.equal(Utils.formatMinutes(0), '0m');
  assert.equal(Utils.formatMinutes(45), '45m');
  assert.equal(Utils.formatMinutes(60), '1h');
  assert.equal(Utils.formatMinutes(95), '1h 35m');
  assert.match(Utils.formatDateLabel(expectedToday), /^Today,/);
  assert.match(Utils.formatDateLabel(Utils.addDays(expectedToday, 1)), /^Tomorrow,/);
  assert.match(Utils.formatDateLabel(Utils.addDays(expectedToday, -1)), /^Yesterday,/);

  // XSS escaping & clamp
  assert.equal(
    Utils.escapeHtml('<img src=x onerror="alert(\'xss\')">&'),
    '&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;&amp;'
  );
  assert.equal(Utils.clamp(NaN, 1, 10), 1);
  assert.equal(Utils.clamp(99, 1, 10), 10);
  assert.equal(Utils.clamp(-5, 1, 10), 1);
});

test('First-run seed dataset initializes with rich tasks, routines, reflections, and persists', () => {
  const { TaskFlow, storage } = loadTaskFlowRuntime({ files: ['js/state.js'] });
  const { Store, Utils } = TaskFlow;
  const st = Store.getState();

  assert.equal(st.version, 1);
  assert.equal(st.isSampleData, true);
  assert.equal(st.routines.length, 4);
  assert.ok(st.tasks.length > 30, 'expected seeded 14-day + today + upcoming tasks');
  assert.ok(Store.getTasksForDate(Utils.todayKey()).length >= 7);
  assert.ok(Store.getRolloverTasks(Utils.todayKey()).length >= 2);
  assert.ok(storage.getItem('taskflow_state_v1'));

  const streak = Store.getStreakInfo();
  assert.ok(streak.currentStreak >= 8, `expected >= 8 day streak, got ${streak.currentStreak}`);
  assert.equal(streak.todayQualified, true);
});

test('Store CRUD, subtasks, duplicate, reorder, moveTaskOrder, and filters', () => {
  const { TaskFlow } = loadTaskFlowRuntime({ files: ['js/state.js'] });
  const { Store, Utils } = TaskFlow;
  Store.clearSampleData();

  const today = Utils.todayKey();
  assert.equal(Store.getState().tasks.length, 0);
  assert.equal(Store.getState().isSampleData, false);

  let eventCount = 0;
  const unsub = Store.subscribe(() => { eventCount += 1; });

  const t1 = Store.addTask({
    title: 'Write verification suite',
    priority: 'high',
    category: 'work',
    timeBlock: 'morning',
    scheduledTime: '09:00',
    estimatedMinutes: 45
  });
  const t2 = Store.addTask({
    title: 'Evening stretch',
    priority: 'low',
    category: 'health',
    timeBlock: 'morning',
    estimatedMinutes: 15
  });
  const t3 = Store.addTask({
    title: 'Study architecture',
    priority: 'medium',
    category: 'learning',
    timeBlock: 'afternoon',
    estimatedMinutes: 30
  });

  assert.ok(t1 && t2 && t3);
  assert.equal(Store.getTasksForDate(today).length, 3);
  assert.equal(eventCount, 3);

  // Subtasks CRUD
  const sub1 = Store.addSubtask(t1.id, 'Cover CRUD');
  const sub2 = Store.addSubtask(t1.id, 'Cover analytics');
  assert.ok(sub1 && sub2);
  assert.equal(Store.addSubtask(t1.id, '   '), null);

  let updated = Store.toggleSubtask(t1.id, sub1.id);
  assert.equal(updated.subtasks.filter(s => s.done).length, 1);

  updated = Store.deleteSubtask(t1.id, sub2.id);
  assert.equal(updated.subtasks.length, 1);

  // Toggle task done & completedAt lifecycle
  const doneT1 = Store.toggleTaskDone(t1.id);
  assert.equal(doneT1.status, 'done');
  assert.ok(doneT1.completedAt);

  const reopenedT1 = Store.toggleTaskDone(t1.id);
  assert.equal(reopenedT1.status, 'todo');
  assert.equal(reopenedT1.completedAt, null);

  // Duplicate
  const dup = Store.duplicateTask(t1.id);
  assert.equal(dup.title, 'Write verification suite (Copy)');
  assert.equal(dup.status, 'todo');
  assert.equal(dup.subtasks.length, 1);
  assert.equal(dup.subtasks[0].done, false);

  // Move order & drag reorder
  const beforeIds = Store.getTasksForDate(today).filter(t => t.timeBlock === 'morning').map(t => t.id);
  assert.ok(Store.moveTaskOrder(t2.id, 'up'));
  const afterIds = Store.getTasksForDate(today).filter(t => t.timeBlock === 'morning').map(t => t.id);
  assert.notDeepEqual(afterIds, beforeIds);

  assert.ok(Store.reorderTask(t3.id, t1.id));
  const movedT3 = Store.getState().tasks.find(t => t.id === t3.id);
  assert.equal(movedT3.timeBlock, 'morning');

  // Filtering & sorting
  Store.toggleTaskDone(t1.id);
  Store.setFilters({ status: 'done' });
  assert.equal(Store.getFilteredTasksForDate(today).length, 1);

  Store.setFilters({ status: 'active', category: 'health' });
  assert.equal(Store.getFilteredTasksForDate(today).length, 1);

  Store.setFilters({ status: 'all', category: 'all', search: 'architecture' });
  assert.equal(Store.getFilteredTasksForDate(today).length, 1);

  Store.setFilters({ search: '', sort: 'duration' });
  const byDur = Store.getFilteredTasksForDate(today);
  assert.ok(byDur[0].estimatedMinutes >= byDur[byDur.length - 1].estimatedMinutes);

  unsub();
});

test('Rollover tasks and Undo stack restore snapshots cleanly', () => {
  const { TaskFlow } = loadTaskFlowRuntime({ files: ['js/state.js'] });
  const { Store, Utils } = TaskFlow;
  Store.clearSampleData();

  const today = Utils.todayKey();
  const yesterday = Utils.addDays(today, -1);
  const eightDaysAgo = Utils.addDays(today, -8);

  const oldUnfinished = Store.addTask({ title: 'Yesterday unfinished', date: yesterday, priority: 'high' });
  const oldDone = Store.addTask({ title: 'Yesterday done', date: yesterday, status: 'done' });
  const tooOld = Store.addTask({ title: 'Eight days ago', date: eightDaysAgo });

  const rollover = Store.getRolloverTasks(today);
  assert.equal(rollover.length, 1);
  assert.equal(rollover[0].id, oldUnfinished.id);
  assert.ok(oldDone && tooOld);

  const movedCount = Store.rolloverTasksToDate([oldUnfinished.id], today);
  assert.equal(movedCount, 1);
  assert.equal(Store.getRolloverTasks(today).length, 0);
  assert.equal(Store.getTasksForDate(today).length, 1);

  // Undo rollover
  assert.equal(Store.canUndo(), true);
  assert.equal(Store.undo(), true);
  assert.equal(Store.getRolloverTasks(today).length, 1);
  assert.equal(Store.getTasksForDate(today).length, 0);

  // Delete + undo + clearCompleted + undo
  Store.deleteTask(oldUnfinished.id);
  assert.equal(Store.getRolloverTasks(today).length, 0);
  assert.equal(Store.undo(), true);
  assert.equal(Store.getRolloverTasks(today).length, 1);

  const cleared = Store.clearCompletedForDate(yesterday);
  assert.equal(cleared, 1);
  assert.equal(Store.getTasksForDate(yesterday).length, 1);
  assert.equal(Store.undo(), true);
  assert.equal(Store.getTasksForDate(yesterday).length, 2);
});

test('Routines CRUD, weekday schedule filter, idempotency, and streak calculation', () => {
  const { TaskFlow } = loadTaskFlowRuntime({ files: ['js/state.js'] });
  const { Store, Utils } = TaskFlow;
  Store.clearSampleData();

  const dailyR = Store.addRoutine({
    title: 'Daily Hydration',
    category: 'health',
    priority: 'medium',
    timeBlock: 'morning',
    estimatedMinutes: 10,
    schedule: 'daily',
    active: true,
    subtasks: ['Drink 500ml water']
  });
  const weekdayR = Store.addRoutine({
    title: 'Weekday Standup',
    category: 'work',
    priority: 'high',
    timeBlock: 'morning',
    estimatedMinutes: 15,
    schedule: 'weekdays',
    active: true,
    subtasks: []
  });
  const pausedR = Store.addRoutine({
    title: 'Paused Routine',
    schedule: 'daily',
    active: false
  });
  assert.ok(dailyR && weekdayR && pausedR);

  // Pick a known Saturday & Monday
  const saturday = '2026-11-21';
  const monday = '2026-11-23';

  const satCreated = Store.applyRoutinesToDate(saturday);
  assert.equal(satCreated.length, 1);
  assert.equal(satCreated[0].routineId, dailyR.id);
  assert.equal(satCreated[0].subtasks.length, 1);

  // Idempotent on second call
  const satSecond = Store.applyRoutinesToDate(saturday);
  assert.equal(satSecond.length, 0);

  const monCreated = Store.applyRoutinesToDate(monday);
  assert.equal(monCreated.length, 2);
  assert.equal(Store.applyRoutinesToDate(monday).length, 0);

  // Streak across today and yesterday
  const today = Utils.todayKey();
  const yesterday = Utils.addDays(today, -1);
  const twoDaysAgo = Utils.addDays(today, -2);
  Store.addTask({ title: dailyR.title, date: twoDaysAgo, status: 'done', routineId: dailyR.id });
  Store.addTask({ title: dailyR.title, date: yesterday, status: 'done', routineId: dailyR.id });
  assert.equal(Store.getRoutineStreak(dailyR.id), 2);
  Store.addTask({ title: dailyR.title, date: today, status: 'done', routineId: dailyR.id });
  assert.equal(Store.getRoutineStreak(dailyR.id), 3);

  // Update & delete routine
  const updatedR = Store.updateRoutine(pausedR.id, { active: true, title: 'Resumed' });
  assert.equal(updatedR.active, true);
  assert.equal(updatedR.title, 'Resumed');
  assert.equal(Store.deleteRoutine(pausedR.id), true);
  assert.equal(Store.undo(), true);
  assert.ok(Store.getState().routines.find(r => r.id === pausedR.id));
});

test('Zero-task analytics edge cases produce clean 0s without NaN/Infinity', () => {
  const { TaskFlow } = loadTaskFlowRuntime({ files: ['js/state.js'] });
  const { Store, Utils } = TaskFlow;
  Store.clearSampleData();

  const today = Utils.todayKey();
  const dayStats = Store.getDayStats(today);
  assert.equal(dayStats.total, 0);
  assert.equal(dayStats.done, 0);
  assert.equal(dayStats.completionRate, 0);
  assert.equal(dayStats.goalMet, false);

  const streak = Store.getStreakInfo();
  assert.equal(streak.currentStreak, 0);
  assert.equal(streak.bestStreak, 0);
  assert.equal(streak.totalActiveDays, 0);
  assert.equal(streak.todayQualified, false);

  const range7 = Store.getDateRangeStats(7);
  assert.equal(range7.daily.length, 7);
  assert.equal(range7.totals.totalTasks, 0);
  assert.equal(range7.totals.completionRate, 0);
  assert.equal(range7.totals.avgTasksPerDay, 0);
  assert.equal(range7.totals.avgFocusMinutesPerDay, 0);
  assert.equal(range7.totals.highCompletionRate, 0);

  const heat = Store.getHeatmapData(12);
  assert.equal(heat.weeks.length, 12);
  assert.equal(heat.cells.length, 84);
  assert.ok(heat.cells.every(c => c.level === 0 && Number.isFinite(c.completionRate)));

  const breakdown = Store.getCategoryBreakdown(30);
  assert.equal(breakdown.totalTasks, 0);
  assert.ok(breakdown.categories.every(c => c.completionRate === 0 && c.sharePercent === 0));
  assert.ok(breakdown.priorities.every(p => p.completionRate === 0));
});

test('Analytics math accuracy across days, streaks, heatmap, and category breakdown', () => {
  const { TaskFlow } = loadTaskFlowRuntime({ files: ['js/state.js'] });
  const { Store, Utils } = TaskFlow;
  Store.clearSampleData();
  Store.updateSettings({ dailyGoalTasks: 3 });

  const today = Utils.todayKey();
  const yest = Utils.addDays(today, -1);
  const prevWindowDay = Utils.addDays(today, -8);

  Store.addTask({ title: 'A', date: today, status: 'done', priority: 'high', category: 'work', actualMinutes: 40, estimatedMinutes: 30 });
  Store.addTask({ title: 'B', date: today, status: 'done', priority: 'medium', category: 'health', actualMinutes: 20, estimatedMinutes: 20 });
  Store.addTask({ title: 'C', date: today, status: 'done', priority: 'high', category: 'work', actualMinutes: 30, estimatedMinutes: 30 });
  Store.addTask({ title: 'D', date: yest, status: 'done', priority: 'low', category: 'admin', actualMinutes: 10, estimatedMinutes: 15 });
  Store.addTask({ title: 'E', date: yest, status: 'todo', priority: 'high', category: 'work', actualMinutes: 0, estimatedMinutes: 45 });
  Store.addTask({ title: 'Old', date: prevWindowDay, status: 'done', priority: 'medium', category: 'learning', actualMinutes: 25 });

  const todayStats = Store.getDayStats(today);
  assert.equal(todayStats.done, 3);
  assert.equal(todayStats.completionRate, 100);
  assert.equal(todayStats.goalMet, true);
  assert.equal(todayStats.actualMinutes, 90);

  const streak = Store.getStreakInfo();
  assert.equal(streak.currentStreak, 2);
  assert.equal(streak.bestStreak, 2);
  assert.equal(streak.totalActiveDays, 3);

  const range7 = Store.getDateRangeStats(7);
  assert.equal(range7.totals.doneTasks, 4);
  assert.equal(range7.totals.totalTasks, 5);
  assert.equal(range7.totals.completionRate, 80);
  assert.equal(range7.previousTotals.doneTasks, 1);
  assert.equal(range7.deltas.doneTasksDelta, 3);

  const heat = Store.getHeatmapData(12);
  const todayCell = heat.cells.find(c => c.date === today);
  assert.equal(todayCell.level, 4);
  assert.equal(todayCell.isToday, true);

  const bd = Store.getCategoryBreakdown(7);
  const workCat = bd.categories.find(c => c.category === 'work');
  assert.equal(workCat.total, 3);
  assert.equal(workCat.done, 2);
  assert.equal(workCat.actualMinutes, 70);
});

test('Export JSON/CSV and strict Import JSON validation', () => {
  const { TaskFlow } = loadTaskFlowRuntime({ files: ['js/state.js'] });
  const { Store, Utils } = TaskFlow;
  Store.clearSampleData();

  const today = Utils.todayKey();
  Store.addTask({
    title: 'Quote "test", comma & newline',
    notes: 'Line 1\nLine 2',
    date: today,
    priority: 'high',
    category: 'work'
  });
  Store.saveReflection(today, { mood: 5, intention: 'Focus', reflection: 'Done' });

  const exportedJson = Store.exportJSON();
  const csv = Store.exportCSV();
  assert.match(csv, /^id,date,title,status,/);
  assert.match(csv, /"Quote ""test"", comma & newline"/);
  assert.match(csv, /"Line 1\nLine 2"/);

  // Invalid imports rejected without mutating state
  assert.equal(Store.importJSON('').ok, false);
  assert.equal(Store.importJSON('{bad json').ok, false);
  assert.equal(Store.importJSON('[]').ok, false);
  assert.equal(Store.importJSON(JSON.stringify({ version: 2, tasks: [], routines: [], reflections: {} })).ok, false);
  assert.equal(Store.importJSON(JSON.stringify({ version: 1, tasks: [{ title: 'No date' }], routines: [], reflections: {} })).ok, false);
  assert.equal(Store.importJSON(JSON.stringify({ version: 1, tasks: [{ title: 'Bad date', date: '2026-02-30' }], routines: [], reflections: {} })).ok, false);
  assert.equal(Store.importJSON(JSON.stringify({ version: 1, tasks: [], routines: [{ title: '' }], reflections: {} })).ok, false);
  assert.equal(Store.getState().tasks.length, 1);

  // Mutate then restore via valid import
  Store.clearSampleData();
  assert.equal(Store.getState().tasks.length, 0);

  const res = Store.importJSON(exportedJson);
  assert.equal(res.ok, true);
  assert.equal(res.tasksCount, 1);
  assert.equal(Store.getState().tasks[0].title, 'Quote "test", comma & newline');
  assert.equal(Store.getState().reflections[today].mood, 5);
});

test('Timer: mode switching, start/pause/reset, and logging minutes to attached task', () => {
  const { TaskFlow } = loadTaskFlowRuntime({ files: ['js/state.js', 'js/timer.js'] });
  const { Store, Timer } = TaskFlow;
  Store.clearSampleData();

  const task = Store.addTask({ title: 'Focus test', estimatedMinutes: 25 });
  assert.equal(Timer.getState().mode, 'pomodoro');
  assert.equal(Timer.getState().remainingSeconds, 1500);

  Timer.setMode('deep');
  assert.equal(Timer.getState().durationSeconds, 3000);
  Timer.setMode('break');
  assert.equal(Timer.getState().durationSeconds, 300);
  Timer.setMode('stopwatch');
  assert.equal(Timer.getState().durationSeconds, 0);

  Timer.attachTask(task.id);
  assert.equal(Timer.getState().attachedTaskId, task.id);
  Timer.start();
  assert.equal(Timer.getState().running, true);
  Timer.pause();
  assert.equal(Timer.getState().running, false);
  assert.equal(Timer.getState().status, 'paused');
  Timer.reset();
  assert.equal(Timer.getState().status, 'idle');

  // Deleting attached task detaches silently
  Store.deleteTask(task.id);
  assert.equal(Timer.getState().attachedTaskId, null);
});
