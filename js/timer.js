(function (global) {
  'use strict';

  var TaskFlow = global.TaskFlow = global.TaskFlow || {};

  var BASE_TITLE = 'TaskFlow — Daily Task Manager & Progress Tracker';

  var MODES = {
    pomodoro: { id: 'pomodoro', label: 'Pomodoro', shortLabel: '25m', durationSeconds: 25 * 60 },
    deep: { id: 'deep', label: 'Deep Focus', shortLabel: '50m', durationSeconds: 50 * 60 },
    break: { id: 'break', label: 'Short Break', shortLabel: '5m', durationSeconds: 5 * 60 },
    stopwatch: { id: 'stopwatch', label: 'Stopwatch', shortLabel: 'SW', durationSeconds: 0 }
  };

  var timerState = {
    mode: 'pomodoro',
    status: 'idle', // 'idle' | 'running' | 'paused' | 'completed'
    running: false,
    durationSeconds: MODES.pomodoro.durationSeconds,
    remainingSeconds: MODES.pomodoro.durationSeconds,
    elapsedSeconds: 0,
    attachedTaskId: null,
    loggedMinutesThisSession: 0
  };

  var intervalId = null;
  var runStartedAtMs = 0;
  var accumulatedElapsedMs = 0;
  var listeners = [];
  var audioCtx = null;

  function getStore() {
    return TaskFlow.Store || null;
  }

  function getAudioContext() {
    if (audioCtx) return audioCtx;
    var Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) return null;
    try {
      audioCtx = new Ctx();
      return audioCtx;
    } catch (e) {
      return null;
    }
  }

  function playTone(ctx, freq, startTime, duration, peakGain, type) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  function playChime(kind) {
    var store = getStore();
    if (store && store.getState().settings && !store.getState().settings.soundEnabled) {
      return;
    }
    var ctx = getAudioContext();
    if (!ctx) return;

    try {
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        ctx.resume().catch(function () {});
      }
      var now = ctx.currentTime + 0.01;
      if (kind === 'check') {
        playTone(ctx, 659.25, now, 0.14, 0.055, 'sine');       // E5
        playTone(ctx, 880.0, now + 0.07, 0.18, 0.05, 'sine');  // A5
      } else {
        // Gentle C5 -> E5 -> G5 completion chime
        playTone(ctx, 523.25, now, 0.42, 0.075, 'triangle');
        playTone(ctx, 659.25, now + 0.14, 0.48, 0.075, 'triangle');
        playTone(ctx, 783.99, now + 0.28, 0.65, 0.08, 'sine');
      }
    } catch (e) {
      /* gracefully ignore blocked audio contexts */
    }
  }

  function formatClock(totalSeconds) {
    var s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    var mm = m < 10 ? '0' + m : String(m);
    var ss = sec < 10 ? '0' + sec : String(sec);
    return h > 0 ? (h + ':' + mm + ':' + ss) : (mm + ':' + ss);
  }

  function getAttachedTask() {
    if (!timerState.attachedTaskId) return null;
    var store = getStore();
    if (!store) return null;
    var tasks = store.getState().tasks;
    for (var i = 0; i < tasks.length; i += 1) {
      if (tasks[i].id === timerState.attachedTaskId) return tasks[i];
    }
    return null;
  }

  function updateDocumentTitle() {
    if (!global.document) return;
    if (!timerState.running) {
      global.document.title = BASE_TITLE;
      return;
    }
    var clockSeconds = timerState.mode === 'stopwatch'
      ? timerState.elapsedSeconds
      : timerState.remainingSeconds;
    var clock = formatClock(clockSeconds);
    var task = getAttachedTask();
    var suffix = task
      ? task.title.slice(0, 28) + (task.title.length > 28 ? '…' : '')
      : MODES[timerState.mode].label;
    global.document.title = clock + ' · ' + suffix + ' — TaskFlow';
  }

  function flushMinutesToTask() {
    if (timerState.mode === 'break') return;
    var totalWholeMins = Math.floor(timerState.elapsedSeconds / 60);
    var delta = totalWholeMins - timerState.loggedMinutesThisSession;
    if (delta <= 0) return;

    timerState.loggedMinutesThisSession = totalWholeMins;
    var task = getAttachedTask();
    var store = getStore();
    if (task && store) {
      store.updateTask(task.id, {
        actualMinutes: Math.max(0, (task.actualMinutes || 0) + delta)
      });
    }
  }

  function getState() {
    return {
      mode: timerState.mode,
      status: timerState.status,
      running: timerState.running,
      durationSeconds: timerState.durationSeconds,
      remainingSeconds: timerState.remainingSeconds,
      elapsedSeconds: timerState.elapsedSeconds,
      attachedTaskId: timerState.attachedTaskId,
      loggedMinutesThisSession: timerState.loggedMinutesThisSession
    };
  }

  function notify(eventType) {
    updateDocumentTitle();
    var snap = getState();
    for (var i = 0; i < listeners.length; i += 1) {
      try {
        listeners[i](snap, { event: eventType || 'tick' });
      } catch (e) {
        if (global.console && global.console.error) {
          global.console.error('Timer listener error:', e);
        }
      }
    }
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    return function unsubscribe() {
      var idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  }

  function clearTicker() {
    if (intervalId !== null) {
      global.clearInterval(intervalId);
      intervalId = null;
    }
  }

  function syncTick() {
    if (!timerState.running) return;
    var nowMs = Date.now();
    var totalMs = accumulatedElapsedMs + (nowMs - runStartedAtMs);
    var totalSeconds = Math.max(0, Math.floor(totalMs / 1000));

    if (timerState.mode === 'stopwatch') {
      if (totalSeconds !== timerState.elapsedSeconds) {
        timerState.elapsedSeconds = totalSeconds;
        timerState.remainingSeconds = 0;
        flushMinutesToTask();
        notify('tick');
      }
      return;
    }

    var cappedSeconds = Math.min(timerState.durationSeconds, totalSeconds);
    var nextRemaining = Math.max(0, timerState.durationSeconds - cappedSeconds);

    if (cappedSeconds !== timerState.elapsedSeconds || nextRemaining !== timerState.remainingSeconds) {
      timerState.elapsedSeconds = cappedSeconds;
      timerState.remainingSeconds = nextRemaining;
      flushMinutesToTask();

      if (nextRemaining === 0) {
        clearTicker();
        timerState.running = false;
        timerState.status = 'completed';
        accumulatedElapsedMs = timerState.durationSeconds * 1000;
        playChime('complete');
        notify('complete');
        return;
      }

      notify('tick');
    }
  }

  function attachTask(taskId) {
    var nextId = taskId || null;
    if (nextId === timerState.attachedTaskId) return;
    flushMinutesToTask();
    timerState.attachedTaskId = nextId;
    timerState.loggedMinutesThisSession = Math.floor(timerState.elapsedSeconds / 60);
    notify('attach');
  }

  function start() {
    if (timerState.running) return;

    if (timerState.status === 'completed') {
      accumulatedElapsedMs = 0;
      timerState.elapsedSeconds = 0;
      timerState.remainingSeconds = timerState.durationSeconds;
      timerState.loggedMinutesThisSession = 0;
    }

    runStartedAtMs = Date.now();
    timerState.running = true;
    timerState.status = 'running';

    clearTicker();
    intervalId = global.setInterval(syncTick, 250);
    notify('start');
  }

  function pause() {
    if (!timerState.running) return;
    accumulatedElapsedMs += Math.max(0, Date.now() - runStartedAtMs);
    var totalSeconds = Math.floor(accumulatedElapsedMs / 1000);
    if (timerState.mode !== 'stopwatch') {
      totalSeconds = Math.min(timerState.durationSeconds, totalSeconds);
      timerState.remainingSeconds = Math.max(0, timerState.durationSeconds - totalSeconds);
    }
    timerState.elapsedSeconds = totalSeconds;
    flushMinutesToTask();
    clearTicker();
    timerState.running = false;
    timerState.status = 'paused';
    notify('pause');
  }

  function reset() {
    if (timerState.running) {
      accumulatedElapsedMs += Math.max(0, Date.now() - runStartedAtMs);
      timerState.elapsedSeconds = Math.floor(accumulatedElapsedMs / 1000);
    }
    flushMinutesToTask();
    clearTicker();
    accumulatedElapsedMs = 0;
    runStartedAtMs = 0;
    timerState.running = false;
    timerState.status = 'idle';
    timerState.elapsedSeconds = 0;
    timerState.remainingSeconds = timerState.durationSeconds;
    timerState.loggedMinutesThisSession = 0;
    notify('reset');
  }

  function setMode(mode) {
    if (!MODES[mode]) return;
    if (timerState.running) {
      pause();
    } else {
      flushMinutesToTask();
    }
    clearTicker();
    accumulatedElapsedMs = 0;
    runStartedAtMs = 0;
    timerState.mode = mode;
    timerState.durationSeconds = MODES[mode].durationSeconds;
    timerState.remainingSeconds = MODES[mode].durationSeconds;
    timerState.elapsedSeconds = 0;
    timerState.status = 'idle';
    timerState.running = false;
    timerState.loggedMinutesThisSession = 0;
    notify('mode');
  }

  function getModes() {
    return Object.keys(MODES).map(function (k) { return Object.assign({}, MODES[k]); });
  }

  // Detach silently if attached task is deleted from Store
  if (TaskFlow.Store && typeof TaskFlow.Store.subscribe === 'function') {
    TaskFlow.Store.subscribe(function (storeState) {
      if (!timerState.attachedTaskId) return;
      var exists = storeState.tasks.some(function (t) { return t.id === timerState.attachedTaskId; });
      if (!exists) {
        timerState.attachedTaskId = null;
        notify('detach');
      }
    });
  }

  // Flush any completed focus minutes cleanly when backgrounding or closing tab
  if (global.addEventListener) {
    global.addEventListener('pagehide', function () {
      flushMinutesToTask();
    });
  }
  if (global.document && global.document.addEventListener) {
    global.document.addEventListener('visibilitychange', function () {
      if (global.document.visibilityState === 'hidden') {
        flushMinutesToTask();
      }
    });
  }

  TaskFlow.Timer = {
    attachTask: attachTask,
    start: start,
    pause: pause,
    reset: reset,
    setMode: setMode,
    getState: getState,
    subscribe: subscribe,
    playChime: playChime,
    formatClock: formatClock,
    getModes: getModes
  };
})(window);
