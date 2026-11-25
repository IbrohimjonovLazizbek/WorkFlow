(function (global) {
  'use strict';

  var TaskFlow = (global.TaskFlow = global.TaskFlow || {});

  var PRIORITIES = [
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' }
  ];

  var CATEGORIES = [
    { value: 'work', label: 'Work' },
    { value: 'health', label: 'Health' },
    { value: 'learning', label: 'Learning' },
    { value: 'personal', label: 'Personal' },
    { value: 'admin', label: 'Admin' }
  ];

  var TIME_BLOCKS = [
    { value: 'morning', label: 'Morning' },
    { value: 'afternoon', label: 'Afternoon' },
    { value: 'evening', label: 'Evening' },
    { value: 'anytime', label: 'Anytime' }
  ];

  var ESTIMATE_PRESETS = [15, 30, 45, 60, 90];

  var STATUS_META = {
    todo: { label: 'Todo', next: 'in_progress' },
    in_progress: { label: 'In Progress', next: 'done' },
    done: { label: 'Done', next: 'todo' }
  };

  var WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var uiState = {
    initialized: false,
    openDrawerId: null,
    commentModalTaskId: null,
    editingTaskId: null,
    dragTaskId: null,
    dismissedRolloverDate: null,
    rolloverReviewOpen: false,
    quickAdd: {
      priority: 'medium',
      category: 'work',
      timeBlock: 'morning',
      scheduledTime: '',
      estimatedMinutes: 30
    }
  };

  function getStore() {
    return TaskFlow.Store;
  }

  function getUtils() {
    return TaskFlow.Utils;
  }

  function getTimer() {
    return TaskFlow.Timer || null;
  }

  function getApp() {
    return TaskFlow.App || null;
  }

  function esc(str) {
    return getUtils().escapeHtml(str == null ? '' : String(str));
  }

  function parseLocalDate(dateStr) {
    var parts = String(dateStr || '').split('-');
    if (parts.length !== 3) {
      return new Date();
    }
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0);
  }

  function formatShortChip(dateStr) {
    var d = parseLocalDate(dateStr);
    return {
      weekday: WEEKDAY_SHORT[d.getDay()],
      dayNum: d.getDate(),
      month: MONTH_SHORT[d.getMonth()]
    };
  }

  function getMondayOfWeek(dateStr) {
    var d = parseLocalDate(dateStr);
    var day = d.getDay();
    var offset = (day + 6) % 7;
    return getUtils().addDays(dateStr, -offset);
  }

  function announce(msg) {
    var app = getApp();
    if (app && typeof app.announce === 'function') {
      app.announce(msg);
      return;
    }
    var el = document.getElementById('sr-announcer');
    if (el) {
      el.textContent = '';
      setTimeout(function () {
        el.textContent = msg;
      }, 20);
    }
  }

  function notifyToast(msg, options) {
    var app = getApp();
    if (app && typeof app.showToast === 'function') {
      app.showToast(msg, options || {});
    }
  }

  function triggerChime(kind) {
    var timer = getTimer();
    if (timer && typeof timer.playChime === 'function') {
      timer.playChime(kind || 'check');
    }
  }

  function labelFor(list, value) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].value === value) {
        return list[i].label;
      }
    }
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
  }

  function buildOptionsHtml(list, selectedValue) {
    return list
      .map(function (item) {
        var sel = item.value === selectedValue ? ' selected' : '';
        return '<option value="' + esc(item.value) + '"' + sel + '>' + esc(item.label) + '</option>';
      })
      .join('');
  }

  function parseQuickAddShorthand(rawTitle) {
    var title = String(rawTitle || '').trim();
    var extracted = {};
    var tokenRegex = /(^|\s)(![a-z]+|#[a-z]+|@[a-z]+|~\d+m)(?=\s|$)/gi;
    var cleaned = title.replace(tokenRegex, function (match, prefix, token) {
      var low = token.toLowerCase();
      if (low === '!high' || low === '!h') {
        extracted.priority = 'high';
        return '';
      }
      if (low === '!medium' || low === '!med' || low === '!m') {
        extracted.priority = 'medium';
        return '';
      }
      if (low === '!low' || low === '!l') {
        extracted.priority = 'low';
        return '';
      }
      if (low.charAt(0) === '#') {
        var cat = low.slice(1);
        for (var i = 0; i < CATEGORIES.length; i++) {
          if (CATEGORIES[i].value === cat) {
            extracted.category = cat;
            return '';
          }
        }
      }
      if (low.charAt(0) === '@') {
        var blk = low.slice(1);
        for (var j = 0; j < TIME_BLOCKS.length; j++) {
          if (TIME_BLOCKS[j].value === blk) {
            extracted.timeBlock = blk;
            return '';
          }
        }
      }
      if (low.charAt(0) === '~' && low.slice(-1) === 'm') {
        var mins = parseInt(low.slice(1, -1), 10);
        if (mins > 0 && mins <= 480) {
          extracted.estimatedMinutes = mins;
          return '';
        }
      }
      return match;
    });

    cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
    return {
      title: cleaned || title,
      extracted: extracted
    };
  }

  function getActiveRoutineApplyCount(dateStr) {
    var store = getStore();
    var state = store.getState();
    var routines = state.routines || [];
    var dayTasks = store.getTasksForDate(dateStr);
    var appliedIds = {};
    for (var i = 0; i < dayTasks.length; i++) {
      if (dayTasks[i].routineId) {
        appliedIds[dayTasks[i].routineId] = true;
      }
    }
    var d = parseLocalDate(dateStr).getDay();
    var isWeekday = d >= 1 && d <= 5;
    var count = 0;
    for (var j = 0; j < routines.length; j++) {
      var r = routines[j];
      if (!r.active || appliedIds[r.id]) {
        continue;
      }
      if (r.schedule === 'weekdays' && !isWeekday) {
        continue;
      }
      count++;
    }
    return count;
  }

  function isElementInside(el, container) {
    return Boolean(el && container && (el === container || container.contains(el)));
  }

  function isFocusedTask(taskId) {
    var timer = getTimer();
    if (!timer || typeof timer.getState !== 'function') {
      return false;
    }
    var ts = timer.getState();
    var activeId = ts.attachedTaskId || ts.taskId || null;
    return activeId === taskId;
  }

  function isTimerRunningFor(taskId) {
    var timer = getTimer();
    if (!timer || typeof timer.getState !== 'function') {
      return false;
    }
    var ts = timer.getState();
    var activeId = ts.attachedTaskId || ts.taskId || null;
    return activeId === taskId && Boolean(ts.running || ts.isRunning);
  }

  function renderDateStrip() {
    var container = document.getElementById('today-date-strip');
    if (!container) {
      return;
    }
    var store = getStore();
    var utils = getUtils();
    var state = store.getState();
    var selectedDate = state.selectedDate || utils.todayKey();
    var today = utils.todayKey();
    var monday = getMondayOfWeek(selectedDate);

    var chipsHtml = '';
    for (var i = 0; i < 7; i++) {
      var dateStr = utils.addDays(monday, i);
      var info = formatShortChip(dateStr);
      var dayTasks = store.getTasksForDate(dateStr);
      var openCount = 0;
      var doneCount = 0;
      for (var t = 0; t < dayTasks.length; t++) {
        if (dayTasks[t].status === 'done') {
          doneCount++;
        } else {
          openCount++;
        }
      }
      var classes = ['date-chip'];
      if (dateStr === selectedDate) {
        classes.push('active');
      }
      if (dateStr === today) {
        classes.push('is-today');
      }
      var dotHtml = '';
      if (dayTasks.length > 0) {
        var dotTitle = openCount + ' remaining, ' + doneCount + ' done';
        dotHtml =
          '<span class="date-chip-dots" title="' + esc(dotTitle) + '">' +
          (openCount > 0 ? '<span class="date-chip-dot"></span>' : '<span class="date-chip-dot is-done"></span>') +
          '<span class="date-chip-count">' + dayTasks.length + '</span>' +
          '</span>';
      } else {
        dotHtml = '<span class="date-chip-dots" aria-hidden="true"></span>';
      }

      chipsHtml +=
        '<button type="button" class="' + classes.join(' ') + '" data-action="select-date" data-date="' + esc(dateStr) + '" aria-pressed="' + (dateStr === selectedDate ? 'true' : 'false') + '" aria-label="' + esc(utils.formatDateLabel(dateStr)) + '">' +
          '<span class="date-chip-day">' + esc(info.weekday) + '</span>' +
          '<span class="date-chip-num">' + info.dayNum + '</span>' +
          dotHtml +
        '</button>';
    }

    var jumpTodayBtn = selectedDate !== today
      ? '<button type="button" class="btn btn-sm btn-secondary date-today-btn" data-action="jump-today">Today</button>'
      : '';

    container.innerHTML =
      '<div class="date-strip">' +
        '<button type="button" class="date-nav-btn btn btn-icon btn-ghost" data-action="prev-week" aria-label="Previous week" title="Previous week">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>' +
        '</button>' +
        '<div class="date-strip-days" role="group" aria-label="Week days">' + chipsHtml + '</div>' +
        '<button type="button" class="date-nav-btn btn btn-icon btn-ghost" data-action="next-week" aria-label="Next week" title="Next week">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>' +
        '</button>' +
        '<div class="date-strip-actions">' +
          jumpTodayBtn +
          '<input type="date" class="date-picker-input" data-action="pick-date" value="' + esc(selectedDate) + '" aria-label="Jump to date">' +
        '</div>' +
      '</div>';
  }

  function renderRolloverBanner() {
    var container = document.getElementById('rollover-banner');
    if (!container) {
      return;
    }
    var store = getStore();
    var utils = getUtils();
    var today = utils.todayKey();
    var selectedDate = store.getState().selectedDate || today;

    if (selectedDate !== today || uiState.dismissedRolloverDate === today) {
      container.innerHTML = '';
      container.hidden = true;
      return;
    }

    var rolloverTasks = typeof store.getRolloverTasks === 'function' ? store.getRolloverTasks(today) : [];
    if (!rolloverTasks || rolloverTasks.length === 0) {
      container.innerHTML = '';
      container.hidden = true;
      return;
    }

    container.hidden = false;
    var count = rolloverTasks.length;
    var noun = count === 1 ? 'unfinished task' : 'unfinished tasks';

    var reviewHtml = '';
    if (uiState.rolloverReviewOpen) {
      var rows = rolloverTasks
        .map(function (t) {
          return (
            '<div class="rollover-review-item" data-task-id="' + esc(t.id) + '">' +
              '<div class="rollover-review-main">' +
                '<span class="priority-badge" data-priority="' + esc(t.priority) + '">' + esc(labelFor(PRIORITIES, t.priority)) + '</span>' +
                '<span class="rollover-review-title">' + esc(t.title) + '</span>' +
                '<span class="rollover-review-date">' + esc(utils.formatDateLabel(t.date)) + '</span>' +
              '</div>' +
              '<div class="rollover-review-actions">' +
                '<button type="button" class="btn btn-xs btn-secondary" data-action="rollover-one" data-task-id="' + esc(t.id) + '">Move to Today</button>' +
                '<button type="button" class="btn btn-xs btn-ghost" data-action="rollover-done" data-task-id="' + esc(t.id) + '">Mark Done</button>' +
                '<button type="button" class="btn btn-xs btn-ghost" data-action="open-drawer" data-task-id="' + esc(t.id) + '">Edit</button>' +
              '</div>' +
            '</div>'
          );
        })
        .join('');
      reviewHtml = '<div class="rollover-review-list">' + rows + '</div>';
    }

    container.innerHTML =
      '<div class="rollover-banner" role="region" aria-label="Unfinished tasks from previous days">' +
        '<div class="rollover-banner-main">' +
          '<div class="rollover-banner-info">' +
            '<span class="rollover-icon" aria-hidden="true">' +
              '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>' +
            '</span>' +
            '<div>' +
              '<strong>' + count + ' ' + noun + '</strong> from previous days' +
              '<span class="rollover-sub">Carry them forward into today\'s plan or review individually.</span>' +
            '</div>' +
          '</div>' +
          '<div class="rollover-banner-actions">' +
            '<button type="button" class="btn btn-primary btn-sm" data-action="rollover-all">Move all to Today</button>' +
            '<button type="button" class="btn btn-secondary btn-sm" data-action="toggle-rollover-review">' + (uiState.rolloverReviewOpen ? 'Hide list' : 'Review') + '</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-action="dismiss-rollover" aria-label="Dismiss rollover banner">Dismiss</button>' +
          '</div>' +
        '</div>' +
        reviewHtml +
      '</div>';
  }

  function renderQuickAdd() {
    var container = document.getElementById('quick-add-container');
    if (!container) {
      return;
    }

    var utils = getUtils();
    var selectedDate = getStore().getState().selectedDate || utils.todayKey();
    var dateLabel = selectedDate === utils.todayKey() ? 'Today' : utils.formatDateLabel(selectedDate);

    var existingForm = container.querySelector('#quick-add-form');
    if (existingForm) {
      var existingInput = container.querySelector('#quick-add-title');
      var dateHintEl = container.querySelector('#quick-add-date-label');
      if (existingInput) {
        existingInput.placeholder = 'Add a task for ' + dateLabel + '... (Enter to add, or use !high #work ~30m)';
      }
      if (dateHintEl) {
        dateHintEl.textContent = dateLabel;
      }
      return;
    }

    var qa = uiState.quickAdd;
    var estOptions = '<option value="0">No est</option>' +
      ESTIMATE_PRESETS.map(function (m) {
        var sel = qa.estimatedMinutes === m ? ' selected' : '';
        return '<option value="' + m + '"' + sel + '>' + m + 'm</option>';
      }).join('');

    container.innerHTML =
      '<form id="quick-add-form" class="quick-add-card" autocomplete="off">' +
        '<div class="quick-add-row">' +
          '<span class="quick-add-plus" aria-hidden="true">+</span>' +
          '<input type="text" id="quick-add-title" class="quick-add-input" placeholder="' + esc('Add a task for ' + dateLabel + '... (Enter to add, or use !high #work ~30m)') + '" aria-label="New task title">' +
          '<div class="quick-add-submit-group">' +
            '<button type="submit" class="btn btn-primary btn-sm" data-action="quick-add-submit">Add Task</button>' +
            '<button type="button" class="btn btn-secondary btn-sm" data-action="quick-add-details" title="Create task and open detail drawer">Add &amp; Details</button>' +
          '</div>' +
        '</div>' +
        '<div class="quick-add-controls">' +
          '<label class="quick-add-field">' +
            '<span class="sr-only">Priority</span>' +
            '<select id="qa-priority" class="chip-select" aria-label="Priority">' + buildOptionsHtml(PRIORITIES, qa.priority) + '</select>' +
          '</label>' +
          '<label class="quick-add-field">' +
            '<span class="sr-only">Category</span>' +
            '<select id="qa-category" class="chip-select" aria-label="Category">' + buildOptionsHtml(CATEGORIES, qa.category) + '</select>' +
          '</label>' +
          '<label class="quick-add-field">' +
            '<span class="sr-only">Time block</span>' +
            '<select id="qa-timeblock" class="chip-select" aria-label="Time block">' + buildOptionsHtml(TIME_BLOCKS, qa.timeBlock) + '</select>' +
          '</label>' +
          '<label class="quick-add-field">' +
            '<span class="sr-only">Scheduled time</span>' +
            '<input type="time" id="qa-time" class="chip-select" value="' + esc(qa.scheduledTime) + '" aria-label="Scheduled time" title="Scheduled time">' +
          '</label>' +
          '<label class="quick-add-field">' +
            '<span class="sr-only">Estimated minutes</span>' +
            '<select id="qa-estimate" class="chip-select" aria-label="Estimated duration">' + estOptions + '</select>' +
          '</label>' +
          '<span class="quick-add-hint">For <strong id="quick-add-date-label">' + esc(dateLabel) + '</strong> • Tip: paste lines to batch add</span>' +
        '</div>' +
      '</form>';
  }

  function renderFiltersToolbar() {
    var container = document.getElementById('task-filters-container');
    if (!container) {
      return;
    }
    var store = getStore();
    var state = store.getState();
    var selectedDate = state.selectedDate || getUtils().todayKey();
    var filters = state.filters || {};
    var dayTasks = store.getTasksForDate(selectedDate);

    var counts = { all: dayTasks.length, active: 0, in_progress: 0, done: 0 };
    for (var i = 0; i < dayTasks.length; i++) {
      var st = dayTasks[i].status;
      if (st === 'done') {
        counts.done++;
      } else {
        counts.active++;
        if (st === 'in_progress') {
          counts.in_progress++;
        }
      }
    }

    var currentStatus = filters.status || 'all';
    var statusTabs = [
      { value: 'all', label: 'All', count: counts.all },
      { value: 'active', label: 'Active', count: counts.active },
      { value: 'in_progress', label: 'In Progress', count: counts.in_progress },
      { value: 'done', label: 'Done', count: counts.done }
    ];

    var tabsHtml = statusTabs
      .map(function (tab) {
        var active = currentStatus === tab.value ? ' active' : '';
        return (
          '<button type="button" class="segmented-tab' + active + '" data-action="filter-status" data-status="' + esc(tab.value) + '" aria-pressed="' + (active ? 'true' : 'false') + '">' +
            esc(tab.label) + ' <span class="tab-count">' + tab.count + '</span>' +
          '</button>'
        );
      })
      .join('');

    var currentCat = filters.category || 'all';
    var catChips = [{ value: 'all', label: 'All' }].concat(CATEGORIES)
      .map(function (c) {
        var active = currentCat === c.value ? ' active' : '';
        return (
          '<button type="button" class="filter-chip' + active + '" data-action="filter-category" data-category="' + esc(c.value) + '" aria-pressed="' + (active ? 'true' : 'false') + '">' +
            esc(c.label) +
          '</button>'
        );
      })
      .join('');

    var currentPrio = filters.priority || 'all';
    var prioOptions = [{ value: 'all', label: 'All Priorities' }].concat(PRIORITIES);

    var currentSort = filters.sort || 'manual';
    var sortOptions = [
      { value: 'manual', label: 'Manual Order' },
      { value: 'priority', label: 'Priority' },
      { value: 'time', label: 'Scheduled Time' },
      { value: 'duration', label: 'Duration' }
    ];

    var clearCompletedBtn = counts.done > 0
      ? '<button type="button" class="btn btn-ghost btn-sm" data-action="clear-completed">Clear Completed (' + counts.done + ')</button>'
      : '';

    var searchBadge = filters.search
      ? '<button type="button" class="filter-chip active" data-action="clear-search" title="Clear search filter">Search: "' + esc(filters.search) + '" ×</button>'
      : '';

    container.innerHTML =
      '<div class="filter-toolbar">' +
        '<div class="filter-toolbar-top">' +
          '<div class="segmented-tabs" role="tablist" aria-label="Task status filter">' + tabsHtml + '</div>' +
          '<div class="filter-toolbar-right">' +
            '<select class="sort-select" data-action="filter-priority" aria-label="Filter by priority">' + buildOptionsHtml(prioOptions, currentPrio) + '</select>' +
            '<select class="sort-select" data-action="filter-sort" aria-label="Sort tasks">' + buildOptionsHtml(sortOptions, currentSort) + '</select>' +
            clearCompletedBtn +
          '</div>' +
        '</div>' +
        '<div class="filter-chips" role="group" aria-label="Category filter">' +
          catChips +
          searchBadge +
        '</div>' +
      '</div>';
  }

  function renderTaskCardHtml(task, index, groupLen, allowReorder) {
    var utils = getUtils();
    var isDone = task.status === 'done';
    var isEditing = uiState.editingTaskId === task.id;
    var isFocused = isFocusedTask(task.id);
    var isRunning = isTimerRunningFor(task.id);

    var cardClasses = ['task-card'];
    if (isDone) {
      cardClasses.push('is-completed');
    }
    if (task.status === 'in_progress') {
      cardClasses.push('is-in-progress');
    }
    if (isFocused) {
      cardClasses.push('is-focused');
    }

    var subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
    var subDone = 0;
    for (var i = 0; i < subtasks.length; i++) {
      if (subtasks[i].done) {
        subDone++;
      }
    }

    var titleHtml = isEditing
      ? '<input type="text" class="task-inline-input" data-task-id="' + esc(task.id) + '" value="' + esc(task.title) + '" aria-label="Edit task title">'
      : '<span class="task-title" data-action="inline-edit" title="Double-click to rename">' + esc(task.title) + '</span>';

    var noteIcon = task.notes && task.notes.trim()
      ? '<span class="task-note-indicator" title="' + esc(task.notes.slice(0, 120)) + '" aria-label="Has notes">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' +
        '</span>'
      : '';

    var statusMeta = STATUS_META[task.status] || STATUS_META.todo;
    var statusBadge =
      '<button type="button" class="status-badge" data-status="' + esc(task.status) + '" data-action="cycle-status" title="Click to cycle status">' +
        esc(statusMeta.label) +
      '</button>';

    var priorityBadge =
      '<span class="priority-badge" data-priority="' + esc(task.priority) + '">' +
        esc(labelFor(PRIORITIES, task.priority)) +
      '</span>';

    var categoryBadge =
      '<span class="category-badge" data-category="' + esc(task.category) + '">' +
        esc(labelFor(CATEGORIES, task.category)) +
      '</span>';

    var timeParts = [];
    if (task.scheduledTime) {
      timeParts.push(task.scheduledTime);
    }
    if (task.actualMinutes > 0 && task.estimatedMinutes > 0) {
      timeParts.push(utils.formatMinutes(task.actualMinutes) + ' / ' + utils.formatMinutes(task.estimatedMinutes));
    } else if (task.estimatedMinutes > 0) {
      timeParts.push(utils.formatMinutes(task.estimatedMinutes));
    } else if (task.actualMinutes > 0) {
      timeParts.push(utils.formatMinutes(task.actualMinutes) + ' logged');
    }

    var timeBadge = timeParts.length > 0
      ? '<span class="time-badge">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
          ' ' + esc(timeParts.join(' • ')) +
        '</span>'
      : '';

    var subPct = subtasks.length > 0 ? Math.round((subDone / subtasks.length) * 100) : 0;
    var subtaskBadge = subtasks.length > 0
      ? '<span class="subtask-progress" title="' + subDone + ' of ' + subtasks.length + ' subtasks complete">' +
          '<span class="subtask-progress-bar"><span class="subtask-progress-fill" style="width:' + subPct + '%"></span></span>' +
          '<span>' + subDone + '/' + subtasks.length + '</span>' +
        '</span>'
      : '';

    var routineTag = task.routineId
      ? '<span class="time-badge routine-origin-badge" title="Created from daily routine">Routine</span>'
      : '';

    var moveBtns = allowReorder
      ? '<button type="button" class="btn btn-icon btn-ghost btn-sm" data-action="move-up" title="Move up" aria-label="Move task up"' + (index === 0 ? ' disabled' : '') + '>' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>' +
        '</button>' +
        '<button type="button" class="btn btn-icon btn-ghost btn-sm" data-action="move-down" title="Move down" aria-label="Move task down"' + (index === groupLen - 1 ? ' disabled' : '') + '>' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>' +
        '</button>'
      : '';

    var dragHandle = allowReorder
      ? '<span class="drag-handle" title="Drag to reorder" aria-hidden="true">⋮⋮</span>'
      : '';

    var focusLabel = isRunning ? 'Pause Focus' : 'Start Focus';

    var commentHtml = task.completionComment && task.completionComment.trim()
      ? '<div class="task-completion-comment" title="' + esc(task.completionComment.slice(0, 200)) + '">' +
          '<span class="task-comment-icon" aria-hidden="true">💬</span>' +
          '<span class="task-comment-text">' + esc(task.completionComment.trim()) + '</span>' +
        '</div>'
      : '';

    return (
      '<div class="' + cardClasses.join(' ') + '" data-task-id="' + esc(task.id) + '" draggable="' + (allowReorder ? 'true' : 'false') + '">' +
        dragHandle +
        '<button type="button" class="task-check-btn" data-action="toggle-done" aria-label="' + (isDone ? 'Mark as not done' : 'Mark as done') + '" aria-pressed="' + (isDone ? 'true' : 'false') + '">' +
          '<svg class="task-check-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
            '<circle class="task-check-circle" cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>' +
            '<path class="task-check-mark" d="M8 12.5l2.8 2.8L16.5 9.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg>' +
        '</button>' +
        '<div class="task-main">' +
          '<div class="task-title-row">' +
            titleHtml +
            noteIcon +
          '</div>' +
          '<div class="task-meta">' +
            statusBadge +
            priorityBadge +
            categoryBadge +
            timeBadge +
            subtaskBadge +
            routineTag +
          '</div>' +
          commentHtml +
        '</div>' +
        '<div class="task-actions">' +
          '<button type="button" class="btn btn-icon btn-ghost btn-sm' + (isRunning ? ' is-active' : '') + '" data-action="focus-task" title="' + esc(focusLabel) + '" aria-label="' + esc(focusLabel) + '">' +
            (isRunning
              ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
              : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>') +
          '</button>' +
          moveBtns +
          '<button type="button" class="btn btn-icon btn-ghost btn-sm" data-action="duplicate-task" title="Duplicate task" aria-label="Duplicate task">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
          '</button>' +
          '<button type="button" class="btn btn-icon btn-ghost btn-sm" data-action="open-drawer" title="Open details" aria-label="Open task details">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
          '</button>' +
          '<button type="button" class="btn btn-icon btn-ghost btn-sm btn-danger-ghost" data-action="delete-task" title="Delete task" aria-label="Delete task">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>'
    );
  }

  function renderTaskList() {
    var container = document.getElementById('task-list-container');
    if (!container) {
      return;
    }
    var store = getStore();
    var utils = getUtils();
    var state = store.getState();
    var selectedDate = state.selectedDate || utils.todayKey();
    var filters = state.filters || {};
    var allDayTasks = store.getTasksForDate(selectedDate);
    var filteredTasks = store.getFilteredTasksForDate(selectedDate);

    if (allDayTasks.length === 0) {
      var routinePending = getActiveRoutineApplyCount(selectedDate);
      var routineBtn = routinePending > 0
        ? '<button type="button" class="btn btn-secondary btn-sm" data-action="apply-routines-empty">Apply Daily Routines (+' + routinePending + ')</button>'
        : '';
      var dateDesc = selectedDate === utils.todayKey() ? 'today' : utils.formatDateLabel(selectedDate);

      container.innerHTML =
        '<div class="empty-state">' +
          '<div class="empty-state-icon" aria-hidden="true">' +
            '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>' +
          '</div>' +
          '<h3 class="empty-state-title">No tasks planned for ' + esc(dateDesc) + ' yet</h3>' +
          '<p class="empty-state-desc">Add your first task above or pull in your active daily routines to get started.</p>' +
          '<div class="empty-state-actions">' +
            '<button type="button" class="btn btn-primary btn-sm" data-action="focus-quick-add">Add First Task</button>' +
            routineBtn +
          '</div>' +
        '</div>';
      return;
    }

    if (filteredTasks.length === 0) {
      var showCompletedHint = !state.settings.showCompleted && (filters.status || 'all') === 'all';
      var showCompletedBtn = showCompletedHint
        ? '<button type="button" class="btn btn-primary btn-sm" data-action="show-completed">Show Completed Tasks</button>'
        : '';
      container.innerHTML =
        '<div class="empty-state">' +
          '<div class="empty-state-icon" aria-hidden="true">' +
            '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
          '</div>' +
          '<h3 class="empty-state-title">No tasks match current filters</h3>' +
          '<p class="empty-state-desc">' + (showCompletedHint ? 'Completed tasks are currently hidden in Workspace Settings, or another filter is active.' : 'Try clearing one or more status, category, priority, or search filters.') + '</p>' +
          '<div class="empty-state-actions">' +
            showCompletedBtn +
            '<button type="button" class="btn btn-secondary btn-sm" data-action="reset-filters">Clear Filters</button>' +
          '</div>' +
        '</div>';
      return;
    }

    var sortMode = filters.sort || 'manual';
    var html = '';

    if (sortMode === 'manual') {
      var grouped = { morning: [], afternoon: [], evening: [], anytime: [] };
      for (var i = 0; i < filteredTasks.length; i++) {
        var blk = filteredTasks[i].timeBlock || 'anytime';
        if (!grouped[blk]) {
          blk = 'anytime';
        }
        grouped[blk].push(filteredTasks[i]);
      }

      for (var b = 0; b < TIME_BLOCKS.length; b++) {
        var block = TIME_BLOCKS[b];
        var list = grouped[block.value];
        if (!list || list.length === 0) {
          continue;
        }
        var blockMins = 0;
        var blockDone = 0;
        for (var j = 0; j < list.length; j++) {
          blockMins += Number(list[j].estimatedMinutes || 0);
          if (list[j].status === 'done') {
            blockDone++;
          }
        }
        var cards = list
          .map(function (t, idx) {
            return renderTaskCardHtml(t, idx, list.length, true);
          })
          .join('');
        var minsBadge = blockMins > 0 ? ' • ' + utils.formatMinutes(blockMins) : '';

        html +=
          '<section class="task-group" data-time-block="' + esc(block.value) + '">' +
            '<header class="task-group-header">' +
              '<span class="task-group-title">' + esc(block.label) + '</span>' +
              '<span class="task-group-meta">' + blockDone + '/' + list.length + esc(minsBadge) + '</span>' +
            '</header>' +
            '<div class="task-list">' + cards + '</div>' +
          '</section>';
      }
    } else {
      var sortLabels = {
        priority: 'Sorted by Priority',
        time: 'Sorted by Scheduled Time',
        duration: 'Sorted by Duration'
      };
      var flatCards = filteredTasks
        .map(function (t, idx) {
          return renderTaskCardHtml(t, idx, filteredTasks.length, false);
        })
        .join('');
      html =
        '<section class="task-group">' +
          '<header class="task-group-header">' +
            '<span class="task-group-title">' + esc(sortLabels[sortMode] || 'Tasks') + '</span>' +
            '<span class="task-group-meta">' + filteredTasks.length + ' tasks</span>' +
          '</header>' +
          '<div class="task-list">' + flatCards + '</div>' +
        '</section>';
    }

    container.innerHTML = html;

    if (uiState.editingTaskId) {
      var inlineInput = container.querySelector('.task-inline-input');
      if (inlineInput) {
        inlineInput.focus();
        inlineInput.select();
      }
    }
  }

  function renderDrawer(force) {
    var drawer = document.getElementById('task-drawer');
    var body = document.getElementById('task-drawer-body');
    if (!drawer || !body) {
      return;
    }
    if (!uiState.openDrawerId) {
      return;
    }

    var store = getStore();
    var utils = getUtils();
    var tasks = store.getState().tasks || [];
    var task = null;
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === uiState.openDrawerId) {
        task = tasks[i];
        break;
      }
    }

    if (!task) {
      closeDrawer();
      return;
    }

    if (!force && isElementInside(document.activeElement, body)) {
      var activeMinutesEl = body.querySelector('#drawer-actual-minutes');
      if (activeMinutesEl && document.activeElement !== activeMinutesEl) {
        activeMinutesEl.value = String(task.actualMinutes || 0);
      }
      return;
    }

    var subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
    var subDone = 0;
    for (var s = 0; s < subtasks.length; s++) {
      if (subtasks[s].done) {
        subDone++;
      }
    }
    var subPct = subtasks.length > 0 ? Math.round((subDone / subtasks.length) * 100) : 0;

    var subtasksHtml = subtasks.length > 0
      ? subtasks
          .map(function (st) {
            return (
              '<li class="subtask-item' + (st.done ? ' done' : '') + '" data-subtask-id="' + esc(st.id) + '">' +
                '<label class="subtask-label">' +
                  '<input type="checkbox" class="subtask-checkbox" data-action="toggle-subtask"' + (st.done ? ' checked' : '') + '>' +
                  '<span class="subtask-title">' + esc(st.title) + '</span>' +
                '</label>' +
                '<button type="button" class="btn btn-icon btn-ghost btn-sm" data-action="delete-subtask" aria-label="Delete subtask" title="Delete subtask">×</button>' +
              '</li>'
            );
          })
          .join('')
      : '<li class="subtask-empty">No subtasks yet. Break this task into smaller steps below.</li>';

    var presetBtns = ESTIMATE_PRESETS.map(function (m) {
      var active = Number(task.estimatedMinutes) === m ? ' active' : '';
      return '<button type="button" class="filter-chip' + active + '" data-action="drawer-preset-est" data-minutes="' + m + '">' + m + 'm</button>';
    }).join('');

    var running = isTimerRunningFor(task.id);
    var statusOptions = [
      { value: 'todo', label: 'Todo' },
      { value: 'in_progress', label: 'In Progress' },
      { value: 'done', label: 'Done' }
    ];

    body.innerHTML =
      '<div class="drawer-header">' +
        '<div class="drawer-header-meta">' +
          '<span class="priority-badge" data-priority="' + esc(task.priority) + '">' + esc(labelFor(PRIORITIES, task.priority)) + '</span>' +
          '<span class="drawer-date-tag">' + esc(utils.formatDateLabel(task.date)) + '</span>' +
        '</div>' +
        '<button type="button" class="btn btn-icon btn-ghost" data-action="close-drawer" aria-label="Close details drawer">✕</button>' +
      '</div>' +
      '<div class="drawer-body">' +
        '<div class="form-group">' +
          '<label class="form-label" for="drawer-title">Task Title</label>' +
          '<input type="text" id="drawer-title" class="form-input" data-field="title" value="' + esc(task.title) + '">' +
        '</div>' +
        '<div class="drawer-grid-2">' +
          '<div class="form-group">' +
            '<label class="form-label" for="drawer-status">Status</label>' +
            '<select id="drawer-status" class="form-select" data-field="status">' + buildOptionsHtml(statusOptions, task.status) + '</select>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="drawer-priority">Priority</label>' +
            '<select id="drawer-priority" class="form-select" data-field="priority">' + buildOptionsHtml(PRIORITIES, task.priority) + '</select>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="drawer-category">Category</label>' +
            '<select id="drawer-category" class="form-select" data-field="category">' + buildOptionsHtml(CATEGORIES, task.category) + '</select>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="drawer-date">Date</label>' +
            '<input type="date" id="drawer-date" class="form-input" data-field="date" value="' + esc(task.date) + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="drawer-timeblock">Time Block</label>' +
            '<select id="drawer-timeblock" class="form-select" data-field="timeBlock">' + buildOptionsHtml(TIME_BLOCKS, task.timeBlock) + '</select>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="drawer-scheduled-time">Scheduled Time</label>' +
            '<input type="time" id="drawer-scheduled-time" class="form-input" data-field="scheduledTime" value="' + esc(task.scheduledTime || '') + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="drawer-estimated-minutes">Estimated (mins)</label>' +
            '<input type="number" id="drawer-estimated-minutes" class="form-input" data-field="estimatedMinutes" min="0" max="480" step="5" value="' + esc(task.estimatedMinutes || 0) + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="drawer-actual-minutes">Focus Logged (mins)</label>' +
            '<input type="number" id="drawer-actual-minutes" class="form-input" data-field="actualMinutes" min="0" max="1440" step="1" value="' + esc(task.actualMinutes || 0) + '">' +
          '</div>' +
        '</div>' +
        '<div class="form-group drawer-presets">' + presetBtns + '</div>' +
        '<div class="form-group">' +
          '<div class="drawer-subtasks-header">' +
            '<label class="form-label">Subtasks (' + subDone + '/' + subtasks.length + ')</label>' +
            '<span class="subtask-pct">' + subPct + '%</span>' +
          '</div>' +
          '<div class="subtask-bar-track"><div class="subtask-bar-fill" style="width:' + subPct + '%"></div></div>' +
          '<ul class="subtask-list">' + subtasksHtml + '</ul>' +
          '<form class="subtask-add-form" data-action="add-subtask-form">' +
            '<input type="text" id="drawer-new-subtask" class="form-input" placeholder="Add a subtask and press Enter..." aria-label="New subtask">' +
            '<button type="submit" class="btn btn-secondary btn-sm">Add</button>' +
          '</form>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="drawer-notes">Notes</label>' +
          '<textarea id="drawer-notes" class="form-textarea" rows="4" data-field="notes" placeholder="Context, links, acceptance criteria...">' + esc(task.notes || '') + '</textarea>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="drawer-completion-comment">Completion Comment</label>' +
          '<textarea id="drawer-completion-comment" class="form-textarea" rows="3" maxlength="2000" data-field="completionComment" placeholder="Outcome, link, or wrap-up note when marked done...">' + esc(task.completionComment || '') + '</textarea>' +
        '</div>' +
      '</div>' +
      '<div class="drawer-footer">' +
        '<button type="button" class="btn btn-primary btn-sm" data-action="drawer-focus">' + (running ? 'Pause Focus' : 'Focus on this task') + '</button>' +
        '<button type="button" class="btn btn-secondary btn-sm" data-action="drawer-duplicate">Duplicate</button>' +
        '<button type="button" class="btn btn-secondary btn-sm" data-action="drawer-move-tomorrow">Move to Tomorrow</button>' +
        '<button type="button" class="btn btn-danger btn-sm" data-action="drawer-delete">Delete</button>' +
      '</div>';
  }

  function renderUpcomingView() {
    var container = document.getElementById('view-upcoming');
    if (!container || container.hidden) {
      return;
    }

    var focusedDate = null;
    var focusedVal = '';
    var selStart = null;
    var selEnd = null;
    if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('upcoming-add-input') && container.contains(document.activeElement)) {
      var activeForm = document.activeElement.closest('[data-date]');
      if (activeForm) {
        focusedDate = activeForm.getAttribute('data-date');
        focusedVal = document.activeElement.value;
        selStart = document.activeElement.selectionStart;
        selEnd = document.activeElement.selectionEnd;
      }
    }

    var store = getStore();
    var utils = getUtils();
    var today = utils.todayKey();
    var rolloverTasks = typeof store.getRolloverTasks === 'function' ? store.getRolloverTasks(today) : [];

    var overdueHtml = '';
    if (rolloverTasks.length > 0) {
      var overdueItems = rolloverTasks
        .map(function (t) {
          return (
            '<div class="upcoming-overdue-item" data-task-id="' + esc(t.id) + '">' +
              '<button type="button" class="task-check-btn" data-action="toggle-done" aria-label="Mark task as done">' +
                '<svg class="task-check-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
                  '<circle class="task-check-circle" cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>' +
                  '<path class="task-check-mark" d="M8 12.5l2.8 2.8L16.5 9.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
                '</svg>' +
              '</button>' +
              '<button type="button" class="upcoming-task-link" data-action="open-drawer">' + esc(t.title) + '</button>' +
              '<span class="priority-badge" data-priority="' + esc(t.priority) + '">' + esc(labelFor(PRIORITIES, t.priority)) + '</span>' +
              '<span class="time-badge">' + esc(utils.formatDateLabel(t.date)) + '</span>' +
              '<button type="button" class="btn btn-xs btn-secondary" data-action="rollover-one" data-task-id="' + esc(t.id) + '">Move to Today</button>' +
            '</div>'
          );
        })
        .join('');

      overdueHtml =
        '<section class="upcoming-overdue-card">' +
          '<header class="upcoming-overdue-header">' +
            '<div>' +
              '<h3>Overdue &amp; Earlier Unfinished (' + rolloverTasks.length + ')</h3>' +
              '<p>Tasks scheduled before today that are still open.</p>' +
            '</div>' +
            '<button type="button" class="btn btn-primary btn-sm" data-action="rollover-all">Move all to Today</button>' +
          '</header>' +
          '<div class="upcoming-overdue-list">' + overdueItems + '</div>' +
        '</section>';
    }

    var cardsHtml = '';
    for (var offset = 0; offset < 7; offset++) {
      var dateStr = utils.addDays(today, offset);
      var chipInfo = formatShortChip(dateStr);
      var dayTasks = store.getTasksForDate(dateStr);
      var estMins = 0;
      var doneCount = 0;
      for (var i = 0; i < dayTasks.length; i++) {
        estMins += Number(dayTasks[i].estimatedMinutes || 0);
        if (dayTasks[i].status === 'done') {
          doneCount++;
        }
      }
      var dayBadge = offset === 0 ? 'Today' : (offset === 1 ? 'Tomorrow' : chipInfo.weekday);

      var itemsHtml = dayTasks.length > 0
        ? dayTasks
            .map(function (t) {
              var doneCls = t.status === 'done' ? ' is-completed' : '';
              return (
                '<div class="upcoming-task-row' + doneCls + '" data-task-id="' + esc(t.id) + '">' +
                  '<button type="button" class="task-check-btn" data-action="toggle-done" aria-label="' + (t.status === 'done' ? 'Mark not done' : 'Mark done') + '">' +
                    '<svg class="task-check-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
                      '<circle class="task-check-circle" cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>' +
                      '<path class="task-check-mark" d="M8 12.5l2.8 2.8L16.5 9.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
                    '</svg>' +
                  '</button>' +
                  '<button type="button" class="upcoming-task-link" data-action="open-drawer">' + esc(t.title) + '</button>' +
                  '<span class="priority-badge" data-priority="' + esc(t.priority) + '">' + esc(labelFor(PRIORITIES, t.priority)) + '</span>' +
                  (t.scheduledTime ? '<span class="time-badge">' + esc(t.scheduledTime) + '</span>' : '') +
                '</div>'
              );
            })
            .join('')
        : '<p class="upcoming-empty">No tasks scheduled</p>';

      cardsHtml +=
        '<article class="upcoming-day-card' + (offset === 0 ? ' is-today' : '') + '" data-date="' + esc(dateStr) + '">' +
          '<header class="upcoming-day-header">' +
            '<button type="button" class="upcoming-day-title-btn" data-action="open-day-in-today" data-date="' + esc(dateStr) + '">' +
              '<span class="upcoming-day-badge">' + esc(dayBadge) + '</span>' +
              '<span class="upcoming-day-date">' + esc(chipInfo.month + ' ' + chipInfo.dayNum) + '</span>' +
            '</button>' +
            '<span class="upcoming-day-meta">' + doneCount + '/' + dayTasks.length + (estMins > 0 ? ' • ' + utils.formatMinutes(estMins) : '') + '</span>' +
          '</header>' +
          '<div class="upcoming-day-tasks">' + itemsHtml + '</div>' +
          '<form class="upcoming-inline-add" data-action="upcoming-add-form" data-date="' + esc(dateStr) + '">' +
            '<input type="text" class="form-input upcoming-add-input" placeholder="+ Add to ' + esc(dayBadge) + '..." aria-label="Add task to ' + esc(utils.formatDateLabel(dateStr)) + '">' +
          '</form>' +
        '</article>';
    }

    container.innerHTML =
      '<div class="upcoming-header">' +
        '<div>' +
          '<h2>7-Day Rolling Agenda</h2>' +
          '<p class="upcoming-subtitle">Plan your week ahead, balance daily capacity, and clear overdue items.</p>' +
        '</div>' +
        '<button type="button" class="btn btn-secondary btn-sm" data-action="go-today-view">Back to Today</button>' +
      '</div>' +
      overdueHtml +
      '<div class="upcoming-grid">' + cardsHtml + '</div>';

    if (focusedDate) {
      var restoreInput = container.querySelector('[data-date="' + focusedDate + '"] .upcoming-add-input');
      if (restoreInput) {
        restoreInput.value = focusedVal;
        restoreInput.focus();
        if (selStart !== null && typeof restoreInput.setSelectionRange === 'function') {
          restoreInput.setSelectionRange(selStart, selEnd);
        }
      }
    }
  }

  function openDrawer(taskId) {
    var drawer = document.getElementById('task-drawer');
    var backdrop = document.getElementById('drawer-backdrop');
    if (!drawer || !taskId) {
      return;
    }
    uiState.openDrawerId = taskId;
    renderDrawer(true);
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    if (backdrop) {
      backdrop.hidden = false;
    }
    var titleInput = document.getElementById('drawer-title');
    if (titleInput) {
      titleInput.focus();
    }
  }

  var notesTimer = null;
  var pendingDrawerEdit = null;

  function flushDrawerEdits() {
    clearTimeout(notesTimer);
    notesTimer = null;
    if (!pendingDrawerEdit && uiState.openDrawerId) {
      var titleEl = document.getElementById('drawer-title');
      var notesEl = document.getElementById('drawer-notes');
      var commentEl = document.getElementById('drawer-completion-comment');
      var store = getStore();
      var task = (store.getState().tasks || []).find(function (t) { return t.id === uiState.openDrawerId; });
      if (task) {
        var patch = {};
        if (titleEl && titleEl.value.trim() && titleEl.value.trim() !== task.title) {
          patch.title = titleEl.value.trim();
        }
        if (notesEl && notesEl.value !== (task.notes || '')) {
          patch.notes = notesEl.value;
        }
        if (commentEl && commentEl.value !== (task.completionComment || '')) {
          patch.completionComment = commentEl.value.slice(0, 2000);
        }
        if (Object.keys(patch).length > 0) {
          store.updateTask(task.id, patch);
        }
      }
      return;
    }
    if (pendingDrawerEdit) {
      var edit = pendingDrawerEdit;
      pendingDrawerEdit = null;
      getStore().updateTask(edit.id, edit.patch);
    }
  }

  function closeDrawer() {
    flushDrawerEdits();
    var drawer = document.getElementById('task-drawer');
    var backdrop = document.getElementById('drawer-backdrop');
    uiState.openDrawerId = null;
    if (drawer) {
      drawer.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
    }
    if (backdrop) {
      backdrop.hidden = true;
    }
  }

  function closeCompletionCommentModal() {
    uiState.commentModalTaskId = null;
    var modal = document.getElementById('completion-comment-modal');
    if (modal) modal.hidden = true;
  }

  function openCompletionCommentModal(taskId) {
    if (!taskId) return;
    var task = (getStore().getState().tasks || []).find(function (t) { return t.id === taskId; });
    if (!task) return;
    var modal = document.getElementById('completion-comment-modal');
    if (!modal) return;
    uiState.commentModalTaskId = taskId;
    var labelEl = document.getElementById('completion-comment-task-label');
    if (labelEl) labelEl.textContent = task.title || '';
    var input = document.getElementById('completion-comment-input');
    if (input) input.value = task.completionComment || '';
    modal.hidden = false;
    if (input) {
      window.setTimeout(function () {
        input.focus();
      }, 20);
    }
  }

  function focusQuickAdd() {
    var store = getStore();
    if (store.getState().activeView !== 'today') {
      store.setActiveView('today');
    }
    var input = document.getElementById('quick-add-title');
    if (input) {
      input.focus();
      input.select();
    }
  }

  function submitQuickAdd(openDetailsAfter) {
    var input = document.getElementById('quick-add-title');
    if (!input) {
      return;
    }
    var raw = input.value.trim();
    if (!raw) {
      input.focus();
      return;
    }

    var store = getStore();
    var utils = getUtils();
    var selectedDate = store.getState().selectedDate || utils.todayKey();
    var lines = raw.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);

    var createdFirst = null;
    for (var i = 0; i < lines.length; i++) {
      var parsed = parseQuickAddShorthand(lines[i]);
      var qa = uiState.quickAdd;
      var payload = {
        title: parsed.title,
        date: selectedDate,
        priority: parsed.extracted.priority || qa.priority,
        category: parsed.extracted.category || qa.category,
        timeBlock: parsed.extracted.timeBlock || qa.timeBlock,
        scheduledTime: i === 0 ? qa.scheduledTime : '',
        estimatedMinutes: parsed.extracted.estimatedMinutes != null ? parsed.extracted.estimatedMinutes : Number(qa.estimatedMinutes || 0)
      };
      var created = store.addTask(payload);
      if (i === 0) {
        createdFirst = created;
      }
    }

    input.value = '';
    uiState.quickAdd.scheduledTime = '';
    var timeEl = document.getElementById('qa-time');
    if (timeEl) {
      timeEl.value = '';
    }

    if (lines.length > 1) {
      notifyToast('Added ' + lines.length + ' tasks');
    }
    announce('Added ' + (lines.length > 1 ? lines.length + ' tasks' : (createdFirst ? createdFirst.title : 'task')));

    if (openDetailsAfter && createdFirst && createdFirst.id) {
      openDrawer(createdFirst.id);
    } else {
      input.focus();
    }
  }

  function handleActionClick(action, target) {
    var store = getStore();
    var utils = getUtils();
    var timer = getTimer();
    var today = utils.todayKey();
    var selectedDate = store.getState().selectedDate || today;
    var card = target.closest('[data-task-id]');
    var taskId = target.getAttribute('data-task-id') || (card ? card.getAttribute('data-task-id') : null);

    switch (action) {
      case 'select-date': {
        var d = target.getAttribute('data-date');
        if (d) {
          store.setSelectedDate(d);
        }
        return true;
      }
      case 'prev-week':
        store.setSelectedDate(utils.addDays(selectedDate, -7));
        return true;
      case 'next-week':
        store.setSelectedDate(utils.addDays(selectedDate, 7));
        return true;
      case 'jump-today':
        store.setSelectedDate(today);
        return true;
      case 'rollover-all': {
        var list = store.getRolloverTasks(today);
        if (list.length > 0) {
          var ids = list.map(function (t) { return t.id; });
          var moved = store.rolloverTasksToDate(ids, today);
          if (moved > 0) {
            notifyToast('Moved ' + moved + ' tasks to Today', { undoable: true, type: 'success' });
          }
        }
        return true;
      }
      case 'rollover-one':
        if (taskId) {
          if (store.rolloverTasksToDate([taskId], today) > 0) {
            notifyToast('Moved task to Today', { undoable: true, type: 'success' });
          }
        }
        return true;
      case 'rollover-done':
        if (taskId) {
          store.toggleTaskDone(taskId);
          triggerChime('check');
          openCompletionCommentModal(taskId);
        }
        return true;
      case 'toggle-rollover-review':
        uiState.rolloverReviewOpen = !uiState.rolloverReviewOpen;
        renderRolloverBanner();
        return true;
      case 'dismiss-rollover':
        uiState.dismissedRolloverDate = today;
        uiState.rolloverReviewOpen = false;
        renderRolloverBanner();
        return true;
      case 'quick-add-details':
        submitQuickAdd(true);
        return true;
      case 'filter-status': {
        var status = target.getAttribute('data-status') || 'all';
        store.setFilters({ status: status });
        return true;
      }
      case 'filter-category': {
        var cat = target.getAttribute('data-category') || 'all';
        store.setFilters({ category: cat });
        return true;
      }
      case 'clear-search':
        store.setFilters({ search: '' });
        var searchInput = document.getElementById('global-search-input');
        if (searchInput) {
          searchInput.value = '';
        }
        return true;
      case 'clear-completed': {
        var cleared = store.clearCompletedForDate(selectedDate);
        var count = typeof cleared === 'number' ? cleared : (Array.isArray(cleared) ? cleared.length : 0);
        notifyToast(count > 0 ? 'Cleared ' + count + ' completed tasks' : 'Cleared completed tasks', { undoable: count > 0 });
        return true;
      }
      case 'show-completed':
        store.updateSettings({ showCompleted: true });
        return true;
      case 'reset-filters':
        store.setFilters({ status: 'all', category: 'all', priority: 'all', search: '' });
        var gs = document.getElementById('global-search-input');
        if (gs) {
          gs.value = '';
        }
        return true;
      case 'focus-quick-add':
        focusQuickAdd();
        return true;
      case 'apply-routines-empty': {
        var res = store.applyRoutinesToDate(selectedDate);
        var added = typeof res === 'number' ? res : (Array.isArray(res) ? res.length : (res && res.addedCount) || 0);
        notifyToast(added > 0 ? 'Added ' + added + ' routine tasks' : 'Routines already applied');
        return true;
      }
      case 'toggle-done':
        if (taskId) {
          var before = (store.getState().tasks || []).find(function (t) { return t.id === taskId; });
          store.toggleTaskDone(taskId);
          if (before && before.status !== 'done') {
            triggerChime('check');
            announce('Completed ' + before.title);
            openCompletionCommentModal(taskId);
          }
        }
        return true;
      case 'cycle-status':
        if (taskId) {
          var current = (store.getState().tasks || []).find(function (t) { return t.id === taskId; });
          if (current) {
            var next = (STATUS_META[current.status] || STATUS_META.todo).next;
            store.updateTask(taskId, { status: next });
            if (next === 'done') {
              triggerChime('check');
              announce('Completed ' + current.title);
              openCompletionCommentModal(taskId);
            }
          }
        }
        return true;
      case 'focus-task':
        if (taskId && timer) {
          if (isTimerRunningFor(taskId)) {
            timer.pause();
          } else {
            timer.attachTask(taskId);
            timer.start();
          }
          renderTaskList();
        }
        return true;
      case 'move-up':
        if (taskId) {
          store.moveTaskOrder(taskId, 'up');
        }
        return true;
      case 'move-down':
        if (taskId) {
          store.moveTaskOrder(taskId, 'down');
        }
        return true;
      case 'duplicate-task':
        if (taskId) {
          store.duplicateTask(taskId);
          notifyToast('Task duplicated');
        }
        return true;
      case 'open-drawer':
        if (taskId) {
          openDrawer(taskId);
        }
        return true;
      case 'delete-task':
        if (taskId) {
          if (uiState.openDrawerId === taskId) {
            closeDrawer();
          }
          store.deleteTask(taskId);
          notifyToast('Task deleted', { undoable: true });
        }
        return true;
      case 'close-drawer':
        closeDrawer();
        return true;
      case 'toggle-subtask': {
        var subRow = target.closest('[data-subtask-id]');
        if (subRow && uiState.openDrawerId) {
          store.toggleSubtask(uiState.openDrawerId, subRow.getAttribute('data-subtask-id'));
          renderDrawer(true);
        }
        return true;
      }
      case 'delete-subtask': {
        var delSubRow = target.closest('[data-subtask-id]');
        if (delSubRow && uiState.openDrawerId) {
          store.deleteSubtask(uiState.openDrawerId, delSubRow.getAttribute('data-subtask-id'));
          renderDrawer(true);
        }
        return true;
      }
      case 'drawer-preset-est':
        if (uiState.openDrawerId) {
          var mins = parseInt(target.getAttribute('data-minutes'), 10) || 0;
          store.updateTask(uiState.openDrawerId, { estimatedMinutes: mins });
          renderDrawer(true);
        }
        return true;
      case 'drawer-focus':
        if (uiState.openDrawerId && timer) {
          if (isTimerRunningFor(uiState.openDrawerId)) {
            timer.pause();
          } else {
            timer.attachTask(uiState.openDrawerId);
            timer.start();
          }
          renderDrawer(true);
        }
        return true;
      case 'drawer-duplicate':
        if (uiState.openDrawerId) {
          var dup = store.duplicateTask(uiState.openDrawerId);
          notifyToast('Task duplicated');
          if (dup && dup.id) {
            openDrawer(dup.id);
          }
        }
        return true;
      case 'drawer-move-tomorrow':
        if (uiState.openDrawerId) {
          var t = (store.getState().tasks || []).find(function (item) { return item.id === uiState.openDrawerId; });
          if (t) {
            var nextDay = utils.addDays(t.date, 1);
            store.updateTask(t.id, { date: nextDay });
            notifyToast('Moved to ' + utils.formatDateLabel(nextDay));
            renderDrawer(true);
          }
        }
        return true;
      case 'drawer-delete':
        if (uiState.openDrawerId) {
          var idToDelete = uiState.openDrawerId;
          closeDrawer();
          store.deleteTask(idToDelete);
          notifyToast('Task deleted', { undoable: true });
        }
        return true;
      case 'open-day-in-today': {
        var jumpDate = target.getAttribute('data-date');
        if (jumpDate) {
          store.setSelectedDate(jumpDate);
          store.setActiveView('today');
        }
        return true;
      }
      case 'go-today-view':
        store.setActiveView('today');
        return true;
      default:
        return false;
    }
  }

  function saveInlineEdit(inputEl) {
    if (!uiState.editingTaskId) {
      return;
    }
    var taskId = inputEl.getAttribute('data-task-id');
    if (taskId !== uiState.editingTaskId) {
      return;
    }
    var nextTitle = inputEl.value.trim();
    uiState.editingTaskId = null;
    if (taskId && nextTitle) {
      getStore().updateTask(taskId, { title: nextTitle });
    } else {
      renderTaskList();
    }
  }

  function bindEvents() {
    var todayView = document.getElementById('view-today');
    var upcomingView = document.getElementById('view-upcoming');
    var drawer = document.getElementById('task-drawer');
    var backdrop = document.getElementById('drawer-backdrop');

    [todayView, upcomingView, drawer].forEach(function (root) {
      if (!root) {
        return;
      }
      root.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-action]');
        if (!btn || btn.disabled) {
          return;
        }
        var action = btn.getAttribute('data-action');
        if (action === 'inline-edit' || action === 'toggle-subtask' || action === 'add-subtask-form' || action === 'upcoming-add-form') {
          return;
        }
        handleActionClick(action, btn);
      });
    });

    if (backdrop) {
      backdrop.addEventListener('click', closeDrawer);
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && uiState.openDrawerId && !uiState.editingTaskId && !document.querySelector('.modal-backdrop:not([hidden])')) {
        closeDrawer();
      }
    });

    if (todayView) {
      todayView.addEventListener('submit', function (e) {
        if (e.target && e.target.id === 'quick-add-form') {
          e.preventDefault();
          submitQuickAdd(false);
        }
      });

      todayView.addEventListener('paste', function (e) {
        if (!e.target || e.target.id !== 'quick-add-title') {
          return;
        }
        var text = e.clipboardData ? e.clipboardData.getData('text') : '';
        if (text && text.indexOf('\n') !== -1) {
          e.preventDefault();
          var lines = text.split(/\r?\n/).map(function (s) { return s.replace(/^[-*•\[\]xX\s]+/, '').trim(); }).filter(Boolean);
          if (lines.length > 0) {
            e.target.value = lines.join('\n');
            submitQuickAdd(false);
          }
        }
      });

      todayView.addEventListener('change', function (e) {
        var el = e.target;
        if (!el) {
          return;
        }
        var store = getStore();
        if (el.id === 'qa-priority') {
          uiState.quickAdd.priority = el.value;
        } else if (el.id === 'qa-category') {
          uiState.quickAdd.category = el.value;
        } else if (el.id === 'qa-timeblock') {
          uiState.quickAdd.timeBlock = el.value;
        } else if (el.id === 'qa-time') {
          uiState.quickAdd.scheduledTime = el.value;
        } else if (el.id === 'qa-estimate') {
          uiState.quickAdd.estimatedMinutes = parseInt(el.value, 10) || 0;
        } else if (el.getAttribute('data-action') === 'pick-date') {
          if (el.value) {
            store.setSelectedDate(el.value);
          }
        } else if (el.getAttribute('data-action') === 'filter-priority') {
          store.setFilters({ priority: el.value });
        } else if (el.getAttribute('data-action') === 'filter-sort') {
          store.setFilters({ sort: el.value });
        }
      });

      todayView.addEventListener('dblclick', function (e) {
        var titleEl = e.target.closest('[data-action="inline-edit"]');
        if (!titleEl) {
          return;
        }
        var card = titleEl.closest('[data-task-id]');
        if (!card) {
          return;
        }
        uiState.editingTaskId = card.getAttribute('data-task-id');
        renderTaskList();
      });

      todayView.addEventListener('keydown', function (e) {
        if (!e.target.classList || !e.target.classList.contains('task-inline-input')) {
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          saveInlineEdit(e.target);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          uiState.editingTaskId = null;
          renderTaskList();
        }
      });

      todayView.addEventListener('focusout', function (e) {
        if (e.target && e.target.classList && e.target.classList.contains('task-inline-input')) {
          saveInlineEdit(e.target);
        }
      });

      var taskListContainer = document.getElementById('task-list-container');
      if (taskListContainer) {
        taskListContainer.addEventListener('dragstart', function (e) {
          var card = e.target.closest('.task-card[draggable="true"]');
          if (!card) {
            return;
          }
          uiState.dragTaskId = card.getAttribute('data-task-id');
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', uiState.dragTaskId);
          }
          setTimeout(function () {
            card.classList.add('is-dragging');
          }, 0);
        });

        taskListContainer.addEventListener('dragover', function (e) {
          if (!uiState.dragTaskId) {
            return;
          }
          var card = e.target.closest('.task-card[draggable="true"]');
          var group = e.target.closest('.task-group[data-time-block]');
          if (!card && !group) {
            return;
          }
          e.preventDefault();
          if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
          }
          var prev = taskListContainer.querySelectorAll('.task-card.drag-over');
          for (var i = 0; i < prev.length; i++) {
            if (prev[i] !== card) {
              prev[i].classList.remove('drag-over');
            }
          }
          if (card && card.getAttribute('data-task-id') !== uiState.dragTaskId) {
            card.classList.add('drag-over');
          }
        });

        taskListContainer.addEventListener('dragleave', function (e) {
          var card = e.target.closest('.task-card');
          if (card && !card.contains(e.relatedTarget)) {
            card.classList.remove('drag-over');
          }
        });

        taskListContainer.addEventListener('drop', function (e) {
          if (!uiState.dragTaskId) {
            return;
          }
          var card = e.target.closest('.task-card[draggable="true"]');
          var group = e.target.closest('.task-group[data-time-block]');
          if (!card && !group) {
            return;
          }
          e.preventDefault();
          if (card) {
            var targetId = card.getAttribute('data-task-id');
            card.classList.remove('drag-over');
            if (targetId && uiState.dragTaskId !== targetId) {
              getStore().reorderTask(uiState.dragTaskId, targetId);
            }
          } else if (group) {
            var targetBlock = group.getAttribute('data-time-block');
            getStore().reorderTask(uiState.dragTaskId, null, targetBlock);
          }
        });

        taskListContainer.addEventListener('dragend', function () {
          uiState.dragTaskId = null;
          var marked = taskListContainer.querySelectorAll('.is-dragging, .drag-over');
          for (var i = 0; i < marked.length; i++) {
            marked[i].classList.remove('is-dragging', 'drag-over');
          }
        });
      }
    }

    if (upcomingView) {
      upcomingView.addEventListener('submit', function (e) {
        var form = e.target.closest('[data-action="upcoming-add-form"]');
        if (!form) {
          return;
        }
        e.preventDefault();
        var input = form.querySelector('.upcoming-add-input');
        var dateStr = form.getAttribute('data-date');
        var title = input ? input.value.trim() : '';
        if (title && dateStr) {
          getStore().addTask({ title: title, date: dateStr });
          input.value = '';
          announce('Added task to ' + getUtils().formatDateLabel(dateStr));
        }
      });
    }

    if (drawer) {
      drawer.addEventListener('submit', function (e) {
        var form = e.target.closest('[data-action="add-subtask-form"]');
        if (!form || !uiState.openDrawerId) {
          return;
        }
        e.preventDefault();
        var input = form.querySelector('#drawer-new-subtask');
        var title = input ? input.value.trim() : '';
        if (title) {
          getStore().addSubtask(uiState.openDrawerId, title);
          renderDrawer(true);
          var nextInput = document.getElementById('drawer-new-subtask');
          if (nextInput) {
            nextInput.focus();
          }
        }
      });

      drawer.addEventListener('change', function (e) {
        var field = e.target && e.target.getAttribute('data-field');
        if (!field || !uiState.openDrawerId) {
          return;
        }
        var patch = {};
        if (field === 'estimatedMinutes' || field === 'actualMinutes') {
          patch[field] = Math.max(0, parseInt(e.target.value, 10) || 0);
        } else {
          patch[field] = e.target.value;
        }
        getStore().updateTask(uiState.openDrawerId, patch);
        if (field === 'status' || field === 'priority' || field === 'date') {
          renderDrawer(true);
        }
      });

      drawer.addEventListener('input', function (e) {
        var field = e.target && e.target.getAttribute('data-field');
        if ((field !== 'notes' && field !== 'title' && field !== 'completionComment') || !uiState.openDrawerId) {
          return;
        }
        var id = uiState.openDrawerId;
        var val = e.target.value;
        var patch = {};
        if (field === 'title') {
          var trimmed = val.trim();
          if (!trimmed) {
            return;
          }
          patch.title = trimmed;
        } else if (field === 'completionComment') {
          patch.completionComment = val.slice(0, 2000);
        } else {
          patch.notes = val;
        }
        pendingDrawerEdit = { id: id, patch: patch };
        clearTimeout(notesTimer);
        notesTimer = setTimeout(function () {
          notesTimer = null;
          if (pendingDrawerEdit) {
            var commitEdit = pendingDrawerEdit;
            pendingDrawerEdit = null;
            getStore().updateTask(commitEdit.id, commitEdit.patch);
          }
        }, 250);
      });

      drawer.addEventListener('focusout', function (e) {
        var field = e.target && e.target.getAttribute('data-field');
        if (field === 'notes' || field === 'title' || field === 'completionComment') {
          flushDrawerEdits();
        }
      });

      window.addEventListener('pagehide', flushDrawerEdits);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') {
          flushDrawerEdits();
        }
      });
    }

    var commentModal = document.getElementById('completion-comment-modal');
    if (commentModal) {
      commentModal.addEventListener('click', function (e) {
        var chip = e.target.closest('[data-comment-chip]');
        if (!chip) return;
        var input = document.getElementById('completion-comment-input');
        if (input) {
          input.value = chip.getAttribute('data-comment-chip') || '';
          input.focus();
        }
      });

      var commentInput = document.getElementById('completion-comment-input');
      if (commentInput) {
        commentInput.addEventListener('keydown', function (e) {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            var form = document.getElementById('completion-comment-form');
            if (form) form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
          }
        });
      }

      var commentForm = document.getElementById('completion-comment-form');
      if (commentForm) {
        commentForm.addEventListener('submit', function (e) {
          e.preventDefault();
          var targetId = uiState.commentModalTaskId;
          var input = document.getElementById('completion-comment-input');
          var val = input ? input.value.trim().slice(0, 2000) : '';
          closeCompletionCommentModal();
          if (targetId) {
            getStore().updateTask(targetId, { completionComment: val });
            if (val) {
              notifyToast('Completion comment saved', { type: 'success' });
            }
          }
        });
      }
    }
  }

  function render() {
    var activeView = getStore().getState().activeView || 'today';
    if (activeView === 'today') {
      renderDateStrip();
      renderRolloverBanner();
      renderQuickAdd();
      renderFiltersToolbar();
      renderTaskList();
    } else if (activeView === 'upcoming') {
      renderUpcomingView();
    }
    if (uiState.openDrawerId) {
      renderDrawer(false);
    }
  }

  function init() {
    if (uiState.initialized) {
      return;
    }
    uiState.initialized = true;
    bindEvents();

    var timer = getTimer();
    if (timer && typeof timer.subscribe === 'function') {
      timer.subscribe(function (tState, meta) {
        if (meta && meta.event === 'tick') {
          return;
        }
        if ((getStore().getState().activeView || 'today') === 'today' && !uiState.editingTaskId) {
          renderTaskList();
        }
        if (uiState.openDrawerId) {
          var focusBtn = document.querySelector('#task-drawer-body [data-action="drawer-focus"]');
          if (focusBtn) {
            focusBtn.textContent = isTimerRunningFor(uiState.openDrawerId) ? 'Pause Focus' : 'Focus on this task';
          }
        }
      });
    }
  }

  TaskFlow.TasksUI = {
    init: init,
    render: render,
    focusQuickAdd: focusQuickAdd,
    openDrawer: openDrawer,
    closeDrawer: closeDrawer
  };
})(window);
