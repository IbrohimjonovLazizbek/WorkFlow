(function (global) {
  'use strict';

  var TaskFlow = global.TaskFlow = global.TaskFlow || {};

  var VIEW_TITLES = {
    today: 'Today',
    upcoming: 'Upcoming & Backlog',
    analytics: 'Progress & Analytics',
    routines: 'Daily Routines'
  };

  var sampleBannerDismissed = false;
  var activeModalId = null;
  var paletteActiveIndex = 0;
  var paletteItems = [];
  var lastRenderedTheme = null;
  var timerRefs = null;
  var deferredInstallPrompt = null;
  var initialized = false;

  function $(id) {
    return global.document ? global.document.getElementById(id) : null;
  }

  function getStore() {
    return TaskFlow.Store;
  }

  function getUtils() {
    return TaskFlow.Utils;
  }

  function getTimer() {
    return TaskFlow.Timer;
  }

  /* =========================================================================
   * Accessibility & Toasts
   * ========================================================================= */
  function announce(message) {
    var el = $('sr-announcer');
    if (!el) return;
    el.textContent = '';
    global.setTimeout(function () {
      el.textContent = String(message || '');
    }, 20);
  }

  function showToast(message, options) {
    var container = $('toast-container');
    if (!container) return;

    var opts = options || {};
    var duration = typeof opts.duration === 'number' ? opts.duration : 5000;
    var type = opts.type || 'info';
    var undoable = Boolean(opts.undoable && getStore().canUndo());

    var toast = global.document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.setAttribute('role', 'status');

    var msgSpan = global.document.createElement('span');
    msgSpan.className = 'toast-message';
    msgSpan.textContent = String(message || '');
    toast.appendChild(msgSpan);

    var dismissed = false;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      toast.classList.add('is-leaving');
      global.setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 220);
    }

    if (undoable) {
      var undoBtn = global.document.createElement('button');
      undoBtn.type = 'button';
      undoBtn.className = 'toast-undo-btn';
      undoBtn.textContent = 'Undo';
      undoBtn.addEventListener('click', function () {
        if (getStore().undo()) {
          announce('Action undone');
        }
        dismiss();
      });
      toast.appendChild(undoBtn);
    }

    var closeBtn = global.document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn-ghost btn-icon toast-close-btn';
    closeBtn.setAttribute('aria-label', 'Dismiss notification');
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', dismiss);
    toast.appendChild(closeBtn);

    container.appendChild(toast);
    announce(message);

    if (duration > 0) {
      global.setTimeout(dismiss, duration);
    }
  }

  function downloadFile(filename, content, mimeType) {
    var blob = new global.Blob([content], { type: mimeType || 'text/plain;charset=utf-8' });
    var url = global.URL.createObjectURL(blob);
    var a = global.document.createElement('a');
    a.href = url;
    a.download = filename;
    global.document.body.appendChild(a);
    a.click();
    global.document.body.removeChild(a);
    global.setTimeout(function () {
      global.URL.revokeObjectURL(url);
    }, 500);
  }

  /* =========================================================================
   * Theme, Sidebar & Header
   * ========================================================================= */
  function applyTheme(theme) {
    var next = theme === 'dark' ? 'dark' : 'light';
    if (lastRenderedTheme !== next) {
      global.document.documentElement.setAttribute('data-theme', next);
      lastRenderedTheme = next;
    }

    var btn = $('btn-theme-toggle');
    if (!btn) return;
    if (next === 'dark') {
      btn.setAttribute('aria-label', 'Switch to light mode');
      btn.setAttribute('title', 'Switch to light mode (D)');
      btn.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>' +
        '</svg>';
    } else {
      btn.setAttribute('aria-label', 'Switch to dark mode');
      btn.setAttribute('title', 'Switch to dark mode (D)');
      btn.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="5"></circle>' +
        '<line x1="12" y1="1" x2="12" y2="3"></line>' +
        '<line x1="12" y1="21" x2="12" y2="23"></line>' +
        '<line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>' +
        '<line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>' +
        '<line x1="1" y1="12" x2="3" y2="12"></line>' +
        '<line x1="21" y1="12" x2="23" y2="12"></line>' +
        '<line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>' +
        '<line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>' +
        '</svg>';
    }
  }

  function toggleTheme() {
    var current = getStore().getState().theme;
    getStore().setTheme(current === 'dark' ? 'light' : 'dark');
  }

  function openMobileSidebar() {
    var sidebar = $('app-sidebar');
    var backdrop = $('sidebar-backdrop');
    var menuBtn = $('btn-mobile-menu');
    if (sidebar) sidebar.classList.add('open');
    if (backdrop) {
      backdrop.hidden = false;
      backdrop.classList.add('open');
    }
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'true');
  }

  function closeMobileSidebar() {
    var sidebar = $('app-sidebar');
    var backdrop = $('sidebar-backdrop');
    var menuBtn = $('btn-mobile-menu');
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) {
      backdrop.classList.remove('open');
      backdrop.hidden = true;
    }
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
  }

  function updateHeaderAndNav(state) {
    var utils = getUtils();
    var store = getStore();
    var view = state.activeView;
    var dayStats = store.getDayStats(state.selectedDate);
    var streak = store.getStreakInfo();

    var workspaceEl = $('sidebar-workspace-name');
    if (workspaceEl) workspaceEl.textContent = state.settings.userName || 'Daily Workspace';

    var panels = global.document.querySelectorAll('.view-panel[data-view-panel]');
    for (var i = 0; i < panels.length; i += 1) {
      var panel = panels[i];
      var isTarget = panel.getAttribute('data-view-panel') === view;
      panel.hidden = !isTarget;
    }

    var navItems = global.document.querySelectorAll('.nav-item[data-view]');
    for (var j = 0; j < navItems.length; j += 1) {
      var btn = navItems[j];
      var active = btn.getAttribute('data-view') === view;
      btn.classList.toggle('active', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    }

    var titleEl = $('header-title');
    var subEl = $('header-subtitle');
    if (titleEl) {
      if (view === 'today') {
        titleEl.textContent = state.selectedDate === utils.todayKey()
          ? 'Today'
          : utils.formatDateLabel(state.selectedDate);
      } else {
        titleEl.textContent = VIEW_TITLES[view] || 'TaskFlow';
      }
    }
    if (subEl) {
      if (view === 'today') {
        var remaining = dayStats.total - dayStats.done;
        subEl.textContent = utils.formatDateLabel(state.selectedDate) + ' • ' +
          (dayStats.total === 0
            ? 'No tasks planned yet'
            : (remaining === 0 ? 'All ' + dayStats.total + ' tasks completed' : remaining + ' remaining of ' + dayStats.total));
      } else if (view === 'upcoming') {
        var today = utils.todayKey();
        var upcomingCount = state.tasks.filter(function (t) {
          return t.status !== 'done' && t.date >= today && t.date <= utils.addDays(today, 6);
        }).length;
        subEl.textContent = upcomingCount + ' active tasks across the next 7 days';
      } else if (view === 'analytics') {
        subEl.textContent = streak.currentStreak + '-day active streak • ' +
          utils.formatMinutes(dayStats.actualMinutes) + ' focused on ' + utils.formatDateLabel(state.selectedDate);
      } else if (view === 'routines') {
        var activeRoutines = state.routines.filter(function (r) { return r.active; }).length;
        subEl.textContent = activeRoutines + ' active recurring habits & templates';
      }
    }

    var todayBadge = $('nav-badge-today');
    if (todayBadge) {
      var todayStats = store.getDayStats(utils.todayKey());
      var todayRem = todayStats.total - todayStats.done;
      todayBadge.textContent = String(todayRem > 0 ? todayRem : todayStats.total);
    }

    var upBadge = $('nav-badge-upcoming');
    if (upBadge) {
      var tKey = utils.todayKey();
      var endUp = utils.addDays(tKey, 6);
      var upCount = state.tasks.filter(function (t) {
        return t.status !== 'done' && t.date >= tKey && t.date <= endUp;
      }).length;
      upBadge.textContent = String(upCount);
    }

    var anaBadge = $('nav-badge-analytics');
    if (anaBadge) {
      anaBadge.textContent = dayStats.completionRate + '%';
    }

    var rtnBadge = $('nav-badge-routines');
    if (rtnBadge) {
      rtnBadge.textContent = String(state.routines.filter(function (r) { return r.active; }).length);
    }

    var searchEl = $('global-search-input');
    if (searchEl && global.document.activeElement !== searchEl && searchEl.value !== state.filters.search) {
      searchEl.value = state.filters.search;
    }

    var sampleBanner = $('sample-data-banner');
    if (sampleBanner) {
      sampleBanner.hidden = !(state.isSampleData && !sampleBannerDismissed);
    }

    renderSidebarWidgets(state, dayStats, streak);
  }

  function renderSidebarWidgets(state, dayStats, streak) {
    var utils = getUtils();
    var miniEl = $('sidebar-mini-progress');
    if (miniEl) {
      var goalTasks = state.settings.dailyGoalTasks || 5;
      var goalPct = Math.min(100, Math.round((dayStats.done / goalTasks) * 100));
      miniEl.innerHTML =
        '<div class="mini-progress-header">' +
          '<span class="sidebar-widget-title">Daily Goal</span>' +
          '<span class="mini-progress-value">' + dayStats.done + '/' + goalTasks + '</span>' +
        '</div>' +
        '<div class="mini-progress-track" aria-label="Daily task goal progress">' +
          '<div class="mini-progress-fill" style="width:' + goalPct + '%"></div>' +
        '</div>' +
        '<div class="mini-progress-meta">' +
          '<span>' + utils.formatMinutes(dayStats.actualMinutes) + ' focus</span>' +
          '<span class="streak-pill">' + streak.currentStreak + 'd streak</span>' +
        '</div>';
    }

    var catEl = $('sidebar-categories');
    if (catEl) {
      var dayTasks = getStore().getTasksForDate(state.selectedDate);
      var counts = {};
      utils.CATEGORIES.forEach(function (c) { counts[c] = 0; });
      dayTasks.forEach(function (t) {
        if (t.status !== 'done') {
          counts[t.category] = (counts[t.category] || 0) + 1;
        }
      });

      var html = '<div class="sidebar-section-label">Categories</div>';
      utils.CATEGORIES.forEach(function (cat) {
        var meta = utils.CATEGORY_META[cat];
        var isActive = state.filters.category === cat;
        html +=
          '<button type="button" class="category-pill-nav' + (isActive ? ' active' : '') + '" data-sidebar-category="' + cat + '" data-category="' + cat + '">' +
            '<span class="category-dot" data-category="' + cat + '"></span>' +
            '<span class="category-pill-name">' + utils.escapeHtml(meta.label) + '</span>' +
            '<span class="category-pill-count">' + counts[cat] + '</span>' +
          '</button>';
      });
      catEl.innerHTML = html;
    }
  }

  /* =========================================================================
   * Header Focus Timer Widget (zero-thrash DOM updates)
   * ========================================================================= */
  function initHeaderTimerWidget() {
    var host = $('header-timer-widget');
    if (!host) return;

    host.innerHTML =
      '<div class="timer-pill">' +
        '<div class="timer-mode-group" role="group" aria-label="Timer mode">' +
          '<button type="button" class="timer-mode-btn" data-timer-mode="pomodoro" title="Pomodoro (25m)">25m</button>' +
          '<button type="button" class="timer-mode-btn" data-timer-mode="deep" title="Deep Focus (50m)">50m</button>' +
          '<button type="button" class="timer-mode-btn" data-timer-mode="break" title="Short Break (5m)">5m</button>' +
          '<button type="button" class="timer-mode-btn" data-timer-mode="stopwatch" title="Stopwatch">SW</button>' +
        '</div>' +
        '<span class="timer-readout tabular-nums" data-timer-readout>25:00</span>' +
        '<button type="button" class="btn btn-ghost btn-icon timer-toggle-btn" data-timer-toggle aria-label="Start timer" title="Start / Pause Focus Timer (F)">' +
          '<span data-timer-toggle-icon></span>' +
        '</button>' +
        '<button type="button" class="btn btn-ghost btn-icon timer-reset-btn" data-timer-reset aria-label="Reset timer" title="Reset timer">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<polyline points="1 4 1 10 7 10"></polyline>' +
            '<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>' +
          '</svg>' +
        '</button>' +
        '<div class="timer-task-chip" data-timer-task-chip hidden>' +
          '<span class="timer-task-title" data-timer-task-title></span>' +
          '<button type="button" class="timer-task-clear" data-timer-detach aria-label="Detach task from timer" title="Detach task">&times;</button>' +
        '</div>' +
      '</div>';

    timerRefs = {
      host: host,
      pill: host.querySelector('.timer-pill'),
      modeBtns: host.querySelectorAll('[data-timer-mode]'),
      readout: host.querySelector('[data-timer-readout]'),
      toggleBtn: host.querySelector('[data-timer-toggle]'),
      toggleIcon: host.querySelector('[data-timer-toggle-icon]'),
      resetBtn: host.querySelector('[data-timer-reset]'),
      taskChip: host.querySelector('[data-timer-task-chip]'),
      taskTitle: host.querySelector('[data-timer-task-title]'),
      detachBtn: host.querySelector('[data-timer-detach]')
    };

    for (var i = 0; i < timerRefs.modeBtns.length; i += 1) {
      timerRefs.modeBtns[i].addEventListener('click', function () {
        getTimer().setMode(this.getAttribute('data-timer-mode'));
      });
    }

    timerRefs.toggleBtn.addEventListener('click', function () {
      var t = getTimer();
      if (t.getState().running) t.pause();
      else t.start();
    });

    timerRefs.resetBtn.addEventListener('click', function () {
      getTimer().reset();
    });

    timerRefs.detachBtn.addEventListener('click', function () {
      getTimer().attachTask(null);
    });

    timerRefs.taskTitle.addEventListener('click', function () {
      var taskId = getTimer().getState().attachedTaskId;
      if (taskId && TaskFlow.TasksUI && typeof TaskFlow.TasksUI.openDrawer === 'function') {
        TaskFlow.TasksUI.openDrawer(taskId);
      }
    });

    updateHeaderTimerWidget();
  }

  function updateHeaderTimerWidget(tState) {
    if (!timerRefs) return;
    var timer = getTimer();
    var ts = tState || timer.getState();

    var seconds = ts.mode === 'stopwatch' ? ts.elapsedSeconds : ts.remainingSeconds;
    timerRefs.readout.textContent = timer.formatClock(seconds);
    timerRefs.pill.classList.toggle('is-running', ts.running);
    timerRefs.pill.classList.toggle('is-break', ts.mode === 'break');

    for (var i = 0; i < timerRefs.modeBtns.length; i += 1) {
      var btn = timerRefs.modeBtns[i];
      var active = btn.getAttribute('data-timer-mode') === ts.mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }

    if (ts.running) {
      timerRefs.toggleBtn.setAttribute('aria-label', 'Pause timer');
      timerRefs.toggleIcon.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
          '<rect x="6" y="4" width="4" height="16" rx="1"></rect>' +
          '<rect x="14" y="4" width="4" height="16" rx="1"></rect>' +
        '</svg>';
    } else {
      timerRefs.toggleBtn.setAttribute('aria-label', 'Start timer');
      timerRefs.toggleIcon.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
          '<polygon points="6 4 20 12 6 20 6 4"></polygon>' +
        '</svg>';
    }

    var attachedTask = null;
    if (ts.attachedTaskId) {
      var tasks = getStore().getState().tasks;
      for (var k = 0; k < tasks.length; k += 1) {
        if (tasks[k].id === ts.attachedTaskId) {
          attachedTask = tasks[k];
          break;
        }
      }
    }

    if (attachedTask) {
      timerRefs.taskChip.hidden = false;
      timerRefs.taskTitle.textContent = attachedTask.title;
      timerRefs.taskTitle.title = attachedTask.title;
    } else {
      timerRefs.taskChip.hidden = true;
      timerRefs.taskTitle.textContent = '';
    }
  }

  /* =========================================================================
   * Modals: Command Palette, Settings, Shortcuts, Cabinet
   * ========================================================================= */
  function closeModals() {
    var ids = ['command-palette-modal', 'settings-modal', 'shortcuts-modal', 'cabinet-modal', 'completion-comment-modal'];
    ids.forEach(function (id) {
      var el = $(id);
      if (el) el.hidden = true;
    });
    activeModalId = null;
  }

  function openModal(id) {
    closeModals();
    var el = $(id);
    if (!el) return;
    el.hidden = false;
    activeModalId = id;
  }

  function openSettings() {
    var st = getStore().getState();
    var nameInput = $('setting-user-name');
    var tasksInput = $('setting-goal-tasks');
    var minsInput = $('setting-goal-minutes');
    var soundInput = $('setting-sound-enabled');
    var completedInput = $('setting-show-completed');

    if (nameInput) nameInput.value = st.settings.userName;
    if (tasksInput) tasksInput.value = String(st.settings.dailyGoalTasks);
    if (minsInput) minsInput.value = String(st.settings.dailyGoalMinutes);
    if (soundInput) soundInput.checked = Boolean(st.settings.soundEnabled);
    if (completedInput) completedInput.checked = Boolean(st.settings.showCompleted);

    openModal('settings-modal');
    if (nameInput) nameInput.focus();
  }

  function openShortcuts() {
    openModal('shortcuts-modal');
  }

  function buildCommandItems(query) {
    var store = getStore();
    var utils = getUtils();
    var timer = getTimer();
    var state = store.getState();
    var auth = store.getAuthState();
    var q = (query || '').trim().toLowerCase();

    var commands = [
      {
        id: 'nav-today',
        group: 'Navigation',
        title: 'Go to Today View',
        hint: '1',
        run: function () { store.setActiveView('today'); }
      },
      {
        id: 'nav-upcoming',
        group: 'Navigation',
        title: 'Go to Upcoming & Backlog',
        hint: '2',
        run: function () { store.setActiveView('upcoming'); }
      },
      {
        id: 'nav-analytics',
        group: 'Navigation',
        title: 'Go to Progress & Analytics',
        hint: '3',
        run: function () { store.setActiveView('analytics'); }
      },
      {
        id: 'nav-routines',
        group: 'Navigation',
        title: 'Go to Daily Routines',
        hint: '4',
        run: function () { store.setActiveView('routines'); }
      },
      {
        id: 'cabinet-open',
        group: 'Account',
        title: 'Open Personal Cabinet',
        hint: '',
        run: function () {
          if (TaskFlow.AuthUI && typeof TaskFlow.AuthUI.openCabinetModal === 'function') {
            TaskFlow.AuthUI.openCabinetModal('account');
          }
        }
      },
      {
        id: 'telegram-send',
        group: 'Account',
        title: "Send Today's Summary to Telegram",
        hint: '',
        run: function () {
          if (TaskFlow.AuthUI && typeof TaskFlow.AuthUI.sendTodaySummaryToTelegram === 'function') {
            TaskFlow.AuthUI.sendTodaySummaryToTelegram();
          }
        }
      },
      {
        id: 'action-new-task',
        group: 'Actions',
        title: 'New Task (Focus Quick Add)',
        hint: 'N',
        run: function () {
          store.setActiveView('today');
          global.setTimeout(function () {
            if (TaskFlow.TasksUI && typeof TaskFlow.TasksUI.focusQuickAdd === 'function') {
              TaskFlow.TasksUI.focusQuickAdd();
            }
          }, 20);
        }
      },
      {
        id: 'action-jump-today',
        group: 'Actions',
        title: 'Jump Date to Today',
        hint: 'T',
        run: function () {
          store.setSelectedDate(utils.todayKey());
          store.setActiveView('today');
        }
      },
      {
        id: 'action-apply-routines',
        group: 'Actions',
        title: 'Apply Active Routines to Selected Date',
        hint: '',
        run: function () {
          var created = store.applyRoutinesToDate(state.selectedDate);
          showToast(created.length > 0
            ? 'Added ' + created.length + ' routine task' + (created.length === 1 ? '' : 's')
            : 'All matching routines are already on this date');
        }
      },
      {
        id: 'action-clear-completed',
        group: 'Actions',
        title: 'Clear Completed Tasks on Selected Date',
        hint: '',
        run: function () {
          var count = store.clearCompletedForDate(state.selectedDate);
          showToast(count > 0 ? 'Cleared ' + count + ' completed task' + (count === 1 ? '' : 's') : 'No completed tasks to clear', { undoable: count > 0 });
        }
      },
      {
        id: 'timer-toggle',
        group: 'Focus Timer',
        title: timer.getState().running ? 'Pause Focus Timer' : 'Start Focus Timer',
        hint: 'F',
        run: function () {
          if (timer.getState().running) timer.pause();
          else timer.start();
        }
      },
      {
        id: 'timer-pomo',
        group: 'Focus Timer',
        title: 'Timer Mode: Pomodoro (25m)',
        hint: '',
        run: function () { timer.setMode('pomodoro'); }
      },
      {
        id: 'timer-deep',
        group: 'Focus Timer',
        title: 'Timer Mode: Deep Focus (50m)',
        hint: '',
        run: function () { timer.setMode('deep'); }
      },
      {
        id: 'timer-break',
        group: 'Focus Timer',
        title: 'Timer Mode: Short Break (5m)',
        hint: '',
        run: function () { timer.setMode('break'); }
      },
      {
        id: 'pref-theme',
        group: 'Workspace',
        title: 'Toggle Light / Dark Theme',
        hint: 'D',
        run: toggleTheme
      },
      {
        id: 'pref-settings',
        group: 'Workspace',
        title: 'Open Settings & Data Backup',
        hint: '',
        run: openSettings
      },
      {
        id: 'pref-shortcuts',
        group: 'Workspace',
        title: 'Show Keyboard Shortcuts',
        hint: '?',
        run: openShortcuts
      },
      {
        id: 'data-export-json',
        group: 'Workspace',
        title: 'Export Backup JSON',
        hint: '',
        run: function () {
          downloadFile('taskflow-backup-' + utils.todayKey() + '.json', store.exportJSON(), 'application/json');
          showToast('Exported JSON backup', { type: 'success' });
        }
      },
      {
        id: 'data-export-csv',
        group: 'Workspace',
        title: 'Export Tasks CSV',
        hint: '',
        run: function () {
          downloadFile('taskflow-tasks-' + utils.todayKey() + '.csv', store.exportCSV(), 'text/csv;charset=utf-8');
          showToast('Exported tasks CSV', { type: 'success' });
        }
      }
    ];

    if (!auth.authenticated) {
      commands.splice(5, 0, {
        id: 'google-signin',
        group: 'Account',
        title: 'Sign in with Google',
        hint: '',
        run: function () {
          if (global.location && global.location.protocol === 'file:') {
            showToast('Google Sign-In requires serving TaskFlow over HTTP/HTTPS');
            return;
          }
          if (auth.authStatus && auth.authStatus.googleConfigured === false) {
            if (TaskFlow.AuthUI) TaskFlow.AuthUI.openCabinetModal('account');
            return;
          }
          global.location.assign('/api/auth/google');
        }
      });
    }

    var matchingTasks = state.tasks
      .filter(function (t) {
        if (!q) return t.date === state.selectedDate;
        return t.title.toLowerCase().indexOf(q) !== -1 || t.category.toLowerCase().indexOf(q) !== -1;
      })
      .slice(0, 8);

    matchingTasks.forEach(function (t) {
      commands.push({
        id: 'task-' + t.id,
        group: 'Tasks',
        title: t.title,
        hint: utils.formatDateLabel(t.date),
        run: function () {
          store.setSelectedDate(t.date);
          store.setActiveView('today');
          if (TaskFlow.TasksUI && typeof TaskFlow.TasksUI.openDrawer === 'function') {
            global.setTimeout(function () { TaskFlow.TasksUI.openDrawer(t.id); }, 20);
          }
        }
      });
    });

    if (!q) return commands.slice(0, 14);
    return commands.filter(function (item) {
      return item.title.toLowerCase().indexOf(q) !== -1 || item.group.toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderCommandPaletteList() {
    var listEl = $('command-palette-list');
    var inputEl = $('command-palette-input');
    if (!listEl) return;

    var utils = getUtils();
    paletteItems = buildCommandItems(inputEl ? inputEl.value : '');
    if (paletteActiveIndex >= paletteItems.length) paletteActiveIndex = Math.max(0, paletteItems.length - 1);

    if (paletteItems.length === 0) {
      listEl.innerHTML = '<div class="command-empty">No matching commands or tasks</div>';
      return;
    }

    var html = '';
    paletteItems.forEach(function (item, idx) {
      var active = idx === paletteActiveIndex;
      html +=
        '<button type="button" class="command-item' + (active ? ' active' : '') + '" role="option" aria-selected="' + (active ? 'true' : 'false') + '" data-cmd-index="' + idx + '">' +
          '<span class="command-item-main">' +
            '<span class="command-item-group">' + utils.escapeHtml(item.group) + '</span>' +
            '<span class="command-item-title">' + utils.escapeHtml(item.title) + '</span>' +
          '</span>' +
          (item.hint ? '<kbd class="kbd">' + utils.escapeHtml(item.hint) + '</kbd>' : '') +
        '</button>';
    });
    listEl.innerHTML = html;

    var activeNode = listEl.querySelector('.command-item.active');
    if (activeNode && typeof activeNode.scrollIntoView === 'function') {
      activeNode.scrollIntoView({ block: 'nearest' });
    }
  }

  function openCommandPalette() {
    openModal('command-palette-modal');
    paletteActiveIndex = 0;
    var inputEl = $('command-palette-input');
    if (inputEl) {
      inputEl.value = '';
      renderCommandPaletteList();
      inputEl.focus();
    } else {
      renderCommandPaletteList();
    }
  }

  function executeCommandAtIndex(idx) {
    var item = paletteItems[idx];
    if (!item) return;
    closeModals();
    item.run();
  }

  /* =========================================================================
   * Render Orchestration
   * ========================================================================= */
  function renderActiveModules(state) {
    var view = state.activeView;
    if (view === 'today') {
      if (TaskFlow.AnalyticsUI && typeof TaskFlow.AnalyticsUI.renderTodaySummary === 'function') {
        TaskFlow.AnalyticsUI.renderTodaySummary();
      }
      if (TaskFlow.TasksUI && typeof TaskFlow.TasksUI.render === 'function') {
        TaskFlow.TasksUI.render();
      }
      if (TaskFlow.RoutinesUI && typeof TaskFlow.RoutinesUI.render === 'function') {
        TaskFlow.RoutinesUI.render();
      }
    } else if (view === 'upcoming') {
      if (TaskFlow.TasksUI && typeof TaskFlow.TasksUI.render === 'function') {
        TaskFlow.TasksUI.render();
      }
    } else if (view === 'analytics') {
      if (TaskFlow.AnalyticsUI && typeof TaskFlow.AnalyticsUI.renderDashboard === 'function') {
        TaskFlow.AnalyticsUI.renderDashboard();
      }
    } else if (view === 'routines') {
      if (TaskFlow.RoutinesUI && typeof TaskFlow.RoutinesUI.render === 'function') {
        TaskFlow.RoutinesUI.render();
      }
    }
  }

  function onStoreChange(state, meta) {
    var reason = meta && meta.reason ? meta.reason : 'update';
    applyTheme(state.theme);

    if (reason === 'sync' || reason === 'authStatus') {
      if (TaskFlow.AuthUI && typeof TaskFlow.AuthUI.render === 'function') {
        TaskFlow.AuthUI.render();
      }
      return;
    }

    if (reason === 'authSwitch') {
      if (TaskFlow.TasksUI && typeof TaskFlow.TasksUI.closeDrawer === 'function') {
        TaskFlow.TasksUI.closeDrawer();
      }
    }

    updateHeaderAndNav(state);
    updateHeaderTimerWidget();
    if (TaskFlow.AuthUI && typeof TaskFlow.AuthUI.render === 'function') {
      TaskFlow.AuthUI.render();
    }
    renderActiveModules(state);
  }

  /* =========================================================================
   * Event Wiring
   * ========================================================================= */
  function isTextInputElement(el) {
    if (!el) return false;
    var tag = el.tagName ? el.tagName.toUpperCase() : '';
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(el.isContentEditable);
  }

  function hasAnyOpenModal() {
    if (activeModalId) return true;
    var cab = $('cabinet-modal');
    var ccm = $('completion-comment-modal');
    return Boolean((cab && !cab.hidden) || (ccm && !ccm.hidden));
  }

  function bindGlobalEvents() {
    var store = getStore();
    var utils = getUtils();
    var timer = getTimer();

    var navList = global.document.querySelector('.nav-list');
    if (navList) {
      navList.addEventListener('click', function (e) {
        var btn = e.target.closest('.nav-item[data-view]');
        if (!btn) return;
        store.setActiveView(btn.getAttribute('data-view'));
        closeMobileSidebar();
      });
    }

    var catSidebar = $('sidebar-categories');
    if (catSidebar) {
      catSidebar.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-sidebar-category]');
        if (!btn) return;
        var cat = btn.getAttribute('data-sidebar-category');
        var currentCat = store.getState().filters.category;
        store.setFilters({ category: currentCat === cat ? 'all' : cat });
        if (store.getState().activeView !== 'today') {
          store.setActiveView('today');
        }
        closeMobileSidebar();
      });
    }

    var mobileMenuBtn = $('btn-mobile-menu');
    if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', openMobileSidebar);
    var sidebarCloseBtn = $('btn-sidebar-close');
    if (sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', closeMobileSidebar);
    var sidebarBackdrop = $('sidebar-backdrop');
    if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeMobileSidebar);

    var themeBtn = $('btn-theme-toggle');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

    var cmdBtn = $('btn-command-palette');
    if (cmdBtn) cmdBtn.addEventListener('click', openCommandPalette);

    var settingsBtn = $('btn-open-settings');
    if (settingsBtn) settingsBtn.addEventListener('click', function () {
      closeMobileSidebar();
      openSettings();
    });

    var shortcutsBtn = $('btn-open-shortcuts');
    if (shortcutsBtn) shortcutsBtn.addEventListener('click', function () {
      closeMobileSidebar();
      openShortcuts();
    });

    var quickAddBtn = $('btn-focus-quick-add');
    if (quickAddBtn) {
      quickAddBtn.addEventListener('click', function () {
        if (store.getState().activeView !== 'today') {
          store.setActiveView('today');
        }
        global.setTimeout(function () {
          if (TaskFlow.TasksUI && typeof TaskFlow.TasksUI.focusQuickAdd === 'function') {
            TaskFlow.TasksUI.focusQuickAdd();
          }
        }, 20);
      });
    }

    var searchInput = $('global-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        store.setFilters({ search: searchInput.value });
      });
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && store.getState().activeView !== 'today') {
          store.setActiveView('today');
        } else if (e.key === 'Escape') {
          searchInput.value = '';
          store.setFilters({ search: '' });
          searchInput.blur();
        }
      });
    }

    var clearBannerBtn = $('btn-clear-sample-banner');
    if (clearBannerBtn) {
      clearBannerBtn.addEventListener('click', function () {
        store.clearSampleData();
        showToast('Workspace cleared — ready for your real tasks!', { undoable: true, type: 'success' });
      });
    }

    var dismissBannerBtn = $('btn-dismiss-sample-banner');
    if (dismissBannerBtn) {
      dismissBannerBtn.addEventListener('click', function () {
        sampleBannerDismissed = true;
        var banner = $('sample-data-banner');
        if (banner) banner.hidden = true;
      });
    }

    global.document.addEventListener('click', function (e) {
      var closeTrigger = e.target.closest('[data-close-modal]');
      if (closeTrigger) {
        closeModals();
        return;
      }
      if (e.target && e.target.classList && e.target.classList.contains('modal-backdrop')) {
        closeModals();
      }
    });

    var cmdInput = $('command-palette-input');
    if (cmdInput) {
      cmdInput.addEventListener('input', function () {
        paletteActiveIndex = 0;
        renderCommandPaletteList();
      });
      cmdInput.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (paletteItems.length > 0) {
            paletteActiveIndex = (paletteActiveIndex + 1) % paletteItems.length;
            renderCommandPaletteList();
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (paletteItems.length > 0) {
            paletteActiveIndex = (paletteActiveIndex - 1 + paletteItems.length) % paletteItems.length;
            renderCommandPaletteList();
          }
        } else if (e.key === 'Enter') {
          e.preventDefault();
          executeCommandAtIndex(paletteActiveIndex);
        }
      });
    }

    var cmdList = $('command-palette-list');
    if (cmdList) {
      cmdList.addEventListener('click', function (e) {
        var row = e.target.closest('[data-cmd-index]');
        if (!row) return;
        executeCommandAtIndex(Number(row.getAttribute('data-cmd-index')));
      });
    }

    var settingsForm = $('settings-form');
    if (settingsForm) {
      var syncSettings = function () {
        var nameVal = $('setting-user-name').value;
        var tasksVal = Number($('setting-goal-tasks').value);
        var minsVal = Number($('setting-goal-minutes').value);
        var soundVal = $('setting-sound-enabled').checked;
        var showCompletedVal = $('setting-show-completed').checked;
        store.updateSettings({
          userName: nameVal,
          dailyGoalTasks: tasksVal,
          dailyGoalMinutes: minsVal,
          soundEnabled: soundVal,
          showCompleted: showCompletedVal
        });
      };
      settingsForm.addEventListener('change', syncSettings);
      settingsForm.addEventListener('submit', function (e) {
        e.preventDefault();
        syncSettings();
        closeModals();
        showToast('Settings saved', { type: 'success' });
      });
    }

    var expJsonBtn = $('btn-export-json');
    if (expJsonBtn) {
      expJsonBtn.addEventListener('click', function () {
        downloadFile('taskflow-backup-' + utils.todayKey() + '.json', store.exportJSON(), 'application/json');
        showToast('Exported JSON backup', { type: 'success' });
      });
    }

    var expCsvBtn = $('btn-export-csv');
    if (expCsvBtn) {
      expCsvBtn.addEventListener('click', function () {
        downloadFile('taskflow-tasks-' + utils.todayKey() + '.csv', store.exportCSV(), 'text/csv;charset=utf-8');
        showToast('Exported tasks CSV', { type: 'success' });
      });
    }

    var impBtn = $('btn-import-json');
    var impFile = $('import-json-file');
    if (impBtn && impFile) {
      impBtn.addEventListener('click', function () {
        impFile.value = '';
        impFile.click();
      });
      impFile.addEventListener('change', function () {
        var file = impFile.files && impFile.files[0];
        if (!file) return;
        var reader = new global.FileReader();
        reader.onload = function () {
          var res = store.importJSON(String(reader.result || ''));
          if (res.ok) {
            closeModals();
            showToast('Imported ' + res.tasksCount + ' tasks & ' + res.routinesCount + ' routines', { undoable: true, type: 'success' });
          } else {
            showToast('Import failed: ' + res.error, { type: 'error', duration: 6000 });
          }
        };
        reader.onerror = function () {
          showToast('Could not read the selected file', { type: 'error' });
        };
        reader.readAsText(file);
      });
    }

    var clearSampleBtn = $('btn-clear-sample-data');
    if (clearSampleBtn) {
      clearSampleBtn.addEventListener('click', function () {
        store.clearSampleData();
        closeModals();
        showToast('All tasks and routines cleared', { undoable: true, type: 'info' });
      });
    }

    var resetDemoBtn = $('btn-reset-demo-data');
    if (resetDemoBtn) {
      resetDemoBtn.addEventListener('click', function () {
        store.resetDemoData();
        closeModals();
        showToast('Demo workspace data restored', { undoable: true, type: 'success' });
      });
    }

    global.document.addEventListener('keydown', function (e) {
      var isCmdOrCtrl = e.metaKey || e.ctrlKey;
      var shell = $('app-shell');
      var gateOpen = Boolean(shell && shell.hidden);

      if (isCmdOrCtrl && e.key.toLowerCase() === 'k' && !gateOpen) {
        e.preventDefault();
        if (activeModalId === 'command-palette-modal') closeModals();
        else openCommandPalette();
        return;
      }

      if (e.key === 'Escape') {
        if (hasAnyOpenModal()) {
          e.preventDefault();
          closeModals();
          return;
        }
        var drawer = $('task-drawer');
        if (drawer && drawer.classList.contains('open')) {
          e.preventDefault();
          if (TaskFlow.TasksUI && typeof TaskFlow.TasksUI.closeDrawer === 'function') {
            TaskFlow.TasksUI.closeDrawer();
          }
          return;
        }
        var sidebar = $('app-sidebar');
        if (sidebar && sidebar.classList.contains('open')) {
          closeMobileSidebar();
        }
        return;
      }

      if (gateOpen) return;

      if (isCmdOrCtrl && e.key.toLowerCase() === 'z' && !e.shiftKey && !isTextInputElement(global.document.activeElement)) {
        if (store.canUndo()) {
          e.preventDefault();
          store.undo();
          showToast('Undid last action');
        }
        return;
      }

      if (hasAnyOpenModal() || isTextInputElement(global.document.activeElement) || e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }

      if (e.key === '?') {
        e.preventDefault();
        openShortcuts();
      } else if (e.key === '/') {
        e.preventDefault();
        if (searchInput) searchInput.focus();
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        if (store.getState().activeView !== 'today') {
          store.setActiveView('today');
        }
        global.setTimeout(function () {
          if (TaskFlow.TasksUI && typeof TaskFlow.TasksUI.focusQuickAdd === 'function') {
            TaskFlow.TasksUI.focusQuickAdd();
          }
        }, 20);
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        store.setSelectedDate(utils.todayKey());
        store.setActiveView('today');
      } else if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        toggleTheme();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        if (timer.getState().running) timer.pause();
        else timer.start();
      } else if (e.key === '1') {
        store.setActiveView('today');
      } else if (e.key === '2') {
        store.setActiveView('upcoming');
      } else if (e.key === '3') {
        store.setActiveView('analytics');
      } else if (e.key === '4') {
        store.setActiveView('routines');
      }
    });
  }

  function updateInstallButtons() {
    var canInstall = Boolean(deferredInstallPrompt);
    var gateBtn = $('btn-install-pwa-gate');
    if (gateBtn) {
      gateBtn.hidden = !canInstall;
    }
    if (TaskFlow.AuthUI && typeof TaskFlow.AuthUI.render === 'function') {
      TaskFlow.AuthUI.render();
    }
  }

  function canInstallPWA() {
    return Boolean(deferredInstallPrompt);
  }

  function triggerPWAInstall() {
    if (!deferredInstallPrompt) return Promise.resolve(false);
    var promptEvent = deferredInstallPrompt;
    deferredInstallPrompt = null;
    updateInstallButtons();
    try {
      var res = promptEvent.prompt();
      if (res && typeof res.then === 'function') {
        return res.then(function () { return true; }).catch(function () { return false; });
      }
      if (promptEvent.userChoice && typeof promptEvent.userChoice.then === 'function') {
        return promptEvent.userChoice.then(function (choice) {
          return Boolean(choice && choice.outcome === 'accepted');
        }).catch(function () { return false; });
      }
    } catch (e) {
      return Promise.resolve(false);
    }
    return Promise.resolve(true);
  }

  function initPWA() {
    if (!global.location || global.location.protocol === 'file:') return;
    if (global.navigator && 'serviceWorker' in global.navigator && global.navigator.serviceWorker && typeof global.navigator.serviceWorker.register === 'function') {
      global.navigator.serviceWorker.register('/sw.js').catch(function () {
        /* ignore SW registration failure in unsupported contexts */
      });
    }
    if (global.addEventListener) {
      global.addEventListener('beforeinstallprompt', function (e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        deferredInstallPrompt = e;
        updateInstallButtons();
      });
      global.addEventListener('appinstalled', function () {
        deferredInstallPrompt = null;
        updateInstallButtons();
        showToast('TaskFlow installed as an app', { type: 'success' });
      });
    }
    var gateInstallBtn = $('btn-install-pwa-gate');
    if (gateInstallBtn) {
      gateInstallBtn.addEventListener('click', function () {
        triggerPWAInstall();
      });
    }
  }

  function init() {
    if (initialized) return;
    initialized = true;

    var store = getStore();
    var timer = getTimer();

    if (typeof store.bootstrap === 'function') {
      store.bootstrap();
    }

    initHeaderTimerWidget();
    bindGlobalEvents();
    initPWA();

    if (TaskFlow.TasksUI && typeof TaskFlow.TasksUI.init === 'function') {
      TaskFlow.TasksUI.init();
    }
    if (TaskFlow.RoutinesUI && typeof TaskFlow.RoutinesUI.init === 'function') {
      TaskFlow.RoutinesUI.init();
    }
    if (TaskFlow.AnalyticsUI && typeof TaskFlow.AnalyticsUI.init === 'function') {
      TaskFlow.AnalyticsUI.init();
    }
    if (TaskFlow.AuthUI && typeof TaskFlow.AuthUI.init === 'function') {
      TaskFlow.AuthUI.init();
    }

    store.subscribe(onStoreChange);

    timer.subscribe(function (tState, meta) {
      updateHeaderTimerWidget(tState);
      if (meta && meta.event === 'complete') {
        var msg = tState.mode === 'break'
          ? 'Break complete — ready for your next focus sprint!'
          : 'Focus session complete! Logged to your progress.';
        showToast(msg, { type: 'success', duration: 6000 });
      }
    });

    onStoreChange(store.getState(), { reason: 'init' });
  }

  TaskFlow.App = {
    init: init,
    showToast: showToast,
    announce: announce,
    openSettings: openSettings,
    openShortcuts: openShortcuts,
    openCommandPalette: openCommandPalette,
    closeModals: closeModals,
    toggleTheme: toggleTheme,
    downloadFile: downloadFile,
    canInstallPWA: canInstallPWA,
    triggerPWAInstall: triggerPWAInstall
  };

  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})(window);
