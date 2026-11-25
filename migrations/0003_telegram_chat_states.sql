-- Ephemeral per-chat input state for no-slash Telegram bot button flows
CREATE TABLE IF NOT EXISTS telegram_chat_states (
  chat_id TEXT PRIMARY KEY,
  action TEXT,
  draft_text TEXT,
  updated_at TEXT NOT NULL
);
