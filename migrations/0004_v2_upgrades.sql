-- Phase 3 upgrades: completion comments, task scheduled-time alert dedup, cross-device timer sync, weekly scorecard dedup
ALTER TABLE users ADD COLUMN active_timer_json TEXT;
ALTER TABLE users ADD COLUMN timer_notified_for TEXT;
ALTER TABLE users ADD COLUMN last_weekly_sent_date TEXT;

ALTER TABLE tasks ADD COLUMN completion_comment TEXT DEFAULT '';
ALTER TABLE tasks ADD COLUMN alert_sent_for TEXT;
