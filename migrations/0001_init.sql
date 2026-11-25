-- TaskFlow multi-user Cloudflare D1 schema (SQLite)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE,
  email TEXT,
  name TEXT,
  avatar_url TEXT,
  timezone TEXT DEFAULT 'Asia/Tashkent',
  telegram_chat_id TEXT UNIQUE,
  telegram_username TEXT,
  telegram_notifications_enabled INTEGER DEFAULT 1,
  morning_reminder_hour INTEGER DEFAULT 8,
  evening_reminder_hour INTEGER DEFAULT 21,
  last_morning_sent_date TEXT,
  last_evening_sent_date TEXT,
  last_weekly_sent_date TEXT,
  active_timer_json TEXT,
  timer_notified_for TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  daily_goal_tasks INTEGER DEFAULT 5,
  daily_goal_minutes INTEGER DEFAULT 120,
  sound_enabled INTEGER DEFAULT 1,
  user_name TEXT DEFAULT 'Daily Workspace',
  show_completed INTEGER DEFAULT 1,
  theme TEXT DEFAULT 'light',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT DEFAULT '',
  date TEXT NOT NULL,
  time_block TEXT DEFAULT 'anytime',
  scheduled_time TEXT DEFAULT '',
  estimated_minutes INTEGER DEFAULT 30,
  actual_minutes INTEGER DEFAULT 0,
  priority TEXT DEFAULT 'medium',
  category TEXT DEFAULT 'work',
  status TEXT DEFAULT 'todo',
  subtasks_json TEXT DEFAULT '[]',
  routine_id TEXT,
  completion_comment TEXT DEFAULT '',
  alert_sent_for TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_date ON tasks(user_id, date);

CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT DEFAULT 'work',
  priority TEXT DEFAULT 'medium',
  time_block TEXT DEFAULT 'morning',
  estimated_minutes INTEGER DEFAULT 30,
  schedule TEXT DEFAULT 'daily',
  active INTEGER DEFAULT 1,
  subtasks_json TEXT DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_routines_user ON routines(user_id);

CREATE TABLE IF NOT EXISTS reflections (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  mood INTEGER,
  intention TEXT DEFAULT '',
  reflection TEXT DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS telegram_link_codes (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_user ON telegram_link_codes(user_id);

CREATE TABLE IF NOT EXISTS telegram_chat_states (
  chat_id TEXT PRIMARY KEY,
  action TEXT,
  draft_text TEXT,
  updated_at TEXT NOT NULL
);
