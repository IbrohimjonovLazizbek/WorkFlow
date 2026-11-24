# TaskFlow — Daily Task Manager & Progress Tracker

TaskFlow is a zero-dependency, client-side daily task manager, focus timer, routines planner, and visual progress tracker built with vanilla HTML, CSS, and JavaScript (`window.TaskFlow` IIFE modules for full compatibility over both `http://localhost` and `file://`).

## Features

- **Today Workspace**: 7-day date strip and date picker, SVG completion ring & daily goal meter, unfinished task rollover banner, quick-add bar (inline `!priority`, `#category`, `@timeBlock`, `~NNm` shorthand and multi-line paste), status/category/priority filters, time-block grouping, drag-and-drop & keyboard reordering, inline double-click rename, slide-over detail drawer with subtasks, and daily check-in (morning intention, 1–5 mood, evening reflection).
- **Focus Timer**: Pomodoro (`25m`), Deep Focus (`50m`), Short Break (`5m`), and Stopwatch modes with wall-clock timing, live minute logging to attached tasks, `document.title` readout, and optional Web Audio chimes.
- **Upcoming & Backlog**: Rolling 7-day agenda with overdue task review and per-day inline quick-add.
- **Progress & Analytics**: `7` / `14` / `30`-day range switcher, KPI cards with period deltas, interactive SVG completion & focus trend chart, 12-week (84-day) daily consistency heatmap, category donut & priority breakdown, and recent check-in log.
- **Daily Routines**: Recurring `daily` / `weekdays` templates with default subtasks, active toggles, completion streaks, and idempotent daily population.
- **Workspace Utilities**: Light/Dark theme (`[data-theme]`), Command Palette (`Ctrl/Cmd+K`), keyboard shortcuts (`?`), multi-step snapshot undo (`Ctrl/Cmd+Z` / toast Undo), JSON/CSV export, strict schema-validated JSON import, and demo data reset/clear.

## File Structure

```text
daily-task-manager/
├── index.html
├── README.md
├── .gitignore
├── css/
│   ├── tokens.css       # Light/dark palette & design tokens
│   ├── base.css         # Reset, typography, focus rings, print layout
│   ├── layout.css       # App shell, sidebar, sticky header, responsive grid
│   ├── components.css   # Cards, task list, drawer, modals, toasts
│   └── analytics.css    # KPIs, SVG charts, 12-week heatmap, logs
├── js/
│   ├── state.js         # TaskFlow.Utils & TaskFlow.Store (localStorage v1)
│   ├── timer.js         # TaskFlow.Timer & Web Audio chime engine
│   ├── tasks-ui.js      # TaskFlow.TasksUI (Today, Drawer, Upcoming)
│   ├── routines-ui.js   # TaskFlow.RoutinesUI (Check-in & Routines)
│   ├── analytics-ui.js  # TaskFlow.AnalyticsUI (Progress hero & SVG charts)
│   └── app.js           # TaskFlow.App (Routing, palette, settings, hotkeys)
└── tests/
    └── store.test.mjs   # Node built-in unit & integration test suite
```

## Running Locally

Because TaskFlow uses classic script loading (no bundler or ES module imports required), you can open `index.html` directly in a browser, or serve the folder over local HTTP:

```bash
python -m http.server 8080
```

Then open `http://127.0.0.1:8080` in your browser.

## Running Tests

Requires Node.js (tested with Node v26):

```bash
node --test tests/store.test.mjs
```

## Upcoming Milestone

Planned next phase after backing up v1:
- **Cloudflare Deployment & Storage**: Host on Cloudflare with cloud persistence.
- **Google Auth**: Sign-in support for syncing tasks, routines, and analytics across devices.
- **Telegram Integration**: Daily task reminders, quick capture, and end-of-day check-in prompts via Telegram bot.
