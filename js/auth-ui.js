(function (global) {
  'use strict';

  var TaskFlow = global.TaskFlow = global.TaskFlow || {};

  var GUEST_PREF_KEY = 'taskflow_guest_mode';

  var AUTH_ERROR_MESSAGES = {
    google_not_configured: 'Google OAuth is not configured on this server yet. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and SESSION_SECRET in Cloudflare Pages settings (or continue in Local Guest Mode).',
    oauth_state_mismatch: 'Your Google sign-in session expired or did not match. Please try signing in again.',
    oauth_expired: 'Your Google sign-in attempt timed out. Please try again.',
    oauth_exchange_failed: 'Could not complete Google token verification. Check your redirect URI and OAuth credentials.',
    oauth_cancelled: 'Google sign-in was cancelled. You can retry anytime or use Local Guest Mode.',
    session_secret_missing: 'Server SESSION_SECRET is missing in Cloudflare Pages environment variables.'
  };

  var COMMON_TIMEZONES = [
    'Asia/Tashkent',
    'UTC',
    'Europe/London',
    'Europe/Berlin',
    'Europe/Istanbul',
    'Europe/Moscow',
    'Asia/Dubai',
    'Asia/Almaty',
    'Asia/Tokyo',
    'America/New_York',
    'America/Chicago',
    'America/Los_Angeles'
  ];

  var LIVE_SYNC_INTERVAL_MS = 8000;
  var liveSyncTimerId = null;
  var lastRefreshAtMs = 0;
  var deferredRefresh = false;

  var uiState = {
    initialized: false,
    activeTab: 'account', // 'account' | 'telegram'
    modalOpen: false,
    authError: null,
    telegramHint: null,
    pairingData: null, // { code, botUsername, deepLink, expiresAt }
    busyAction: null
  };

  function $(id) {
    return global.document ? global.document.getElementById(id) : null;
  }

  function getStore() {
    return TaskFlow.Store;
  }

  function getUtils() {
    return TaskFlow.Utils;
  }

  function getApp() {
    return TaskFlow.App || null;
  }

  function toast(msg, opts) {
    var app = getApp();
    if (app && typeof app.showToast === 'function') {
      app.showToast(msg, opts || {});
    }
  }

  function readGuestFlag() {
    try {
      return global.localStorage && global.localStorage.getItem(GUEST_PREF_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function writeGuestFlag(val) {
    try {
      if (!global.localStorage) return;
      if (val) global.localStorage.setItem(GUEST_PREF_KEY, '1');
      else global.localStorage.removeItem(GUEST_PREF_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  function fetchJson(url, opts) {
    if (typeof global.fetch !== 'function') {
      return Promise.reject(new Error('Fetch unavailable'));
    }
    var reqOpts = Object.assign({ credentials: 'same-origin' }, opts || {});
    return global.fetch(url, reqOpts).then(function (res) {
      var ct = res.headers && res.headers.get ? (res.headers.get('content-type') || '') : '';
      if (ct.indexOf('application/json') === -1) {
        var err = new Error('Non-JSON response (' + res.status + ')');
        err.status = res.status;
        err.nonJson = true;
        throw err;
      }
      return res.json().then(function (data) {
        if (!res.ok) {
          var apiErr = new Error((data && data.error) || ('Request failed (' + res.status + ')'));
          apiErr.status = res.status;
          apiErr.data = data;
          throw apiErr;
        }
        return data;
      });
    });
  }

  function showAuthGate() {
    var gate = $('auth-gate');
    var shell = $('app-shell');
    if (gate) gate.hidden = false;
    if (shell) shell.hidden = true;
    renderAuthGate();
  }

  function showAppShell() {
    var gate = $('auth-gate');
    var shell = $('app-shell');
    if (gate) gate.hidden = true;
    if (shell) shell.hidden = false;
  }

  function getInitials(name, email) {
    var src = (name || email || 'U').trim();
    var parts = src.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return src.slice(0, 2).toUpperCase();
  }

  function formatSyncLabel(syncState) {
    if (syncState === 'synced') return 'Cloud Synced';
    if (syncState === 'syncing') return 'Syncing...';
    if (syncState === 'error') return 'Sync Error';
    return 'Local Mode';
  }

  function renderAvatarHtml(user) {
    var utils = getUtils();
    if (!user) {
      return '<span class="cabinet-avatar">L</span>';
    }
    var initials = utils.escapeHtml(getInitials(user.name, user.email));
    if (user.avatarUrl && /^https:\/\//i.test(user.avatarUrl)) {
      return '<span class="cabinet-avatar has-img">' +
        '<img src="' + utils.escapeHtml(user.avatarUrl) + '" alt="" referrerpolicy="no-referrer">' +
      '</span>';
    }
    return '<span class="cabinet-avatar">' + initials + '</span>';
  }

  function renderAuthGate() {
    var gate = $('auth-gate');
    if (!gate || gate.hidden) return;

    var utils = getUtils();
    var auth = getStore().getAuthState();
    var noticeEl = $('auth-notice');
    var statusEl = $('auth-gate-status');
    var googleBtn = $('btn-google-signin');

    if (noticeEl) {
      var msg = '';
      if (uiState.authError) {
        msg = AUTH_ERROR_MESSAGES[uiState.authError] || ('Sign-in notice: ' + uiState.authError);
      } else if (uiState.telegramHint) {
        msg = uiState.telegramHint;
      }
      noticeEl.hidden = !msg;
      noticeEl.textContent = msg;
    }

    if (statusEl) {
      if (auth.authStatus && !auth.authStatus.googleConfigured) {
        statusEl.textContent = 'Google OAuth keys are not configured yet on this deployment — Local Guest Mode works immediately.';
      } else if (auth.authStatus && auth.authStatus.telegramConfigured && auth.authStatus.telegramBotUsername) {
        statusEl.textContent = 'Telegram Bot @' + auth.authStatus.telegramBotUsername + ' ready for pairing inside your cabinet.';
      } else {
        statusEl.textContent = 'Each Google account opens an isolated workspace with zero shared data.';
      }
    }

    if (googleBtn) {
      var disabled = auth.authStatus && auth.authStatus.googleConfigured === false;
      googleBtn.classList.toggle('is-unconfigured', Boolean(disabled));
      googleBtn.setAttribute('aria-description', disabled ? 'Google OAuth requires server configuration' : '');
    }

    void utils;
  }

  function renderSidebarCabinet() {
    var host = $('sidebar-user-cabinet');
    if (!host) return;
    var utils = getUtils();
    var auth = getStore().getAuthState();
    var user = auth.user;
    var syncLabel = formatSyncLabel(auth.syncState);

    if (auth.authenticated && user) {
      host.setAttribute('title', 'Open Personal Cabinet (' + user.email + ')');
      host.innerHTML =
        renderAvatarHtml(user) +
        '<div class="cabinet-info">' +
          '<div class="cabinet-name">' + utils.escapeHtml(user.name) + '</div>' +
          '<div class="cabinet-email">' + utils.escapeHtml(user.email || 'Google Cabinet') + '</div>' +
          '<span class="sync-badge has-dot" data-sync="' + utils.escapeHtml(auth.syncState) + '">' +
            '<span class="sync-dot" aria-hidden="true"></span>' +
            '<span>' + utils.escapeHtml(syncLabel) + '</span>' +
          '</span>' +
        '</div>';
    } else {
      host.setAttribute('title', 'Sign in with Google or manage sync');
      host.innerHTML =
        '<span class="cabinet-avatar">G</span>' +
        '<div class="cabinet-info">' +
          '<div class="cabinet-name">Local Guest</div>' +
          '<div class="cabinet-email">Sign in for cloud sync</div>' +
          '<span class="sync-badge has-dot" data-sync="local">' +
            '<span class="sync-dot" aria-hidden="true"></span>' +
            '<span>Local Mode</span>' +
          '</span>' +
        '</div>';
    }
  }

  function renderHeaderAccountPill() {
    var pill = $('header-account-pill');
    if (!pill) return;
    var utils = getUtils();
    var auth = getStore().getAuthState();
    var user = auth.user;

    if (auth.authenticated && user) {
      var firstName = (user.name || 'Account').split(' ')[0];
      pill.setAttribute('data-sync', auth.syncState);
      pill.setAttribute('aria-label', 'Personal cabinet for ' + user.name + ' (' + formatSyncLabel(auth.syncState) + ')');
      pill.setAttribute('title', user.email + ' • ' + formatSyncLabel(auth.syncState));
      pill.innerHTML =
        renderAvatarHtml(user) +
        '<span class="account-pill-name">' + utils.escapeHtml(firstName) + '</span>' +
        '<span class="account-pill-dot" aria-hidden="true"></span>';
    } else {
      pill.setAttribute('data-sync', 'local');
      pill.setAttribute('aria-label', 'Open Personal Cabinet or Sign in with Google');
      pill.setAttribute('title', 'Sign in with Google for Cloud Cabinet & Telegram');
      pill.innerHTML =
        '<span class="cabinet-avatar">G</span>' +
        '<span class="account-pill-name">Sign in</span>' +
        '<span class="account-pill-dot" aria-hidden="true"></span>';
    }
  }

  function buildTimezoneOptionsHtml(currentTz) {
    var utils = getUtils();
    var list = COMMON_TIMEZONES.slice();
    try {
      var localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (localTz && list.indexOf(localTz) === -1) {
        list.unshift(localTz);
      }
    } catch (e) {
      /* ignore */
    }
    if (currentTz && list.indexOf(currentTz) === -1) {
      list.unshift(currentTz);
    }
    return list.map(function (tz) {
      return '<option value="' + utils.escapeHtml(tz) + '"' + (tz === currentTz ? ' selected' : '') + '>' + utils.escapeHtml(tz) + '</option>';
    }).join('');
  }

  function buildHourOptionsHtml(selectedHour) {
    var html = '';
    for (var h = 0; h < 24; h += 1) {
      var label = (h < 10 ? '0' + h : String(h)) + ':00';
      html += '<option value="' + h + '"' + (h === selectedHour ? ' selected' : '') + '>' + label + '</option>';
    }
    return html;
  }

  function renderSetupChecklist(kind, origin) {
    var utils = getUtils();
    var safeOrigin = utils.escapeHtml(origin || (global.location ? global.location.origin : 'https://workflow.myclass.uz'));
    if (kind === 'google') {
      return '<div class="setup-checklist">' +
        '<strong style="font-size:var(--text-xs);color:var(--text-primary);">Admin Setup: Enable Google Sign-In</strong>' +
        '<div class="setup-step"><span>1. In Google Cloud Console, create an OAuth 2.0 Web Client with redirect URI <code class="code-pill">' + safeOrigin + '/api/auth/google/callback</code>.</span></div>' +
        '<div class="setup-step"><span>2. Add Cloudflare Pages environment variables: <code class="code-pill">GOOGLE_CLIENT_ID</code>, <code class="code-pill">GOOGLE_CLIENT_SECRET</code>, and <code class="code-pill">SESSION_SECRET</code>.</span></div>' +
      '</div>';
    }
    return '<div class="setup-checklist">' +
      '<strong style="font-size:var(--text-xs);color:var(--text-primary);">Admin Setup: Enable Telegram Bot</strong>' +
      '<div class="setup-step"><span>1. Create a bot via @BotFather and add <code class="code-pill">TELEGRAM_BOT_TOKEN</code>, <code class="code-pill">TELEGRAM_BOT_USERNAME</code>, and <code class="code-pill">TELEGRAM_WEBHOOK_SECRET</code> to Cloudflare Pages &amp; cron-worker.</span></div>' +
      '<div class="setup-step"><span>2. Register webhook URL <code class="code-pill">' + safeOrigin + '/api/telegram/webhook</code> with secret token header.</span></div>' +
    '</div>';
  }

  function renderCabinetModal() {
    var modal = $('cabinet-modal');
    var body = $('cabinet-modal-body');
    if (!modal || !body || modal.hidden) return;

    var utils = getUtils();
    var store = getStore();
    var auth = store.getAuthState();
    var user = auth.user;
    var status = auth.authStatus || {};
    var guestSummary = store.getLocalGuestSummary();
    var tab = uiState.activeTab === 'telegram' ? 'telegram' : 'account';
    var origin = status.origin || (global.location && global.location.protocol !== 'file:' ? global.location.origin : '');
    var isFile = global.location && global.location.protocol === 'file:';

    var tabsHtml =
      '<div class="cabinet-tabs" role="tablist" aria-label="Cabinet sections">' +
        '<button type="button" role="tab" aria-selected="' + (tab === 'account' ? 'true' : 'false') + '" class="cabinet-tab' + (tab === 'account' ? ' active' : '') + '" data-cabinet-tab="account">Google Account &amp; Sync</button>' +
        '<button type="button" role="tab" aria-selected="' + (tab === 'telegram' ? 'true' : 'false') + '" class="cabinet-tab' + (tab === 'telegram' ? ' active' : '') + '" data-cabinet-tab="telegram">Telegram Bot</button>' +
      '</div>';

    var contentHtml = '';
    if (tab === 'account') {
      if (auth.authenticated && user) {
        var syncErrHtml = auth.syncState === 'error' && auth.lastSyncError
          ? '<p style="font-size:var(--text-xs);color:var(--danger-text);margin-top:4px;">' + utils.escapeHtml(auth.lastSyncError) + '</p>'
          : '';

        var importHtml = '';
        if (guestSummary.tasksCount > 0) {
          importHtml =
            '<div class="rollover-banner">' +
              '<div class="rollover-banner-row">' +
                '<div class="rollover-banner-info" style="flex-direction:column;align-items:flex-start;gap:2px;">' +
                  '<strong>Local Guest Tasks Found</strong>' +
                  '<span style="font-size:var(--text-xs);color:var(--text-secondary);">' + guestSummary.tasksCount + ' tasks &amp; ' + guestSummary.routinesCount + ' routines are stored locally in this browser' + (guestSummary.isSampleData ? ' (demo dataset)' : '') + '.</span>' +
                '</div>' +
                '<div class="rollover-banner-actions">' +
                  '<button type="button" class="btn btn-primary btn-sm" data-cabinet-action="import-guest-merge"' + (uiState.busyAction ? ' disabled' : '') + '>Merge into Cloud</button>' +
                  '<button type="button" class="btn btn-secondary btn-sm" data-cabinet-action="import-guest-replace"' + (uiState.busyAction ? ' disabled' : '') + '>Replace Cloud</button>' +
                '</div>' +
              '</div>' +
            '</div>';
        }

        contentHtml =
          '<div class="cabinet-profile-card">' +
            '<div class="cabinet-profile-main">' +
              renderAvatarHtml(user) +
              '<div class="cabinet-info">' +
                '<div class="cabinet-name" style="font-size:var(--text-md);">' + utils.escapeHtml(user.name) + '</div>' +
                '<div class="cabinet-email">' + utils.escapeHtml(user.email) + '</div>' +
                syncErrHtml +
              '</div>' +
            '</div>' +
            '<span class="sync-badge has-dot" data-sync="' + utils.escapeHtml(auth.syncState) + '">' +
              '<span class="sync-dot" aria-hidden="true"></span>' +
              '<span>' + utils.escapeHtml(formatSyncLabel(auth.syncState)) + '</span>' +
            '</span>' +
          '</div>' +
          importHtml +
          '<div style="display:flex;align-items:center;justify-content:flex-end;gap:var(--space-2);flex-wrap:wrap;">' +
            '<button type="button" class="btn btn-secondary btn-sm" data-cabinet-action="sync-now"' + (uiState.busyAction ? ' disabled' : '') + '>Sync Now</button>' +
            '<button type="button" class="btn btn-danger btn-sm" data-cabinet-action="sign-out"' + (uiState.busyAction ? ' disabled' : '') + '>Sign Out</button>' +
          '</div>';
      } else {
        contentHtml =
          '<div class="cabinet-profile-card">' +
            '<div class="cabinet-profile-main">' +
              '<span class="cabinet-avatar">L</span>' +
              '<div class="cabinet-info">' +
                '<div class="cabinet-name" style="font-size:var(--text-md);">Local Guest Workspace</div>' +
                '<div class="cabinet-email">' + (isFile ? 'Running offline via file:// storage' : 'Saved only in this browser until you sign in') + '</div>' +
              '</div>' +
            '</div>' +
            '<span class="sync-badge has-dot" data-sync="local">' +
              '<span class="sync-dot" aria-hidden="true"></span>' +
              '<span>Local Mode</span>' +
            '</span>' +
          '</div>' +
          (isFile
            ? '<p style="font-size:var(--text-xs);color:var(--text-secondary);">Open TaskFlow from your Cloudflare URL (e.g. <strong>https://workflow.myclass.uz</strong>) to sign in with Google and sync across devices.</p>'
            : '<a class="btn-google" href="/api/auth/google">' +
                '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">' +
                  '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>' +
                  '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>' +
                  '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>' +
                  '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>' +
                '</svg>' +
                '<span>Sign in with Google</span>' +
              '</a>' +
              (!status.googleConfigured ? renderSetupChecklist('google', origin) : ''));
      }
    } else {
      if (!auth.authenticated || !user) {
        contentHtml =
          '<div class="telegram-card">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-2);flex-wrap:wrap;">' +
              '<strong>Telegram Daily Briefings &amp; Capture</strong>' +
              '<span class="sync-badge has-dot" data-sync="local"><span class="sync-dot" aria-hidden="true"></span><span>Sign in required</span></span>' +
            '</div>' +
            '<p style="font-size:var(--text-xs);color:var(--text-secondary);">Sign in with your Google account first to get a private pairing code and receive morning agendas, evening reflections, and quick task capture via Telegram.</p>' +
            (!isFile ? '<a class="btn-google" href="/api/auth/google"><span>Sign in with Google to Pair Telegram</span></a>' : '') +
            (!status.telegramConfigured && !isFile ? renderSetupChecklist('telegram', origin) : '') +
          '</div>';
      } else {
        var isLinked = Boolean(user.telegramChatId);
        var botLabel = status.telegramBotUsername ? '@' + status.telegramBotUsername : 'TaskFlow Bot';
        var pairingHtml = '';

        if (isLinked) {
          pairingHtml =
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);flex-wrap:wrap;padding:var(--space-3);border-radius:var(--radius-md);background:var(--bg-surface);border:1px solid var(--border-subtle);">' +
              '<div style="display:flex;flex-direction:column;gap:2px;">' +
                '<strong style="font-size:var(--text-sm);">Connected to Telegram</strong>' +
                '<span style="font-size:var(--text-xs);color:var(--text-muted);">' + utils.escapeHtml(user.telegramUsername ? '@' + user.telegramUsername : ('Chat ID ' + user.telegramChatId)) + '</span>' +
              '</div>' +
              '<div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap;">' +
                '<button type="button" class="btn btn-primary btn-sm" data-cabinet-action="tg-send-summary"' + (uiState.busyAction ? ' disabled' : '') + '>Send Today\'s Summary</button>' +
                '<button type="button" class="btn btn-danger btn-sm" data-cabinet-action="tg-unlink"' + (uiState.busyAction ? ' disabled' : '') + '>Unlink</button>' +
              '</div>' +
            '</div>';
        } else {
          var codeBlock = '';
          if (uiState.pairingData && uiState.pairingData.code) {
            var codeStr = uiState.pairingData.code;
            var deepLink = uiState.pairingData.deepLink ||
              (status.telegramBotUsername ? 'https://t.me/' + status.telegramBotUsername + '?start=link_' + codeStr : '');
            codeBlock =
              '<div class="pairing-code-box">' +
                '<div>' +
                  '<div style="font-size:var(--text-xs);color:var(--text-muted);margin-bottom:4px;">Send to ' + utils.escapeHtml(botLabel) + ' (10m expiry):</div>' +
                  '<div class="pairing-code-value">/link ' + utils.escapeHtml(codeStr) + '</div>' +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap;">' +
                  '<button type="button" class="btn btn-secondary btn-sm" data-cabinet-action="tg-copy-code">Copy Command</button>' +
                  (deepLink ? '<a class="btn btn-primary btn-sm" href="' + utils.escapeHtml(deepLink) + '" target="_blank" rel="noopener noreferrer">Open in Telegram</a>' : '') +
                '</div>' +
              '</div>';
          }

          pairingHtml =
            '<div style="display:flex;flex-direction:column;gap:var(--space-2-5);">' +
              '<p style="font-size:var(--text-xs);color:var(--text-secondary);">Pair your Telegram account to manage tasks via <code class="code-pill">/today</code>, <code class="code-pill">/add</code>, <code class="code-pill">/done</code>, and receive automated briefings.</p>' +
              '<div>' +
                '<button type="button" class="btn btn-primary btn-sm" data-cabinet-action="tg-generate-code"' + (uiState.busyAction ? ' disabled' : '') + '>' +
                  (uiState.pairingData ? 'Generate New Pairing Code' : 'Generate Pairing Code') +
                '</button>' +
              '</div>' +
              codeBlock +
            '</div>';
        }

        var prefsForm =
          '<form id="telegram-prefs-form" style="display:flex;flex-direction:column;gap:var(--space-3);padding-top:var(--space-2);border-top:1px solid var(--border-subtle);">' +
            '<div class="form-group">' +
              '<label class="form-label" for="tg-timezone">Timezone</label>' +
              '<select id="tg-timezone" class="form-select">' + buildTimezoneOptionsHtml(user.timezone || 'Asia/Tashkent') + '</select>' +
            '</div>' +
            '<div class="settings-grid-two">' +
              '<div class="form-group">' +
                '<label class="form-label" for="tg-morning-hour">Morning Agenda Hour</label>' +
                '<select id="tg-morning-hour" class="form-select">' + buildHourOptionsHtml(user.morningReminderHour) + '</select>' +
              '</div>' +
              '<div class="form-group">' +
                '<label class="form-label" for="tg-evening-hour">Evening Summary Hour</label>' +
                '<select id="tg-evening-hour" class="form-select">' + buildHourOptionsHtml(user.eveningReminderHour) + '</select>' +
              '</div>' +
            '</div>' +
            '<label class="setting-toggle-row" for="tg-notify-enabled">' +
              '<div>' +
                '<span class="setting-toggle-title">Daily Telegram Briefings</span>' +
                '<span class="setting-toggle-desc">Receive scheduled morning agenda &amp; evening wrap-up</span>' +
              '</div>' +
              '<input id="tg-notify-enabled" class="toggle-switch" type="checkbox"' + (user.telegramNotificationsEnabled ? ' checked' : '') + '>' +
            '</label>' +
            '<div style="display:flex;justify-content:flex-end;">' +
              '<button type="submit" class="btn btn-secondary btn-sm"' + (uiState.busyAction ? ' disabled' : '') + '>Save Reminder Preferences</button>' +
            '</div>' +
          '</form>';

        contentHtml =
          '<div class="telegram-card">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-2);flex-wrap:wrap;">' +
              '<strong>' + utils.escapeHtml(botLabel) + '</strong>' +
              '<span class="sync-badge has-dot" data-sync="' + (isLinked ? 'synced' : 'local') + '">' +
                '<span class="sync-dot" aria-hidden="true"></span>' +
                '<span>' + (isLinked ? 'Linked' : 'Not Linked') + '</span>' +
              '</span>' +
            '</div>' +
            pairingHtml +
            prefsForm +
            (!status.telegramConfigured ? renderSetupChecklist('telegram', origin) : '') +
          '</div>';
      }
    }

    body.innerHTML = tabsHtml + contentHtml;
  }

  function render() {
    renderAuthGate();
    renderSidebarCabinet();
    renderHeaderAccountPill();
    renderCabinetModal();
  }

  function openCabinetModal(tab) {
    uiState.activeTab = tab === 'telegram' ? 'telegram' : 'account';
    var modal = $('cabinet-modal');
    if (!modal) return;
    var app = getApp();
    if (app && typeof app.closeModals === 'function') {
      app.closeModals();
    }
    modal.hidden = false;
    uiState.modalOpen = true;
    renderCabinetModal();
  }

  function closeCabinetModal() {
    var modal = $('cabinet-modal');
    if (modal) modal.hidden = true;
    uiState.modalOpen = false;
  }

  function isEditingActiveInput() {
    var el = global.document ? global.document.activeElement : null;
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(el.isContentEditable);
  }

  function triggerBackgroundRefresh(force) {
    var store = getStore();
    if (!store || typeof store.refreshWorkspaceFromCloud !== 'function') return Promise.resolve();
    var auth = store.getAuthState();
    if (!auth.authenticated || !auth.user) return Promise.resolve();
    if (global.document && global.document.visibilityState === 'hidden') return Promise.resolve();
    if (isEditingActiveInput() || uiState.busyAction) {
      deferredRefresh = true;
      return Promise.resolve();
    }
    var now = Date.now();
    if (!force && now - lastRefreshAtMs < 3500) return Promise.resolve();
    lastRefreshAtMs = now;
    deferredRefresh = false;
    return store.refreshWorkspaceFromCloud({ silent: true }).then(function () {
      if (uiState.modalOpen) renderCabinetModal();
    });
  }

  function stopLiveSync() {
    if (liveSyncTimerId !== null && typeof global.clearInterval === 'function') {
      global.clearInterval(liveSyncTimerId);
      liveSyncTimerId = null;
    }
    deferredRefresh = false;
  }

  function startLiveSync() {
    stopLiveSync();
    if (typeof global.setInterval === 'function') {
      liveSyncTimerId = global.setInterval(function () {
        triggerBackgroundRefresh(false);
      }, LIVE_SYNC_INTERVAL_MS);
    }
  }

  function syncFromCloud() {
    if (uiState.busyAction) return Promise.resolve();
    var store = getStore();
    var auth = store.getAuthState();
    if (!auth.authenticated || !auth.user) return Promise.resolve();

    uiState.busyAction = 'sync';
    renderCabinetModal();

    var flushPromise = typeof store.flushCloudOutboxForUser === 'function'
      ? store.flushCloudOutboxForUser(auth.user)
      : Promise.resolve();

    return flushPromise.then(function () {
      return fetchJson('/api/workspace');
    }).then(function (ws) {
      uiState.busyAction = null;
      if (ws && ws.user) {
        store.setCloudWorkspace(ws.user, ws, { preserveUi: true });
        toast('Synced latest workspace from cloud', { type: 'success' });
      }
      render();
    }).catch(function (err) {
      uiState.busyAction = null;
      toast(err.message || 'Cloud sync failed', { type: 'error' });
      renderCabinetModal();
    });
  }

  function signOut() {
    if (uiState.busyAction) return;
    stopLiveSync();
    var store = getStore();
    var auth = store.getAuthState();
    uiState.busyAction = 'logout';
    renderCabinetModal();

    var flushPromise = auth && auth.authenticated && auth.user && typeof store.flushCloudOutboxForUser === 'function'
      ? store.flushCloudOutboxForUser(auth.user).catch(function () { return null; })
      : Promise.resolve();

    flushPromise.then(function () {
      return fetchJson('/api/auth/logout', { method: 'POST' });
    }).catch(function () {
      return null;
    }).then(function () {
      uiState.busyAction = null;
      uiState.pairingData = null;
      writeGuestFlag(false);
      closeCabinetModal();
      if (TaskFlow.TasksUI && typeof TaskFlow.TasksUI.closeDrawer === 'function') {
        TaskFlow.TasksUI.closeDrawer();
      }
      store.setGuestMode();
      showAuthGate();
      toast('Signed out of cloud cabinet');
    });
  }

  function sendTodaySummaryToTelegram() {
    var auth = getStore().getAuthState();
    if (!auth.authenticated || !auth.user) {
      openCabinetModal('account');
      toast('Sign in with Google to use Telegram summaries');
      return Promise.resolve(false);
    }
    if (!auth.user.telegramChatId) {
      openCabinetModal('telegram');
      toast('Pair your Telegram bot first to receive summaries');
      return Promise.resolve(false);
    }
    if (uiState.busyAction) return Promise.resolve(false);

    uiState.busyAction = 'tg-send';
    renderCabinetModal();
    return fetchJson('/api/telegram/send-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: getUtils().todayKey() })
    }).then(function () {
      uiState.busyAction = null;
      toast("Sent today's summary to Telegram", { type: 'success' });
      renderCabinetModal();
      return true;
    }).catch(function (err) {
      uiState.busyAction = null;
      toast(err.message || 'Could not send Telegram summary', { type: 'error' });
      renderCabinetModal();
      return false;
    });
  }

  function handleCabinetAction(action) {
    var store = getStore();
    if (action === 'sync-now') {
      syncFromCloud();
    } else if (action === 'sign-out') {
      signOut();
    } else if (action === 'import-guest-merge' || action === 'import-guest-replace') {
      var mode = action === 'import-guest-replace' ? 'replace' : 'merge';
      uiState.busyAction = action;
      renderCabinetModal();
      store.importLocalGuestToCloud(mode).then(function (res) {
        uiState.busyAction = null;
        if (res.ok) {
          toast('Imported ' + res.tasksCount + ' tasks & ' + res.routinesCount + ' routines to cloud', { type: 'success' });
        } else {
          toast(res.error || 'Import failed', { type: 'error' });
        }
        render();
      });
    } else if (action === 'tg-generate-code') {
      uiState.busyAction = action;
      renderCabinetModal();
      fetchJson('/api/telegram/link-code', { method: 'POST' }).then(function (res) {
        uiState.busyAction = null;
        uiState.pairingData = res;
        renderCabinetModal();
      }).catch(function (err) {
        uiState.busyAction = null;
        toast(err.message || 'Could not generate pairing code', { type: 'error' });
        renderCabinetModal();
      });
    } else if (action === 'tg-copy-code' && uiState.pairingData) {
      var cmd = '/link ' + uiState.pairingData.code;
      if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
        global.navigator.clipboard.writeText(cmd).then(function () {
          toast('Copied "' + cmd + '" to clipboard', { type: 'success' });
        }).catch(function () {
          toast('Command: ' + cmd);
        });
      } else {
        toast('Command: ' + cmd);
      }
    } else if (action === 'tg-unlink') {
      uiState.busyAction = action;
      renderCabinetModal();
      fetchJson('/api/telegram/unlink', { method: 'POST' }).then(function () {
        uiState.busyAction = null;
        uiState.pairingData = null;
        store.updateUserProfile({ telegramChatId: null, telegramUsername: null });
        toast('Telegram unlinked');
        render();
      }).catch(function (err) {
        uiState.busyAction = null;
        toast(err.message || 'Failed to unlink Telegram', { type: 'error' });
        renderCabinetModal();
      });
    } else if (action === 'tg-send-summary') {
      sendTodaySummaryToTelegram();
    }
  }

  function bindEvents() {
    var guestBtn = $('btn-guest-mode');
    if (guestBtn) {
      guestBtn.addEventListener('click', function () {
        writeGuestFlag(true);
        uiState.authError = null;
        getStore().setGuestMode();
        showAppShell();
        render();
      });
    }

    var googleGateBtn = $('btn-google-signin');
    if (googleGateBtn) {
      googleGateBtn.addEventListener('click', function (e) {
        var auth = getStore().getAuthState();
        if (auth.authStatus && auth.authStatus.googleConfigured === false) {
          e.preventDefault();
          uiState.authError = 'google_not_configured';
          renderAuthGate();
        }
      });
    }

    var pill = $('header-account-pill');
    if (pill) {
      pill.addEventListener('click', function () {
        openCabinetModal('account');
      });
    }

    if (global.document && global.document.addEventListener) {
      global.document.addEventListener('visibilitychange', function () {
        if (global.document.visibilityState === 'visible') {
          triggerBackgroundRefresh(false);
        }
      });
      global.document.addEventListener('focusout', function () {
        if (deferredRefresh) {
          global.setTimeout(function () {
            if (deferredRefresh && !isEditingActiveInput()) {
              triggerBackgroundRefresh(false);
            }
          }, 80);
        }
      });
    }

    if (global.addEventListener) {
      global.addEventListener('focus', function () {
        triggerBackgroundRefresh(false);
      });
      global.addEventListener('online', function () {
        var store = getStore();
        var auth = store ? store.getAuthState() : null;
        if (auth && auth.authenticated && auth.user && typeof store.flushCloudOutboxForUser === 'function') {
          store.flushCloudOutboxForUser(auth.user).then(function () {
            triggerBackgroundRefresh(true);
          });
        }
      });
    }

    var sideCabinet = $('sidebar-user-cabinet');
    if (sideCabinet) {
      sideCabinet.addEventListener('click', function () {
        openCabinetModal('account');
      });
    }

    var modal = $('cabinet-modal');
    if (modal) {
      modal.addEventListener('click', function (e) {
        var tabBtn = e.target.closest('[data-cabinet-tab]');
        if (tabBtn) {
          uiState.activeTab = tabBtn.getAttribute('data-cabinet-tab');
          renderCabinetModal();
          return;
        }
        var actBtn = e.target.closest('[data-cabinet-action]');
        if (actBtn) {
          handleCabinetAction(actBtn.getAttribute('data-cabinet-action'));
        }
      });

      modal.addEventListener('submit', function (e) {
        var form = e.target;
        if (!form || form.id !== 'telegram-prefs-form') return;
        e.preventDefault();
        var tzEl = $('tg-timezone');
        var mEl = $('tg-morning-hour');
        var eEl = $('tg-evening-hour');
        var nEl = $('tg-notify-enabled');
        var store = getStore();
        var s = store.getState().settings;

        var payload = {
          dailyGoalTasks: s.dailyGoalTasks,
          dailyGoalMinutes: s.dailyGoalMinutes,
          soundEnabled: s.soundEnabled,
          userName: s.userName,
          showCompleted: s.showCompleted,
          theme: store.getState().theme,
          timezone: tzEl ? tzEl.value : 'Asia/Tashkent',
          morningReminderHour: mEl ? Number(mEl.value) : 8,
          eveningReminderHour: eEl ? Number(eEl.value) : 21,
          telegramNotificationsEnabled: nEl ? Boolean(nEl.checked) : true
        };

        uiState.busyAction = 'save-tg-prefs';
        renderCabinetModal();
        fetchJson('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(function () {
          uiState.busyAction = null;
          store.updateUserProfile({
            timezone: payload.timezone,
            morningReminderHour: payload.morningReminderHour,
            eveningReminderHour: payload.eveningReminderHour,
            telegramNotificationsEnabled: payload.telegramNotificationsEnabled
          });
          toast('Telegram reminder preferences saved', { type: 'success' });
          renderCabinetModal();
        }).catch(function (err) {
          uiState.busyAction = null;
          toast(err.message || 'Could not save preferences', { type: 'error' });
          renderCabinetModal();
        });
      });
    }
  }

  function bootstrapSession() {
    var store = getStore();
    var isFile = global.location && global.location.protocol === 'file:';

    if (global.location && global.location.search) {
      try {
        var params = new global.URLSearchParams(global.location.search);
        var authErr = params.get('auth_error');
        if (authErr) {
          uiState.authError = authErr;
          if (global.history && typeof global.history.replaceState === 'function') {
            params.delete('auth_error');
            var nextSearch = params.toString();
            var nextUrl = global.location.pathname + (nextSearch ? '?' + nextSearch : '') + global.location.hash;
            global.history.replaceState(null, '', nextUrl);
          }
        }
      } catch (e) {
        /* ignore URL search parsing errors */
      }
    }

    if (isFile) {
      store.setGuestMode();
      showAppShell();
      render();
      return Promise.resolve();
    }

    var tgWebApp = global.Telegram && global.Telegram.WebApp ? global.Telegram.WebApp : null;
    if (tgWebApp) {
      try {
        if (typeof tgWebApp.ready === 'function') tgWebApp.ready();
        if (typeof tgWebApp.expand === 'function') tgWebApp.expand();
      } catch (e) {
        /* ignore Telegram WebApp host quirks */
      }
    }

    return Promise.all([
      fetchJson('/api/auth/status').catch(function () { return null; }),
      fetchJson('/api/auth/me').catch(function () { return null; })
    ]).then(function (results) {
      var statusRes = results[0];
      var meRes = results[1];

      if (!statusRes && !meRes) {
        // Plain static HTTP server without Cloudflare Pages Functions backend
        store.setGuestMode();
        if (uiState.authError) {
          showAuthGate();
        } else {
          showAppShell();
        }
        render();
        return;
      }

      if (statusRes) {
        store.initAuthSession(statusRes);
      }

      var checkMiniApp = Promise.resolve(meRes);
      if ((!meRes || !meRes.authenticated) && tgWebApp && tgWebApp.initData) {
        checkMiniApp = fetchJson('/api/telegram/miniapp-auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData: tgWebApp.initData })
        }).then(function (tgAuth) {
          if (tgAuth && tgAuth.linked && tgAuth.user) {
            return { authenticated: true, user: tgAuth.user };
          }
          if (tgAuth && tgAuth.telegramUser) {
            var handle = tgAuth.telegramUser.username ? '@' + tgAuth.telegramUser.username : (tgAuth.telegramUser.first_name || 'Telegram user');
            uiState.telegramHint = 'Welcome, ' + handle + '! Sign in with Google once to connect this Telegram account to your Personal Cabinet.';
          }
          return meRes;
        }).catch(function () {
          return meRes;
        });
      }

      return checkMiniApp.then(function (resolvedMe) {
        if (resolvedMe && resolvedMe.authenticated && resolvedMe.user) {
          var preFlush = typeof store.flushCloudOutboxForUser === 'function'
            ? store.flushCloudOutboxForUser(resolvedMe.user).catch(function () { return null; })
            : Promise.resolve();

          return preFlush.then(function () {
            if (typeof store.getPendingOutboxCount === 'function' && store.getPendingOutboxCount() > 0) {
              startLiveSync();
              showAppShell();
              render();
              return null;
            }
            return fetchJson('/api/workspace').then(function (ws) {
              store.setCloudWorkspace(ws.user || resolvedMe.user, ws);
              startLiveSync();
              showAppShell();
              render();
            }).catch(function () {
              store.setCloudWorkspace(resolvedMe.user, {});
              startLiveSync();
              showAppShell();
              render();
            });
          });
        }

        stopLiveSync();
        if (!uiState.authError && !uiState.telegramHint && readGuestFlag()) {
          store.setGuestMode();
          showAppShell();
          render();
          return;
        }

        showAuthGate();
        render();
      });
    });
  }

  function init() {
    if (uiState.initialized) return;
    uiState.initialized = true;
    bindEvents();
    render();
    bootstrapSession();
  }

  TaskFlow.AuthUI = {
    init: init,
    render: render,
    openCabinetModal: openCabinetModal,
    closeCabinetModal: closeCabinetModal,
    sendTodaySummaryToTelegram: sendTodaySummaryToTelegram,
    syncFromCloud: syncFromCloud,
    signOut: signOut
  };
})(window);
