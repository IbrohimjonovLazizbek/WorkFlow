-- Add user theme preference syncing across devices
ALTER TABLE user_settings ADD COLUMN theme TEXT DEFAULT 'light';
