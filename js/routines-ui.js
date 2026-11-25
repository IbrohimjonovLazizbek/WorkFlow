(function (global) {
  'use strict';

  var TaskFlow = (global.TaskFlow = global.TaskFlow || {});

  var MOODS = [
    { value: 1, label: 'Drained', emoji: '😫' },
    { value: 2, label: 'Low', emoji: '😕' },
    { value: 3, label: 'Steady', emoji: '🙂' },
    { value: 4, label: 'Focused', emoji: '⚡' },
    { value: 5, label: 'Peak', emoji: '🔥' }
  ];

  var CATEGORIES = [
    { value: 'work', label: 'Work' },
    { value: 'health', label: 'Health' },
    { value: 'learning', label: 'Learning' },
    { value: 'personal', label: 'Personal' },
    { value: 'admin', label: 'Admin' }
  ];

  var PRIORITIES = [
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' }
  ];

  var TIME_BLOCKS = [
    { value: 'morning', label: 'Morning' },
    { value: 'afternoon', label: 'Afternoon' },
    { value: 'evening', label: 'Evening' },
    { value: 'anytime', label: 'Anytime' }
  ];

  var SCHEDULES = [
    { value: 'daily', label: 'Every Day' },
    { value: 'weekdays', label: 'Weekdays (Mon–Fri)' }
  ];

  var uiState = {
    initialized: false,
    lastCheckinDate: null,
    formOpen: false,
    editingRoutineId: null,
    debounceTimer: null
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
    return getUtils().escapeHtml(str == null ? '' : String(str));
  }

  function notifyToast(msg, options) {
    var app = getApp();
    if (app && typeof app.showToast === 'function') {
      app.showToast(msg, options || {});
    }
  }

  function parseLocalDate(dateStr) {
    var parts = String(dateStr || '').split('-');
    if (parts.length !== 3) {
      return new Date();
    }
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0);
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

  function isWeekdayDate(dateStr) {
    var dow = parseLocalDate(dateStr).getDay();
    return dow >= 1 && dow <= 5;
  }

  function getPendingRoutinesForDate(dateStr) {
    var store = getStore();
    var state = store.getState();
    var routines = state.routines || [];
    var tasks = store.getTasksForDate(dateStr);
    var existingRoutineIds = {};
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].routineId) {
        existingRoutineIds[tasks[i].routineId] = true;
      }
    }
    var isWeekday = isWeekdayDate(dateStr);
    return routines.filter(function (r) {
      if (!r.active || existingRoutineIds[r.id]) {
        return false;
      }
      if (r.schedule === 'weekdays' && !isWeekday) {
        return false;
      }
      return true;
    });
  }

  function getAppliedCountToday(dateStr) {
    var store = getStore();
    var tasks = store.getTasksForDate(dateStr);
    var map = {};
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].routineId) {
        map[tasks[i].routineId] = true;
      }
    }
    return map;
  }

  function getStreakValue(routineId) {
    var store = getStore();
    if (typeof store.getRoutineStreak !== 'function') {
      return 0;
    }
    var val = store.getRoutineStreak(routineId);
    if (val && typeof val === 'object') {
      return Number(val.current || val.streak || 0);
    }
    return Number(val || 0);
  }

  function isElementInside(el, container) {
    return Boolean(el && container && (el === container || container.contains(el)));
  }

  function renderCheckin() {
    var container = document.getElementById('daily-checkin-container');
    if (!container) {
      return;
    }

    var store = getStore();
    var utils = getUtils();
    var state = store.getState();
    var dateStr = state.selectedDate || utils.todayKey();
    var reflection = (state.reflections && state.reflections[dateStr]) || {
      mood: null,
      intention: '',
      reflection: '',
      updatedAt: null
    };
    var pendingRoutines = getPendingRoutinesForDate(dateStr);

    var sameDate = uiState.lastCheckinDate === dateStr;
    if (sameDate && isElementInside(document.activeElement, container)) {
      var moodBtns = container.querySelectorAll('.mood-btn');
      for (var m = 0; m < moodBtns.length; m++) {
        var btnVal = Number(moodBtns[m].getAttribute('data-mood'));
        var isActive = reflection.mood === btnVal;
        moodBtns[m].classList.toggle('active', isActive);
        moodBtns[m].setAttribute('aria-pressed', isActive ? 'true' : 'false');
      }
      var statusEl = container.querySelector('.checkin-saved-status');
      if (statusEl && reflection.updatedAt) {
        statusEl.textContent = 'Saved';
      }
      return;
    }

    uiState.lastCheckinDate = dateStr;

    var moodButtonsHtml = MOODS.map(function (m) {
      var active = reflection.mood === m.value ? ' active' : '';
      return (
        '<button type="button" class="mood-btn' + active + '" data-action="set-mood" data-mood="' + m.value + '" aria-pressed="' + (active ? 'true' : 'false') + '">' +
          '<span class="mood-emoji" aria-hidden="true">' + m.emoji + '</span>' +
          '<span class="mood-label">' + esc(m.label) + '</span>' +
        '</button>'
      );
    }).join('');

    var applyBtn = pendingRoutines.length > 0
      ? '<button type="button" class="btn btn-secondary btn-sm" data-action="apply-routines-today">Apply Daily Routines (+' + pendingRoutines.length + ')</button>'
      : '<span class="checkin-routines-done">Daily routines synced ✓</span>';

    var dateLabel = dateStr === utils.todayKey() ? 'Today' : utils.formatDateLabel(dateStr);

    container.innerHTML =
      '<section class="checkin-card" aria-label="Daily Check-in and Reflection">' +
        '<header class="checkin-header">' +
          '<div>' +
            '<h3 class="checkin-title">Daily Check-in &amp; Reflection</h3>' +
            '<p class="checkin-subtitle">' + esc(dateLabel) + ' • <span class="checkin-saved-status">' + (reflection.updatedAt ? 'Saved' : 'Auto-saves as you type') + '</span></p>' +
          '</div>' +
          '<div class="checkin-header-actions">' + applyBtn + '</div>' +
        '</header>' +
        '<div class="checkin-grid">' +
          '<div class="form-group">' +
            '<label class="form-label" for="checkin-intention">Morning Intention</label>' +
            '<input type="text" id="checkin-intention" class="form-input" data-checkin-field="intention" value="' + esc(reflection.intention || '') + '" placeholder="What is the one thing that would make today a win?">' +
          '</div>' +
          '<div class="form-group">' +
            '<span class="form-label">Energy &amp; Mood</span>' +
            '<div class="mood-selector" role="group" aria-label="Mood selector">' + moodButtonsHtml + '</div>' +
          '</div>' +
          '<div class="form-group checkin-reflection-group">' +
            '<label class="form-label" for="checkin-reflection">Evening Reflection</label>' +
            '<textarea id="checkin-reflection" class="checkin-textarea form-textarea" rows="3" data-checkin-field="reflection" placeholder="What went well today? What is the #1 priority tomorrow?">' + esc(reflection.reflection || '') + '</textarea>' +
          '</div>' +
        '</div>' +
      '</section>';
  }

  function renderRoutineForm(editingRoutine) {
    if (!uiState.formOpen) {
      return '';
    }
    var r = editingRoutine || {
      title: '',
      category: 'health',
      priority: 'medium',
      timeBlock: 'morning',
      schedule: 'daily',
      estimatedMinutes: 30,
      subtasks: []
    };
    var subtasksText = Array.isArray(r.subtasks) ? r.subtasks.join('\n') : '';

    return (
      '<form id="routine-editor-form" class="routine-form-card" autocomplete="off">' +
        '<div class="routine-form-header">' +
          '<h3>' + (editingRoutine ? 'Edit Routine' : 'Create Daily Routine') + '</h3>' +
          '<button type="button" class="btn btn-icon btn-ghost btn-sm" data-action="close-routine-form" aria-label="Close form">✕</button>' +
        '</div>' +
        '<div class="routine-form-grid">' +
          '<div class="form-group routine-form-span2">' +
            '<label class="form-label" for="routine-title">Routine Title</label>' +
            '<input type="text" id="routine-title" class="form-input" value="' + esc(r.title) + '" placeholder="e.g., Morning Deep Work Prep" required>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="routine-category">Category</label>' +
            '<select id="routine-category" class="form-select">' + buildOptionsHtml(CATEGORIES, r.category || 'work') + '</select>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="routine-priority">Priority</label>' +
            '<select id="routine-priority" class="form-select">' + buildOptionsHtml(PRIORITIES, r.priority || 'medium') + '</select>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="routine-timeblock">Time Block</label>' +
            '<select id="routine-timeblock" class="form-select">' + buildOptionsHtml(TIME_BLOCKS, r.timeBlock || 'morning') + '</select>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="routine-schedule">Schedule</label>' +
            '<select id="routine-schedule" class="form-select">' + buildOptionsHtml(SCHEDULES, r.schedule || 'daily') + '</select>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="routine-duration">Estimated Minutes</label>' +
            '<input type="number" id="routine-duration" class="form-input" min="5" max="480" step="5" value="' + esc(r.estimatedMinutes || 30) + '">' +
          '</div>' +
          '<div class="form-group routine-form-span2">' +
            '<label class="form-label" for="routine-subtasks">Default Subtasks (one per line)</label>' +
            '<textarea id="routine-subtasks" class="form-textarea" rows="3" placeholder="Review top 3 priorities&#10;Clear urgent messages&#10;Block focus session">' + esc(subtasksText) + '</textarea>' +
          '</div>' +
        '</div>' +
        '<div class="routine-form-footer">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-action="close-routine-form">Cancel</button>' +
          '<button type="submit" class="btn btn-primary btn-sm">' + (editingRoutine ? 'Save Routine' : 'Create Routine') + '</button>' +
        '</div>' +
      '</form>'
    );
  }

  function renderRoutinesView() {
    var container = document.getElementById('view-routines');
    if (!container || container.hidden) {
      return;
    }

    var store = getStore();
    var utils = getUtils();
    var state = store.getState();
    var routines = state.routines || [];
    var today = utils.todayKey();
    var todayIsWeekday = isWeekdayDate(today);
    var appliedTodayMap = getAppliedCountToday(today);
    var pendingToday = getPendingRoutinesForDate(today);

    var editingRoutine = null;
    if (uiState.editingRoutineId) {
      for (var i = 0; i < routines.length; i++) {
        if (routines[i].id === uiState.editingRoutineId) {
          editingRoutine = routines[i];
          break;
        }
      }
    }

    var cardsHtml = routines.length > 0
      ? routines
          .map(function (r) {
            var streak = getStreakValue(r.id);
            var subtasks = Array.isArray(r.subtasks) ? r.subtasks : [];
            var previewLimit = 4;
            var previewItems = subtasks.slice(0, previewLimit).map(function (st) {
              return '<li>' + esc(st) + '</li>';
            }).join('');
            if (subtasks.length > previewLimit) {
              previewItems += '<li class="routine-subtask-more">+' + (subtasks.length - previewLimit) + ' more steps</li>';
            }
            var subtasksBlock = subtasks.length > 0
              ? '<ul class="routine-subtask-preview">' + previewItems + '</ul>'
              : '';
            var isAppliedToday = Boolean(appliedTodayMap[r.id]);
            var syncLabel = isAppliedToday
              ? 'Added to Today ✓'
              : (!r.active
                ? 'Paused'
                : (r.schedule === 'weekdays' && !todayIsWeekday ? 'Weekdays only' : 'Not yet in Today'));

            return (
              '<article class="routine-card' + (r.active ? '' : ' is-paused') + '" data-routine-id="' + esc(r.id) + '">' +
                '<div class="routine-card-top">' +
                  '<div class="routine-card-heading">' +
                    '<h3 class="routine-title">' + esc(r.title) + '</h3>' +
                    '<span class="routine-streak" title="Current completion streak">' + streak + 'd streak</span>' +
                  '</div>' +
                  '<label class="toggle-switch" title="' + (r.active ? 'Active routine' : 'Paused routine') + '">' +
                    '<input type="checkbox" data-action="toggle-routine-active"' + (r.active ? ' checked' : '') + ' aria-label="Toggle routine active">' +
                    '<span class="toggle-slider"></span>' +
                  '</label>' +
                '</div>' +
                '<div class="routine-meta">' +
                  '<span class="category-badge" data-category="' + esc(r.category) + '">' + esc(labelFor(CATEGORIES, r.category)) + '</span>' +
                  '<span class="priority-badge" data-priority="' + esc(r.priority) + '">' + esc(labelFor(PRIORITIES, r.priority)) + '</span>' +
                  '<span class="time-badge">' + esc(labelFor(TIME_BLOCKS, r.timeBlock)) + '</span>' +
                  '<span class="time-badge">' + esc(r.schedule === 'weekdays' ? 'Weekdays' : 'Every Day') + '</span>' +
                  (r.estimatedMinutes ? '<span class="time-badge">' + esc(utils.formatMinutes(r.estimatedMinutes)) + '</span>' : '') +
                '</div>' +
                subtasksBlock +
                '<div class="routine-card-footer">' +
                  '<span class="routine-sync-status">' + esc(syncLabel) + '</span>' +
                  '<div class="routine-card-actions">' +
                    '<button type="button" class="btn btn-ghost btn-sm" data-action="edit-routine">Edit</button>' +
                    '<button type="button" class="btn btn-ghost btn-sm btn-danger-ghost" data-action="delete-routine">Delete</button>' +
                  '</div>' +
                '</div>' +
              '</article>'
            );
          })
          .join('')
      : '<div class="empty-state">' +
          '<h3 class="empty-state-title">No daily routines configured</h3>' +
          '<p class="empty-state-desc">Create recurring checklists for morning planning, deep work, workouts, or evening shutdowns.</p>' +
          '<button type="button" class="btn btn-primary btn-sm" data-action="open-routine-form">+ Create First Routine</button>' +
        '</div>';

    var populateLabel = pendingToday.length > 0
      ? 'Populate Today\'s Tasks (+' + pendingToday.length + ')'
      : 'Today\'s Tasks Populated ✓';

    var existingForm = container.querySelector('#routine-editor-form');
    if (uiState.formOpen && existingForm && isElementInside(document.activeElement, existingForm)) {
      var gridEl = container.querySelector('.routine-grid');
      var popBtn = container.querySelector('[data-action="populate-today"]');
      if (gridEl) {
        gridEl.innerHTML = cardsHtml;
      }
      if (popBtn) {
        popBtn.disabled = pendingToday.length === 0;
        popBtn.textContent = populateLabel;
      }
      return;
    }

    container.innerHTML =
      '<div class="routines-header">' +
        '<div>' +
          '<h2>Daily Routines &amp; Habits</h2>' +
          '<p class="routines-subtitle">Build repeatable daily structures and stamp them into Today with one click.</p>' +
        '</div>' +
        '<div class="routines-header-actions">' +
          '<button type="button" class="btn btn-secondary btn-sm" data-action="populate-today"' + (pendingToday.length === 0 ? ' disabled' : '') + '>' + esc(populateLabel) + '</button>' +
          '<button type="button" class="btn btn-primary btn-sm" data-action="open-routine-form">+ New Routine</button>' +
        '</div>' +
      '</div>' +
      renderRoutineForm(editingRoutine) +
      '<div class="routine-grid">' + cardsHtml + '</div>';
  }

  function applyRoutinesFor(dateStr) {
    var store = getStore();
    var res = store.applyRoutinesToDate(dateStr);
    var added = typeof res === 'number' ? res : (Array.isArray(res) ? res.length : (res && res.addedCount) || 0);
    if (added > 0) {
      notifyToast('Added ' + added + ' routine ' + (added === 1 ? 'task' : 'tasks'));
    } else {
      notifyToast('All active routines are already added');
    }
  }

  function bindEvents() {
    var todayView = document.getElementById('view-today');
    var routinesView = document.getElementById('view-routines');

    if (todayView) {
      todayView.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-action]');
        if (!btn) {
          return;
        }
        var action = btn.getAttribute('data-action');
        var store = getStore();
        var dateStr = store.getState().selectedDate || getUtils().todayKey();
        if (action === 'set-mood') {
          var mood = Number(btn.getAttribute('data-mood'));
          var current = (store.getState().reflections && store.getState().reflections[dateStr]) || {};
          var nextMood = current.mood === mood ? null : mood;
          store.saveReflection(dateStr, { mood: nextMood });
        } else if (action === 'apply-routines-today') {
          applyRoutinesFor(dateStr);
        }
      });

      todayView.addEventListener('input', function (e) {
        var field = e.target && e.target.getAttribute('data-checkin-field');
        if (!field) {
          return;
        }
        var store = getStore();
        var dateStr = store.getState().selectedDate || getUtils().todayKey();
        var value = e.target.value;
        clearTimeout(uiState.debounceTimer);
        uiState.debounceTimer = setTimeout(function () {
          var patch = {};
          patch[field] = value;
          store.saveReflection(dateStr, patch);
        }, 300);
      });

      var flushReflectionField = function (targetEl) {
        var field = targetEl && targetEl.getAttribute('data-checkin-field');
        if (!field) return;
        clearTimeout(uiState.debounceTimer);
        uiState.debounceTimer = null;
        var store = getStore();
        var dateStr = store.getState().selectedDate || getUtils().todayKey();
        var existing = (store.getState().reflections && store.getState().reflections[dateStr]) || {};
        if ((existing[field] || '') === targetEl.value) return;
        var patch = {};
        patch[field] = targetEl.value;
        store.saveReflection(dateStr, patch);
      };

      todayView.addEventListener('focusout', function (e) {
        flushReflectionField(e.target);
      });

      window.addEventListener('pagehide', function () {
        var active = document.activeElement;
        if (active && todayView.contains(active)) {
          flushReflectionField(active);
        }
      });

      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') {
          var active = document.activeElement;
          if (active && todayView.contains(active)) {
            flushReflectionField(active);
          }
        }
      });
    }

    if (routinesView) {
      routinesView.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-action]');
        if (!btn || btn.disabled) {
          return;
        }
        var action = btn.getAttribute('data-action');
        var card = btn.closest('[data-routine-id]');
        var routineId = card ? card.getAttribute('data-routine-id') : null;
        var store = getStore();

        switch (action) {
          case 'open-routine-form':
            uiState.editingRoutineId = null;
            uiState.formOpen = true;
            renderRoutinesView();
            var titleEl = document.getElementById('routine-title');
            if (titleEl) {
              titleEl.focus();
            }
            break;
          case 'close-routine-form':
            uiState.formOpen = false;
            uiState.editingRoutineId = null;
            renderRoutinesView();
            break;
          case 'populate-today':
            applyRoutinesFor(getUtils().todayKey());
            break;
          case 'edit-routine':
            if (routineId) {
              uiState.editingRoutineId = routineId;
              uiState.formOpen = true;
              renderRoutinesView();
              var editTitleEl = document.getElementById('routine-title');
              if (editTitleEl) {
                editTitleEl.focus();
              }
            }
            break;
          case 'delete-routine':
            if (routineId) {
              store.deleteRoutine(routineId);
              if (uiState.editingRoutineId === routineId) {
                uiState.editingRoutineId = null;
                uiState.formOpen = false;
              }
              notifyToast('Routine deleted', { undoable: true });
            }
            break;
          default:
            break;
        }
      });

      routinesView.addEventListener('change', function (e) {
        var el = e.target;
        if (!el || el.getAttribute('data-action') !== 'toggle-routine-active') {
          return;
        }
        var card = el.closest('[data-routine-id]');
        if (card) {
          getStore().updateRoutine(card.getAttribute('data-routine-id'), { active: el.checked });
        }
      });

      routinesView.addEventListener('submit', function (e) {
        if (!e.target || e.target.id !== 'routine-editor-form') {
          return;
        }
        e.preventDefault();
        var title = (document.getElementById('routine-title').value || '').trim();
        if (!title) {
          return;
        }
        var subtasksRaw = document.getElementById('routine-subtasks').value || '';
        var subtasks = subtasksRaw
          .split(/\r?\n/)
          .map(function (s) { return s.trim(); })
          .filter(Boolean);

        var payload = {
          title: title,
          category: document.getElementById('routine-category').value,
          priority: document.getElementById('routine-priority').value,
          timeBlock: document.getElementById('routine-timeblock').value,
          schedule: document.getElementById('routine-schedule').value,
          estimatedMinutes: Math.max(0, parseInt(document.getElementById('routine-duration').value, 10) || 0),
          subtasks: subtasks
        };

        var store = getStore();
        if (uiState.editingRoutineId) {
          store.updateRoutine(uiState.editingRoutineId, payload);
          notifyToast('Routine updated');
        } else {
          payload.active = true;
          store.addRoutine(payload);
          notifyToast('Routine created');
        }
        uiState.formOpen = false;
        uiState.editingRoutineId = null;
        renderRoutinesView();
      });
    }
  }

  function render() {
    var activeView = getStore().getState().activeView || 'today';
    if (activeView === 'today') {
      renderCheckin();
    } else if (activeView === 'routines') {
      renderRoutinesView();
    }
  }

  function init() {
    if (uiState.initialized) {
      return;
    }
    uiState.initialized = true;
    bindEvents();
  }

  TaskFlow.RoutinesUI = {
    init: init,
    render: render
  };
})(window);
