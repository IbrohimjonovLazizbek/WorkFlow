(function (global) {
  'use strict';

  var TaskFlow = (global.TaskFlow = global.TaskFlow || {});

  var RING_RADIUS = 36;
  var RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
  var DONUT_RADIUS = 52;
  var DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

  var WEEKDAY_MON_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  var CATEGORY_COLORS = {
    work: 'var(--cat-work)',
    health: 'var(--cat-health)',
    learning: 'var(--cat-learning)',
    personal: 'var(--cat-personal)',
    admin: 'var(--cat-admin)'
  };

  var PRIORITY_META = {
    high: { label: 'High', color: 'var(--danger)' },
    medium: { label: 'Medium', color: 'var(--warning)' },
    low: { label: 'Low', color: 'var(--info)' }
  };

  var MOOD_META = {
    1: { label: 'Drained', emoji: '😫' },
    2: { label: 'Low', emoji: '😕' },
    3: { label: 'Steady', emoji: '🙂' },
    4: { label: 'Focused', emoji: '⚡' },
    5: { label: 'Peak', emoji: '🔥' }
  };

  var uiState = {
    initialized: false,
    rangeDays: 14,
    tooltipEl: null,
    activeTooltipTarget: null
  };

  function getStore() {
    return TaskFlow.Store;
  }

  function getUtils() {
    return TaskFlow.Utils;
  }

  function getApp() {
    return TaskFlow.App || null;
  }

  function esc(str) {
    var utils = getUtils();
    if (utils && typeof utils.escapeHtml === 'function') {
      return utils.escapeHtml(str == null ? '' : String(str));
    }
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clamp(val, min, max) {
    var utils = getUtils();
    if (utils && typeof utils.clamp === 'function') {
      return utils.clamp(val, min, max);
    }
    var n = Number(val);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function fmtMins(mins) {
    var utils = getUtils();
    if (utils && typeof utils.formatMinutes === 'function') {
      return utils.formatMinutes(mins);
    }
    var m = Math.max(0, Math.round(Number(mins) || 0));
    if (m === 0) return '0m';
    var h = Math.floor(m / 60);
    var rem = m % 60;
    if (h === 0) return rem + 'm';
    if (rem === 0) return h + 'h';
    return h + 'h ' + rem + 'm';
  }

  function safeNum(val, fallback) {
    var n = Number(val);
    return Number.isFinite(n) ? n : (fallback || 0);
  }

  function jumpToDateInToday(dateStr) {
    var store = getStore();
    var utils = getUtils();
    if (!store || !utils || !utils.isValidDateKey(dateStr)) return;
    hideTooltip();
    store.setSelectedDate(dateStr);
    store.setActiveView('today');
    var app = getApp();
    if (app && typeof app.announce === 'function') {
      app.announce('Showing tasks for ' + utils.formatDateLabel(dateStr));
    }
  }

  /* =========================================================================
   * Floating Tooltip Management
   * ========================================================================= */
  function ensureTooltipEl() {
    if (!global.document || !global.document.body) return null;
    if (uiState.tooltipEl && global.document.body.contains(uiState.tooltipEl)) {
      return uiState.tooltipEl;
    }
    var existing = global.document.getElementById('analytics-chart-tooltip');
    if (existing) {
      uiState.tooltipEl = existing;
      return existing;
    }
    var el = global.document.createElement('div');
    el.id = 'analytics-chart-tooltip';
    el.className = 'chart-tooltip';
    el.setAttribute('role', 'tooltip');
    el.hidden = true;
    global.document.body.appendChild(el);
    uiState.tooltipEl = el;
    return el;
  }

  function positionTooltip(targetEl, pointerEvent) {
    var tip = ensureTooltipEl();
    if (!tip || !targetEl) return;

    var rect = targetEl.getBoundingClientRect();
    var x = rect.left + rect.width / 2;
    var y = rect.top;

    if (pointerEvent && typeof pointerEvent.clientX === 'number' && pointerEvent.clientX > 0) {
      x = pointerEvent.clientX;
      if (rect.height > 110) {
        y = Math.min(rect.top + rect.height * 0.35, pointerEvent.clientY);
      }
    }

    var vw = global.innerWidth || 1024;
    var halfW = Math.min(160, Math.max(84, (tip.offsetWidth || 180) / 2 + 12));
    var clampedX = clamp(x, halfW, Math.max(halfW, vw - halfW));

    tip.style.left = clampedX + 'px';
    if (y < 64) {
      tip.style.top = (rect.bottom + 10) + 'px';
      tip.style.transform = 'translate(-50%, 0)';
    } else {
      tip.style.top = (y - 10) + 'px';
      tip.style.transform = 'translate(-50%, -100%)';
    }
  }

  function showTooltip(targetEl, pointerEvent) {
    var tip = ensureTooltipEl();
    if (!tip || !targetEl) return;
    var title = targetEl.getAttribute('data-tooltip-title') || '';
    var detail = targetEl.getAttribute('data-tooltip') || '';
    if (!title && !detail) return;

    tip.textContent = '';
    if (title) {
      var strong = global.document.createElement('div');
      strong.style.fontWeight = '700';
      strong.style.marginBottom = detail ? '2px' : '0';
      strong.textContent = title;
      tip.appendChild(strong);
    }
    if (detail) {
      var line = global.document.createElement('div');
      line.style.opacity = '0.92';
      line.textContent = detail;
      tip.appendChild(line);
    }

    tip.hidden = false;
    uiState.activeTooltipTarget = targetEl;
    positionTooltip(targetEl, pointerEvent);
  }

  function hideTooltip() {
    uiState.activeTooltipTarget = null;
    if (uiState.tooltipEl) {
      uiState.tooltipEl.hidden = true;
    }
  }

  /* =========================================================================
   * Today Progress Hero (#today-progress-banner)
   * ========================================================================= */
  function buildHeroInsight(dayStats, isToday) {
    var total = dayStats.total;
    var done = dayStats.done;
    var remaining = Math.max(0, total - done);
    var highRemaining = Math.max(0, dayStats.highTotal - dayStats.highDone);
    var dayWord = isToday ? 'today' : 'this day';

    if (total === 0) {
      return 'No tasks planned for ' + dayWord + ' yet — add a focus task or apply daily routines to begin.';
    }
    if (remaining === 0) {
      return dayStats.goalMet
        ? 'All ' + total + ' planned tasks complete and daily goal reached — great momentum!'
        : 'All ' + total + ' planned tasks complete — great momentum!';
    }
    var parts = [];
    if (highRemaining > 0) {
      parts.push(highRemaining + ' high-priority ' + (highRemaining === 1 ? 'task' : 'tasks') + ' remaining');
    } else {
      parts.push(remaining + ' ' + (remaining === 1 ? 'task' : 'tasks') + ' remaining');
    }
    if (dayStats.inProgress > 0) {
      parts.push(dayStats.inProgress + ' in progress');
    }
    if (dayStats.goalMet) {
      parts.push('daily goal reached!');
    }
    return parts.join(' • ');
  }

  function computeHeroViewModel() {
    var store = getStore();
    var utils = getUtils();
    var state = store.getState();
    var selectedDate = state.selectedDate || utils.todayKey();
    var isToday = selectedDate === utils.todayKey();
    var dayStats = store.getDayStats(selectedDate);
    var streak = store.getStreakInfo();

    var total = safeNum(dayStats.total, 0);
    var done = safeNum(dayStats.done, 0);
    var pct = total > 0 ? clamp(dayStats.completionRate, 0, 100) : 0;
    var dashOffset = Number((RING_CIRCUMFERENCE * (1 - pct / 100)).toFixed(2));

    var goalTasks = Math.max(1, safeNum(dayStats.goalTasks, 5));
    var goalMinutes = Math.max(15, safeNum(dayStats.goalMinutes, 120));
    var goalTaskPct = clamp(Math.round((done / goalTasks) * 100), 0, 100);
    var focusGoalPct = clamp(Math.round((dayStats.actualMinutes / goalMinutes) * 100), 0, 100);

    var goalSummaryLeft = done + ' of ' + goalTasks + ' goal ' + (goalTasks === 1 ? 'task' : 'tasks');
    if (dayStats.goalMet) {
      goalSummaryLeft += ' • Goal reached!';
    } else {
      var toGoal = Math.max(0, goalTasks - done);
      goalSummaryLeft += ' • ' + toGoal + ' more to reach goal';
    }

    var goalSummaryRight = 'Focus ' + fmtMins(dayStats.actualMinutes) + ' / ' + fmtMins(goalMinutes);

    return {
      selectedDate: selectedDate,
      isToday: isToday,
      title: isToday ? "Today's Progress" : utils.formatDateLabel(selectedDate) + ' Progress',
      pct: pct,
      done: done,
      total: total,
      inProgress: safeNum(dayStats.inProgress, 0),
      dashOffset: dashOffset,
      isRingComplete: total > 0 && pct === 100,
      goalMet: Boolean(dayStats.goalMet),
      goalTaskPct: goalTaskPct,
      goalSummaryLeft: goalSummaryLeft,
      goalSummaryRight: goalSummaryRight,
      insight: buildHeroInsight(dayStats, isToday),
      estimatedMinutes: safeNum(dayStats.estimatedMinutes, 0),
      actualMinutes: safeNum(dayStats.actualMinutes, 0),
      focusGoalPct: focusGoalPct,
      goalMinutes: goalMinutes,
      currentStreak: safeNum(streak.currentStreak, 0),
      bestStreak: safeNum(streak.bestStreak, 0),
      totalActiveDays: safeNum(streak.totalActiveDays, 0),
      todayQualified: Boolean(streak.todayQualified)
    };
  }

  function renderTodaySummary() {
    if (!global.document) return;
    var container = global.document.getElementById('today-progress-banner');
    if (!container) return;

    var vm = computeHeroViewModel();
    var existingRoot = container.querySelector('[data-hero-root]');

    if (existingRoot) {
      var ringFill = existingRoot.querySelector('.progress-ring-fill');
      if (ringFill) {
        ringFill.setAttribute('stroke-dasharray', RING_CIRCUMFERENCE.toFixed(2));
        ringFill.setAttribute('stroke-dashoffset', String(vm.dashOffset));
        ringFill.classList.toggle('is-complete', vm.isRingComplete);
      }
      var ringSvg = existingRoot.querySelector('.progress-ring-svg');
      if (ringSvg) {
        ringSvg.setAttribute('aria-label', vm.pct + '% complete, ' + vm.done + ' of ' + vm.total + ' tasks done');
      }

      var setText = function (sel, txt) {
        var el = existingRoot.querySelector(sel);
        if (el) el.textContent = txt;
      };

      setText('[data-hero-pct]', vm.pct + '%');
      setText('[data-hero-fraction]', vm.done + ' / ' + vm.total);
      setText('[data-hero-title]', vm.title);
      setText('[data-hero-streak-text]', vm.currentStreak + 'd streak');
      setText('[data-hero-insight]', vm.insight);
      setText('[data-hero-goal-left]', vm.goalSummaryLeft);
      setText('[data-hero-goal-right]', vm.goalSummaryRight);
      setText('[data-hero-focus-val]', fmtMins(vm.actualMinutes) + ' / ' + fmtMins(vm.estimatedMinutes));
      setText('[data-hero-focus-sub]', 'Goal ' + fmtMins(vm.goalMinutes) + ' (' + vm.focusGoalPct + '%)');
      setText('[data-hero-done-val]', vm.done + ' / ' + vm.total);
      setText('[data-hero-done-sub]', (vm.inProgress > 0 ? vm.inProgress + ' active • ' : '') + vm.pct + '% complete');
      setText('[data-hero-streak-val]', vm.currentStreak + (vm.currentStreak === 1 ? ' day' : ' days'));
      setText('[data-hero-streak-sub]', 'Best: ' + vm.bestStreak + 'd' + (vm.todayQualified ? ' • Active today' : ''));

      var streakBadge = existingRoot.querySelector('[data-hero-streak-badge]');
      if (streakBadge) {
        streakBadge.setAttribute('title', 'Current streak: ' + vm.currentStreak + 'd • Best streak: ' + vm.bestStreak + 'd (' + vm.totalActiveDays + ' active days)');
      }
      var goalPill = existingRoot.querySelector('[data-hero-goal-pill]');
      if (goalPill) {
        goalPill.hidden = !vm.goalMet;
      }
      var meterFill = existingRoot.querySelector('.goal-meter-fill');
      if (meterFill) {
        meterFill.style.width = vm.goalTaskPct + '%';
      }
      var meterEl = existingRoot.querySelector('.goal-meter');
      if (meterEl) {
        meterEl.setAttribute('aria-valuenow', String(vm.goalTaskPct));
      }
      return;
    }

    var streakTooltip = 'Current streak: ' + vm.currentStreak + 'd • Best streak: ' + vm.bestStreak + 'd (' + vm.totalActiveDays + ' active days)';

    container.innerHTML =
      '<section class="progress-hero" data-hero-root aria-label="Daily progress summary">' +
        '<div class="progress-hero-main">' +
          '<div class="ring-wrapper">' +
            '<svg class="progress-ring-svg" viewBox="0 0 88 88" role="img" aria-label="' + esc(vm.pct + '% complete, ' + vm.done + ' of ' + vm.total + ' tasks done') + '">' +
              '<circle class="progress-ring-track" cx="44" cy="44" r="' + RING_RADIUS + '"></circle>' +
              '<circle class="progress-ring-fill' + (vm.isRingComplete ? ' is-complete' : '') + '" cx="44" cy="44" r="' + RING_RADIUS + '" ' +
                'stroke-dasharray="' + RING_CIRCUMFERENCE.toFixed(2) + '" stroke-dashoffset="' + vm.dashOffset + '"></circle>' +
            '</svg>' +
            '<div class="ring-center">' +
              '<span class="hero-ring-percent" data-hero-pct>' + vm.pct + '%</span>' +
              '<span class="hero-ring-fraction" data-hero-fraction>' + vm.done + ' / ' + vm.total + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="hero-summary">' +
            '<div class="hero-headline-row">' +
              '<h2 class="hero-title" data-hero-title>' + esc(vm.title) + '</h2>' +
              '<span class="streak-badge" data-hero-streak-badge title="' + esc(streakTooltip) + '">' +
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
                  '<path d="M13.5 2.2c.4 3.4-1.8 5.4-3.3 7.1-1.3 1.5-2.2 2.9-2.2 4.7a4 4 0 0 0 8 0c0-1.6-.7-3.1-1.6-4.5-.2-.3 0-.8.4-.7 2.5.8 4.7 3.2 4.7 6.5A7.5 7.5 0 1 1 4.5 14c0-3.3 2-5.9 4.5-8.2 1.6-1.5 3.1-2.8 3.6-4.3.2-.5.8-.4.9.7z"></path>' +
                '</svg>' +
                '<span data-hero-streak-text>' + vm.currentStreak + 'd streak</span>' +
              '</span>' +
              '<span class="checkin-routines-done" data-hero-goal-pill' + (vm.goalMet ? '' : ' hidden') + '>Goal reached!</span>' +
            '</div>' +
            '<p class="hero-insight" data-hero-insight>' + esc(vm.insight) + '</p>' +
            '<div class="goal-meter-wrap">' +
              '<div class="goal-meter-label">' +
                '<span data-hero-goal-left>' + esc(vm.goalSummaryLeft) + '</span>' +
                '<span data-hero-goal-right>' + esc(vm.goalSummaryRight) + '</span>' +
              '</div>' +
              '<div class="goal-meter" role="progressbar" aria-label="Daily task goal progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + vm.goalTaskPct + '">' +
                '<div class="goal-meter-fill" style="width:' + vm.goalTaskPct + '%"></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="hero-stats-grid">' +
          '<div class="hero-stat">' +
            '<span class="hero-stat-label">Focus Time</span>' +
            '<span class="hero-stat-value" data-hero-focus-val>' + esc(fmtMins(vm.actualMinutes) + ' / ' + fmtMins(vm.estimatedMinutes)) + '</span>' +
            '<span class="hero-stat-sub" data-hero-focus-sub>' + esc('Goal ' + fmtMins(vm.goalMinutes) + ' (' + vm.focusGoalPct + '%)') + '</span>' +
          '</div>' +
          '<div class="hero-stat">' +
            '<span class="hero-stat-label">Completed</span>' +
            '<span class="hero-stat-value" data-hero-done-val>' + vm.done + ' / ' + vm.total + '</span>' +
            '<span class="hero-stat-sub" data-hero-done-sub>' + esc((vm.inProgress > 0 ? vm.inProgress + ' active • ' : '') + vm.pct + '% complete') + '</span>' +
          '</div>' +
          '<div class="hero-stat">' +
            '<span class="hero-stat-label">Active Streak</span>' +
            '<span class="hero-stat-value" data-hero-streak-val>' + vm.currentStreak + (vm.currentStreak === 1 ? ' day' : ' days') + '</span>' +
            '<span class="hero-stat-sub" data-hero-streak-sub>' + esc('Best: ' + vm.bestStreak + 'd' + (vm.todayQualified ? ' • Active today' : '')) + '</span>' +
          '</div>' +
        '</div>' +
      '</section>';
  }

  /* =========================================================================
   * Analytics Dashboard Helpers
   * ========================================================================= */
  function formatDelta(val, unit, prevLabel) {
    var n = Math.round(safeNum(val, 0));
    if (n > 0) {
      return {
        text: '+' + (unit === 'mins' ? fmtMins(n) : n + unit) + ' ' + prevLabel,
        cls: 'is-positive',
        trend: 'up'
      };
    }
    if (n < 0) {
      var absVal = Math.abs(n);
      return {
        text: '-' + (unit === 'mins' ? fmtMins(absVal) : absVal + unit) + ' ' + prevLabel,
        cls: 'is-negative',
        trend: 'down'
      };
    }
    return {
      text: (unit === 'mins' ? '0m' : '0' + unit) + ' ' + prevLabel,
      cls: '',
      trend: 'flat'
    };
  }

  function niceAxisMax(rawMax, minFloor) {
    var ceiling = Math.max(minFloor, rawMax);
    if (ceiling <= 4) return 4;
    if (ceiling <= 8) return 8;
    if (ceiling <= 12) return 12;
    var step = Math.ceil(ceiling / 4);
    if (step > 5) step = Math.ceil(step / 5) * 5;
    return step * 4;
  }

  function niceMinutesMax(rawMax) {
    var ceiling = Math.max(60, rawMax);
    var step = Math.ceil(ceiling / 4 / 30) * 30;
    return Math.max(60, step * 4);
  }

  function buildSmoothLinePath(points, baselineY) {
    if (!points || points.length === 0) return '';
    if (points.length === 1) {
      return 'M ' + points[0].x.toFixed(1) + ' ' + points[0].y.toFixed(1);
    }
    var d = 'M ' + points[0].x.toFixed(1) + ' ' + points[0].y.toFixed(1);
    for (var i = 0; i < points.length - 1; i += 1) {
      var p0 = points[i === 0 ? i : i - 1];
      var p1 = points[i];
      var p2 = points[i + 1];
      var p3 = points[i + 2 < points.length ? i + 2 : i + 1];

      var cp1x = p1.x + (p2.x - p0.x) / 6;
      var cp1y = clamp(p1.y + (p2.y - p0.y) / 6, 12, baselineY);
      var cp2x = p2.x - (p3.x - p1.x) / 6;
      var cp2y = clamp(p2.y - (p3.y - p1.y) / 6, 12, baselineY);

      d += ' C ' + cp1x.toFixed(1) + ' ' + cp1y.toFixed(1) + ', ' +
        cp2x.toFixed(1) + ' ' + cp2y.toFixed(1) + ', ' +
        p2.x.toFixed(1) + ' ' + p2.y.toFixed(1);
    }
    return d;
  }

  function formatShortAxisDate(dateStr) {
    var utils = getUtils();
    var dt = utils.parseDateKey(dateStr);
    if (!dt) return dateStr;
    return utils.SHORT_MONTHS[dt.getMonth()] + ' ' + dt.getDate();
  }

  function renderKpiGrid(rangeStats, streak) {
    var totals = rangeStats.totals;
    var deltas = rangeStats.deltas;
    var days = rangeStats.days;
    var prevLabel = 'vs prev ' + days + 'd';

    var taskDelta = formatDelta(deltas.doneTasksDelta, '', prevLabel);
    var minsDelta = formatDelta(deltas.actualMinutesDelta, 'mins', prevLabel);
    var rateDelta = formatDelta(deltas.completionRateDelta, '%', prevLabel);

    var highText = totals.highTotal > 0
      ? totals.highCompletionRate + '% high-priority (' + totals.highDone + '/' + totals.highTotal + ')'
      : 'No high-priority tasks';

    var streakDeltaCls = streak.todayQualified ? 'is-positive' : '';
    var streakDeltaTrend = streak.todayQualified ? 'up' : 'flat';
    var streakBadgeText = streak.todayQualified ? 'Active today' : 'Log 1 task today';

    return (
      '<section class="kpi-grid" aria-label="Key performance metrics">' +
        '<article class="kpi-card">' +
          '<div class="kpi-header">' +
            '<span class="kpi-label">Tasks Completed</span>' +
            '<span class="category-badge" data-category="work">' + days + 'd</span>' +
          '</div>' +
          '<div class="kpi-value">' + totals.doneTasks + ' <span style="font-size:var(--text-sm);font-weight:500;color:var(--text-muted);">/ ' + totals.totalTasks + '</span></div>' +
          '<div class="kpi-footer">' +
            '<span>' + totals.completionRate + '% completion rate</span>' +
            '<span class="kpi-delta ' + taskDelta.cls + '" data-trend="' + taskDelta.trend + '">' + esc(taskDelta.text) + '</span>' +
          '</div>' +
        '</article>' +

        '<article class="kpi-card">' +
          '<div class="kpi-header">' +
            '<span class="kpi-label">Focus Time Logged</span>' +
            '<span class="category-badge" data-category="health">Focus</span>' +
          '</div>' +
          '<div class="kpi-value">' + esc(fmtMins(totals.actualMinutes)) + '</div>' +
          '<div class="kpi-footer">' +
            '<span>Avg ' + esc(fmtMins(totals.avgFocusMinutesPerDay)) + ' / day</span>' +
            '<span class="kpi-delta ' + minsDelta.cls + '" data-trend="' + minsDelta.trend + '">' + esc(minsDelta.text) + '</span>' +
          '</div>' +
        '</article>' +

        '<article class="kpi-card">' +
          '<div class="kpi-header">' +
            '<span class="kpi-label">Current Streak</span>' +
            '<span class="category-badge" data-category="personal">Habit</span>' +
          '</div>' +
          '<div class="kpi-value">' + streak.currentStreak + ' <span style="font-size:var(--text-sm);font-weight:500;color:var(--text-muted);">' + (streak.currentStreak === 1 ? 'day' : 'days') + '</span></div>' +
          '<div class="kpi-footer">' +
            '<span>Best: ' + streak.bestStreak + 'd • ' + streak.totalActiveDays + ' active days</span>' +
            '<span class="kpi-delta ' + streakDeltaCls + '" data-trend="' + streakDeltaTrend + '">' + esc(streakBadgeText) + '</span>' +
          '</div>' +
        '</article>' +

        '<article class="kpi-card">' +
          '<div class="kpi-header">' +
            '<span class="kpi-label">Daily Velocity</span>' +
            '<span class="category-badge" data-category="learning">Pace</span>' +
          '</div>' +
          '<div class="kpi-value">' + totals.avgTasksPerDay.toFixed(1) + ' <span style="font-size:var(--text-sm);font-weight:500;color:var(--text-muted);">tasks/day</span></div>' +
          '<div class="kpi-footer">' +
            '<span>' + esc(highText) + '</span>' +
            '<span class="kpi-delta ' + rateDelta.cls + '" data-trend="' + rateDelta.trend + '">' + esc(rateDelta.text) + '</span>' +
          '</div>' +
        '</article>' +
      '</section>'
    );
  }

  function renderTrendChartCard(rangeStats, selectedDate) {
    var utils = getUtils();
    var daily = rangeStats.daily || [];
    var daysCount = daily.length || 1;
    var today = utils.todayKey();

    var width = 760;
    var height = 264;
    var padLeft = 36;
    var padRight = 46;
    var padTop = 18;
    var padBottom = 34;
    var plotW = width - padLeft - padRight;
    var plotH = height - padTop - padBottom;
    var baselineY = padTop + plotH;

    var maxTaskRaw = 0;
    var maxMinsRaw = 0;
    daily.forEach(function (d) {
      if (d.total > maxTaskRaw) maxTaskRaw = d.total;
      if (d.done > maxTaskRaw) maxTaskRaw = d.done;
      if (d.actualMinutes > maxMinsRaw) maxMinsRaw = d.actualMinutes;
    });

    var maxTasks = niceAxisMax(maxTaskRaw, 4);
    var maxMins = niceMinutesMax(maxMinsRaw);

    var gridHtml = '';
    var tickCount = 4;
    for (var t = 0; t <= tickCount; t += 1) {
      var ratio = t / tickCount;
      var y = Number((baselineY - ratio * plotH).toFixed(1));
      var taskTickVal = Math.round(maxTasks * ratio);
      var minsTickVal = Math.round(maxMins * ratio);

      gridHtml +=
        '<line class="chart-gridline" x1="' + padLeft + '" y1="' + y + '" x2="' + (width - padRight) + '" y2="' + y + '"></line>' +
        '<text x="' + (padLeft - 8) + '" y="' + (y + 3.5) + '" text-anchor="end" font-size="10.5">' + taskTickVal + '</text>' +
        '<text x="' + (width - padRight + 8) + '" y="' + (y + 3.5) + '" text-anchor="start" font-size="10.5">' + esc(fmtMins(minsTickVal)) + '</text>';
    }

    var slotW = plotW / daysCount;
    var barWidth = Math.max(5, Math.min(28, slotW * 0.56));
    var rx = barWidth >= 14 ? 4 : 2.5;
    var labelStep = daysCount <= 7 ? 1 : (daysCount <= 14 ? 2 : 5);

    var barsHtml = '';
    var xLabelsHtml = '';
    var linePoints = [];

    daily.forEach(function (d, idx) {
      var cx = padLeft + slotW * idx + slotW / 2;
      var bx = Number((cx - barWidth / 2).toFixed(1));

      var plannedH = d.total > 0 ? Math.max(3, (d.total / maxTasks) * plotH) : 0;
      var plannedY = Number((baselineY - plannedH).toFixed(1));

      var doneH = d.done > 0 ? Math.max(3, (d.done / maxTasks) * plotH) : 0;
      var doneY = Number((baselineY - doneH).toFixed(1));

      var isSelected = d.date === selectedDate;
      var isToday = d.date === today;

      var tipTitle = utils.formatDateLabel(d.date) + ' (' + d.date + ')';
      var tipDetail = d.done + '/' + d.total + ' tasks (' + d.completionRate + '%) • ' + fmtMins(d.actualMinutes) + ' focus';

      barsHtml +=
        '<g class="chart-day-col" style="cursor:pointer;" tabindex="0" role="button" ' +
          'data-chart-date="' + esc(d.date) + '" ' +
          'data-tooltip-title="' + esc(tipTitle) + '" ' +
          'data-tooltip="' + esc(tipDetail) + '" ' +
          'aria-label="' + esc(tipTitle + ': ' + tipDetail + '. Click to view day.') + '">' +
          '<rect x="' + Number((padLeft + slotW * idx).toFixed(1)) + '" y="' + padTop + '" width="' + slotW.toFixed(1) + '" height="' + plotH + '" fill="transparent"></rect>';

      if (isSelected) {
        barsHtml +=
          '<rect x="' + Number((cx - slotW * 0.44).toFixed(1)) + '" y="' + padTop + '" width="' + Number((slotW * 0.88).toFixed(1)) + '" height="' + plotH + '" rx="6" fill="var(--accent-soft)" opacity="0.65"></rect>';
      }

      if (plannedH > 0) {
        barsHtml +=
          '<rect class="chart-bar-planned" x="' + bx + '" y="' + plannedY + '" width="' + barWidth.toFixed(1) + '" height="' + plannedH.toFixed(1) + '" rx="' + rx + '"></rect>';
      }

      if (doneH > 0) {
        barsHtml +=
          '<rect class="chart-bar-done" x="' + bx + '" y="' + doneY + '" width="' + barWidth.toFixed(1) + '" height="' + doneH.toFixed(1) + '" rx="' + rx + '"></rect>';
      }

      barsHtml += '</g>';

      var lineY = Number((baselineY - (d.actualMinutes / maxMins) * plotH).toFixed(1));
      linePoints.push({ x: cx, y: lineY, day: d });

      var showLabel = (idx % labelStep === 0) || idx === daysCount - 1;
      if (daysCount === 14 && idx === daysCount - 2) {
        showLabel = false;
      }
      if (showLabel) {
        var axisLabel = isToday ? 'Today' : formatShortAxisDate(d.date);
        xLabelsHtml +=
          '<text x="' + cx.toFixed(1) + '" y="' + (height - 10) + '" text-anchor="middle" font-size="10.5"' +
            (isToday || isSelected ? ' style="fill:var(--text-primary);font-weight:600;"' : '') + '>' +
            esc(axisLabel) +
          '</text>';
      }
    });

    var linePath = buildSmoothLinePath(linePoints, baselineY);
    var areaPath = '';
    if (linePoints.length > 1 && maxMinsRaw > 0) {
      areaPath = linePath +
        ' L ' + linePoints[linePoints.length - 1].x.toFixed(1) + ' ' + baselineY.toFixed(1) +
        ' L ' + linePoints[0].x.toFixed(1) + ' ' + baselineY.toFixed(1) + ' Z';
    }

    var dotsHtml = '';
    if (maxMinsRaw > 0) {
      linePoints.forEach(function (pt) {
        if (pt.day.actualMinutes > 0 || daysCount <= 14) {
          dotsHtml +=
            '<circle cx="' + pt.x.toFixed(1) + '" cy="' + pt.y.toFixed(1) + '" r="' + (daysCount <= 14 ? '3' : '2.2') + '" ' +
              'fill="var(--bg-surface)" stroke="var(--success)" stroke-width="2" style="pointer-events:none;"></circle>';
        }
      });
    }

    return (
      '<article class="chart-card is-wide">' +
        '<header class="chart-card-header">' +
          '<div>' +
            '<h3 class="chart-card-title">Task Completion &amp; Focus Trend</h3>' +
            '<p class="chart-card-subtitle">Click any bar to inspect that day in Today view</p>' +
          '</div>' +
          '<div class="chart-legend" aria-label="Chart legend">' +
            '<span class="chart-legend-item"><span class="chart-legend-swatch" style="background:var(--chart-planned);"></span>Planned</span>' +
            '<span class="chart-legend-item"><span class="chart-legend-swatch" style="background:var(--accent);"></span>Completed</span>' +
            '<span class="chart-legend-item"><span class="chart-legend-swatch" style="background:var(--success);border-radius:99px;"></span>Focus Time</span>' +
          '</div>' +
        '</header>' +
        '<svg class="svg-chart" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Task completion and focus time trend over ' + daysCount + ' days">' +
          '<defs>' +
            '<linearGradient id="tf-focus-area-grad" x1="0" y1="0" x2="0" y2="1">' +
              '<stop offset="0%" stop-color="var(--success)" stop-opacity="0.18"></stop>' +
              '<stop offset="100%" stop-color="var(--success)" stop-opacity="0.01"></stop>' +
            '</linearGradient>' +
          '</defs>' +
          gridHtml +
          barsHtml +
          (areaPath ? '<path d="' + areaPath + '" fill="url(#tf-focus-area-grad)" style="pointer-events:none;"></path>' : '') +
          (linePath ? '<path class="chart-focus-line" d="' + linePath + '" style="pointer-events:none;"></path>' : '') +
          dotsHtml +
          xLabelsHtml +
        '</svg>' +
      '</article>'
    );
  }

  function renderCategoryBreakdownCard(breakdown) {
    var categories = breakdown.categories || [];
    var totalTasks = safeNum(breakdown.totalTasks, 0);
    var totalDone = safeNum(breakdown.totalDone, 0);
    var overallPct = totalTasks > 0 ? Math.round((totalDone / totalTasks) * 100) : 0;

    var donutSegmentsHtml = '';
    if (totalTasks > 0) {
      var activeCats = categories.filter(function (c) { return c.total > 0; });
      var gapLen = activeCats.length > 1 ? 2.5 : 0;
      var accumulatedOffset = 0;

      activeCats.forEach(function (cat) {
        var frac = cat.total / totalTasks;
        var rawLen = frac * DONUT_CIRCUMFERENCE;
        var segLen = Math.max(1.5, rawLen - gapLen);
        var color = CATEGORY_COLORS[cat.category] || 'var(--accent)';
        var tipTitle = cat.label + ' (' + cat.sharePercent + '% of tasks)';
        var tipDetail = cat.done + '/' + cat.total + ' completed (' + cat.completionRate + '%) • ' + fmtMins(cat.actualMinutes) + ' focus';

        donutSegmentsHtml +=
          '<circle cx="74" cy="74" r="' + DONUT_RADIUS + '" fill="none" stroke="' + color + '" stroke-width="18" stroke-linecap="butt" ' +
            'stroke-dasharray="' + segLen.toFixed(2) + ' ' + DONUT_CIRCUMFERENCE.toFixed(2) + '" ' +
            'stroke-dashoffset="' + (-accumulatedOffset).toFixed(2) + '" ' +
            'style="cursor:pointer;" tabindex="0" role="img" ' +
            'data-tooltip-title="' + esc(tipTitle) + '" ' +
            'data-tooltip="' + esc(tipDetail) + '" ' +
            'aria-label="' + esc(tipTitle + ': ' + tipDetail) + '"></circle>';

        accumulatedOffset += rawLen;
      });
    }

    var rowsHtml = categories.map(function (cat) {
      var color = CATEGORY_COLORS[cat.category] || 'var(--accent)';
      var pct = safeNum(cat.completionRate, 0);
      return (
        '<div class="breakdown-row">' +
          '<div class="breakdown-row-head">' +
            '<span class="breakdown-label">' +
              '<span class="category-dot" data-category="' + esc(cat.category) + '"></span>' +
              '<span>' + esc(cat.label) + '</span>' +
            '</span>' +
            '<span class="breakdown-count">' + cat.done + '/' + cat.total + ' (' + pct + '%) • ' + esc(fmtMins(cat.actualMinutes)) + '</span>' +
          '</div>' +
          '<div class="breakdown-bar" role="progressbar" aria-label="' + esc(cat.label + ' completion rate') + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '">' +
            '<div class="breakdown-bar-fill" style="width:' + pct + '%;background-color:' + color + ';"></div>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    return (
      '<article class="chart-card">' +
        '<header class="chart-card-header">' +
          '<div>' +
            '<h3 class="chart-card-title">Category Breakdown</h3>' +
            '<p class="chart-card-subtitle">Completion rate &amp; focus time across categories</p>' +
          '</div>' +
          '<span class="breakdown-pct" style="font-size:var(--text-xs);">' + totalDone + '/' + totalTasks + ' done</span>' +
        '</header>' +
        '<div class="breakdown-layout">' +
          '<div style="position:relative;width:148px;height:148px;flex-shrink:0;">' +
            '<svg class="svg-chart" width="148" height="148" viewBox="0 0 148 148" role="img" aria-label="Task distribution by category">' +
              '<g transform="rotate(-90 74 74)">' +
                '<circle cx="74" cy="74" r="' + DONUT_RADIUS + '" fill="none" stroke="var(--chart-track)" stroke-width="18"></circle>' +
                donutSegmentsHtml +
              '</g>' +
            '</svg>' +
            '<div class="ring-center">' +
              '<span style="font-size:var(--text-lg);font-weight:700;color:var(--text-primary);line-height:1.1;font-variant-numeric:tabular-nums;">' + overallPct + '%</span>' +
              '<span style="font-size:var(--text-2xs);color:var(--text-muted);font-variant-numeric:tabular-nums;">' + totalDone + ' / ' + totalTasks + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="breakdown-list">' + rowsHtml + '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function renderPriorityAndExecutionCard(breakdown, rangeStats) {
    var priorities = breakdown.priorities || [];
    var totals = rangeStats.totals;

    var priorityRowsHtml = priorities.map(function (p) {
      var meta = PRIORITY_META[p.priority] || PRIORITY_META.medium;
      var pct = safeNum(p.completionRate, 0);
      return (
        '<div class="breakdown-row">' +
          '<div class="breakdown-row-head">' +
            '<span class="breakdown-label">' +
              '<span class="priority-badge" data-priority="' + esc(p.priority) + '">' + esc(meta.label) + '</span>' +
            '</span>' +
            '<span class="breakdown-count">' + p.done + '/' + p.total + ' tasks (' + pct + '%)</span>' +
          '</div>' +
          '<div class="breakdown-bar" role="progressbar" aria-label="' + esc(meta.label + ' priority completion rate') + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '">' +
            '<div class="breakdown-bar-fill" style="width:' + pct + '%;background-color:' + meta.color + ';"></div>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    var estMins = safeNum(totals.estimatedMinutes, 0);
    var actMins = safeNum(totals.actualMinutes, 0);
    var focusRatio = estMins > 0 ? clamp(Math.round((actMins / estMins) * 100), 0, 100) : (actMins > 0 ? 100 : 0);

    var daily = rangeStats.daily || [];
    var activeDaysInRange = daily.filter(function (d) { return d.done > 0; }).length;
    var activeRatio = daily.length > 0 ? Math.round((activeDaysInRange / daily.length) * 100) : 0;

    return (
      '<article class="chart-card">' +
        '<header class="chart-card-header">' +
          '<div>' +
            '<h3 class="chart-card-title">Priority &amp; Execution</h3>' +
            '<p class="chart-card-subtitle">Completion rate by priority &amp; focus pacing</p>' +
          '</div>' +
          '<span class="breakdown-pct" style="font-size:var(--text-xs);">' + activeDaysInRange + '/' + daily.length + ' active days</span>' +
        '</header>' +
        '<div class="breakdown-list">' +
          priorityRowsHtml +
          '<div style="border-top:1px solid var(--border-subtle);padding-top:var(--space-3);margin-top:var(--space-1);display:flex;flex-direction:column;gap:var(--space-3);">' +
            '<div class="breakdown-row">' +
              '<div class="breakdown-row-head">' +
                '<span class="breakdown-label">Focus Logged vs Planned</span>' +
                '<span class="breakdown-count">' + esc(fmtMins(actMins) + ' / ' + fmtMins(estMins)) + ' (' + focusRatio + '%)</span>' +
              '</div>' +
              '<div class="breakdown-bar">' +
                '<div class="breakdown-bar-fill" style="width:' + focusRatio + '%;background-color:var(--success);"></div>' +
              '</div>' +
            '</div>' +
            '<div class="breakdown-row">' +
              '<div class="breakdown-row-head">' +
                '<span class="breakdown-label">Consistent Days in Window</span>' +
                '<span class="breakdown-count">' + activeDaysInRange + '/' + daily.length + ' days (' + activeRatio + '%)</span>' +
              '</div>' +
              '<div class="breakdown-bar">' +
                '<div class="breakdown-bar-fill" style="width:' + activeRatio + '%;background-color:var(--accent);"></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function renderHeatmapCard(heatmapData) {
    var weeks = heatmapData.weeks || [];
    var weekCount = weeks.length || 12;

    var monthHeadersHtml = '<span></span>';
    var prevMonth = '';
    for (var w = 0; w < weekCount; w += 1) {
      var col = weeks[w] || [];
      var label = '';
      if (col.length > 0) {
        if (w === 0) {
          var firstDayNum = Number(col[0].date.slice(8, 10));
          var nextCol = weeks[1] || [];
          var nextChangesMonth = nextCol.length > 0 && nextCol[0].monthLabel !== col[0].monthLabel;
          if (!(firstDayNum > 24 && nextChangesMonth)) {
            label = col[0].monthLabel;
          }
        } else {
          for (var d = 0; d < col.length; d += 1) {
            var dayNum = Number(col[d].date.slice(8, 10));
            if (dayNum <= 7 && col[d].monthLabel !== prevMonth) {
              label = col[d].monthLabel;
              break;
            }
          }
          if (!label && col[0].monthLabel !== prevMonth) {
            label = col[0].monthLabel;
          }
        }
        if (label) prevMonth = label;
      }
      monthHeadersHtml +=
        '<span style="font-size:var(--text-2xs);font-weight:600;color:var(--text-muted);display:inline-block;width:16px;overflow:visible;white-space:nowrap;">' +
          esc(label) +
        '</span>';
    }

    var rowsHtml = '';
    for (var r = 0; r < 7; r += 1) {
      rowsHtml += '<span class="heatmap-day-label">' + WEEKDAY_MON_FIRST[r] + '</span>';
      for (var cw = 0; cw < weekCount; cw += 1) {
        var cell = weeks[cw] && weeks[cw][r];
        if (!cell) {
          rowsHtml += '<span class="heatmap-cell" data-level="0" aria-hidden="true"></span>';
          continue;
        }
        var minsText = cell.actualMinutes + 'm';
        var tipTitle = cell.date;
        var tipDetail = cell.done + '/' + cell.total + ' tasks (' + cell.completionRate + '%), ' + minsText + ' focus';
        var cellStyle = '';
        if (cell.isToday) {
          cellStyle = 'box-shadow:0 0 0 1.5px var(--text-primary);';
        } else if (cell.isFuture) {
          cellStyle = 'opacity:0.42;';
        }

        rowsHtml +=
          '<button type="button" class="heatmap-cell" data-level="' + cell.level + '" ' +
            'data-heatmap-date="' + esc(cell.date) + '" ' +
            'data-tooltip-title="' + esc(tipTitle) + '" ' +
            'data-tooltip="' + esc(tipDetail) + '" ' +
            (cellStyle ? 'style="' + cellStyle + '" ' : '') +
            'aria-label="' + esc(tipTitle + ': ' + tipDetail) + '"></button>';
      }
    }

    return (
      '<section class="heatmap-card" aria-label="12-Week Daily Consistency Heatmap">' +
        '<header class="chart-card-header">' +
          '<div>' +
            '<h3 class="chart-card-title">12-Week Consistency Heatmap</h3>' +
            '<p class="chart-card-subtitle">' + esc(heatmapData.startDate + ' to ' + heatmapData.endDate) + ' • Click any day to jump to Today view</p>' +
          '</div>' +
          '<div class="heatmap-legend" aria-label="Heatmap intensity legend">' +
            '<span>Less</span>' +
            '<span class="heatmap-cell" data-level="0" aria-hidden="true"></span>' +
            '<span class="heatmap-cell" data-level="1" aria-hidden="true"></span>' +
            '<span class="heatmap-cell" data-level="2" aria-hidden="true"></span>' +
            '<span class="heatmap-cell" data-level="3" aria-hidden="true"></span>' +
            '<span class="heatmap-cell" data-level="4" aria-hidden="true"></span>' +
            '<span>More</span>' +
          '</div>' +
        '</header>' +
        '<div class="heatmap-scroll">' +
          '<div class="heatmap-grid">' +
            monthHeadersHtml +
            rowsHtml +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  function renderReflectionLogCard() {
    var store = getStore();
    var utils = getUtils();
    var state = store.getState();
    var reflections = state.reflections || {};
    var today = utils.todayKey();

    var entries = [];
    for (var offset = 0; offset < 14; offset += 1) {
      var dStr = utils.addDays(today, -offset);
      var stats = store.getDayStats(dStr);
      var refl = reflections[dStr] || null;
      var hasReflContent = Boolean(refl && (refl.mood || (refl.intention && refl.intention.trim()) || (refl.reflection && refl.reflection.trim())));
      if (stats.total > 0 || hasReflContent) {
        entries.push({ date: dStr, stats: stats, refl: refl });
      }
    }

    var bodyHtml = '';
    if (entries.length === 0) {
      bodyHtml =
        '<div class="empty-state">' +
          '<div class="empty-state-icon" aria-hidden="true">' +
            '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
              '<path d="M12 20h9"></path>' +
              '<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>' +
            '</svg>' +
          '</div>' +
          '<h4 class="empty-state-title">No recent check-ins or task logs yet</h4>' +
          '<p class="empty-state-desc">Complete tasks or save a daily reflection in Today view to build your progress log.</p>' +
          '<div class="empty-state-actions">' +
            '<button type="button" class="btn btn-primary btn-sm" data-analytics-goto-today>Go to Today View</button>' +
          '</div>' +
        '</div>';
    } else {
      bodyHtml = '<div class="reflection-log-list">' + entries.map(function (item) {
        var s = item.stats;
        var r = item.refl;
        var statusAttr = s.total > 0 && s.done === s.total ? 'done' : (s.done > 0 ? 'in_progress' : 'todo');

        var moodHtml = '';
        if (r && r.mood && MOOD_META[r.mood]) {
          var mm = MOOD_META[r.mood];
          moodHtml =
            '<span class="time-badge" style="font-weight:600;">' +
              '<span aria-hidden="true">' + mm.emoji + '</span> ' + esc(mm.label) +
            '</span>';
        }

        var intentionHtml = r && r.intention && r.intention.trim()
          ? '<div style="font-size:var(--text-xs);font-weight:600;color:var(--text-primary);">Intention: ' + esc(r.intention.trim()) + '</div>'
          : '';

        var rawSnippet = r && r.reflection ? r.reflection.trim() : '';
        var snippet = rawSnippet.length > 180 ? rawSnippet.slice(0, 177) + '...' : rawSnippet;
        var reflectionHtml = snippet
          ? '<p class="reflection-log-text">' + esc(snippet) + '</p>'
          : '<p class="reflection-log-text" style="color:var(--text-muted);font-style:italic;">No evening reflection logged.</p>';

        return (
          '<article class="reflection-log-item">' +
            '<div class="reflection-log-date">' +
              '<button type="button" data-log-date="' + esc(item.date) + '" style="text-align:left;color:var(--accent-text);font-weight:700;" title="Open ' + esc(item.date) + ' in Today view">' +
                esc(utils.formatDateLabel(item.date)) +
              '</button>' +
              '<div style="font-size:var(--text-2xs);font-weight:500;color:var(--text-muted);margin-top:2px;">' + esc(item.date) + '</div>' +
            '</div>' +
            '<div class="reflection-log-content">' +
              intentionHtml +
              reflectionHtml +
            '</div>' +
            '<div class="reflection-log-stats">' +
              '<span class="status-badge" data-status="' + statusAttr + '" style="cursor:default;">' + s.done + '/' + s.total + ' (' + s.completionRate + '%)</span>' +
              '<span class="time-badge">' + esc(fmtMins(s.actualMinutes)) + ' focus</span>' +
              moodHtml +
            '</div>' +
          '</article>'
        );
      }).join('') + '</div>';
    }

    return (
      '<section class="chart-card is-wide" aria-label="Recent check-ins and daily progress log">' +
        '<header class="chart-card-header">' +
          '<div>' +
            '<h3 class="chart-card-title">Recent Check-ins &amp; Daily Progress Log</h3>' +
            '<p class="chart-card-subtitle">Last 14 days of task execution, focus time, mood &amp; reflections</p>' +
          '</div>' +
        '</header>' +
        bodyHtml +
      '</section>'
    );
  }

  function renderDashboard() {
    if (!global.document) return;
    var container = global.document.getElementById('view-analytics');
    if (!container) return;

    hideTooltip();

    var store = getStore();
    var state = store.getState();
    var days = uiState.rangeDays;
    var rangeStats = store.getDateRangeStats(days);
    var streak = store.getStreakInfo();
    var heatmapData = store.getHeatmapData(12);
    var breakdown = store.getCategoryBreakdown(days);

    var rangeTabs = [7, 14, 30].map(function (d) {
      var active = days === d ? ' active' : '';
      return (
        '<button type="button" class="segmented-tab' + active + '" data-analytics-range="' + d + '" aria-pressed="' + (days === d ? 'true' : 'false') + '">' +
          d + ' Days' +
        '</button>'
      );
    }).join('');

    container.innerHTML =
      '<div class="analytics-toolbar">' +
        '<div>' +
          '<h2 style="font-size:var(--text-lg);font-weight:700;color:var(--text-primary);">Performance Overview</h2>' +
          '<p style="font-size:var(--text-xs);color:var(--text-muted);margin-top:2px;">' +
            esc(rangeStats.startDate + ' – ' + rangeStats.endDate + ' • ' + rangeStats.totals.doneTasks + ' tasks completed') +
          '</p>' +
        '</div>' +
        '<div class="segmented-tabs" role="group" aria-label="Analytics timeframe">' +
          rangeTabs +
        '</div>' +
      '</div>' +
      renderKpiGrid(rangeStats, streak) +
      '<div class="charts-grid">' +
        renderTrendChartCard(rangeStats, state.selectedDate) +
        renderCategoryBreakdownCard(breakdown) +
        renderPriorityAndExecutionCard(breakdown, rangeStats) +
      '</div>' +
      renderHeatmapCard(heatmapData) +
      renderReflectionLogCard();
  }

  /* =========================================================================
   * Event Delegation & Initialization
   * ========================================================================= */
  function init() {
    if (uiState.initialized || !global.document) return;
    uiState.initialized = true;

    var container = global.document.getElementById('view-analytics');
    if (!container) return;

    container.addEventListener('click', function (e) {
      var rangeBtn = e.target.closest('[data-analytics-range]');
      if (rangeBtn) {
        var nextDays = Number(rangeBtn.getAttribute('data-analytics-range'));
        if (nextDays === 7 || nextDays === 14 || nextDays === 30) {
          uiState.rangeDays = nextDays;
          renderDashboard();
        }
        return;
      }

      var chartDateEl = e.target.closest('[data-chart-date]');
      if (chartDateEl) {
        jumpToDateInToday(chartDateEl.getAttribute('data-chart-date'));
        return;
      }

      var heatCell = e.target.closest('[data-heatmap-date]');
      if (heatCell) {
        jumpToDateInToday(heatCell.getAttribute('data-heatmap-date'));
        return;
      }

      var logDateBtn = e.target.closest('[data-log-date]');
      if (logDateBtn) {
        jumpToDateInToday(logDateBtn.getAttribute('data-log-date'));
        return;
      }

      if (e.target.closest('[data-analytics-goto-today]')) {
        hideTooltip();
        getStore().setActiveView('today');
      }
    });

    container.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var chartDateEl = e.target.closest('[data-chart-date]');
      if (chartDateEl) {
        e.preventDefault();
        jumpToDateInToday(chartDateEl.getAttribute('data-chart-date'));
      }
    });

    container.addEventListener('mouseover', function (e) {
      var target = e.target.closest('[data-tooltip]');
      if (!target) return;
      showTooltip(target, e);
    });

    container.addEventListener('mousemove', function (e) {
      if (!uiState.activeTooltipTarget) return;
      var target = e.target.closest('[data-tooltip]');
      if (target === uiState.activeTooltipTarget) {
        positionTooltip(target, e);
      }
    });

    container.addEventListener('mouseout', function (e) {
      var target = e.target.closest('[data-tooltip]');
      if (!target) return;
      var related = e.relatedTarget;
      if (related && target.contains(related)) return;
      hideTooltip();
    });

    container.addEventListener('focusin', function (e) {
      var target = e.target.closest('[data-tooltip]');
      if (target) {
        showTooltip(target, null);
      }
    });

    container.addEventListener('focusout', function (e) {
      if (e.target && e.target.closest && e.target.closest('[data-tooltip]')) {
        hideTooltip();
      }
    });

    global.addEventListener('scroll', hideTooltip, { passive: true });
    global.addEventListener('resize', hideTooltip, { passive: true });
  }

  TaskFlow.AnalyticsUI = {
    init: init,
    renderTodaySummary: renderTodaySummary,
    renderDashboard: renderDashboard
  };
})(typeof window !== 'undefined' ? window : globalThis);
