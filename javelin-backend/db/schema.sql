-- Javelin thread persistence schema
--
-- Canonical schema state. Apply via Neon SQL editor: paste contents, run.
-- Idempotent — safe to re-apply (CREATE ... IF NOT EXISTS throughout).
--
-- When the schema changes:
--   1. Add the relevant CREATE / ALTER / DROP statement to this file.
--   2. Paste the new statement into Neon's SQL editor and run.
--   3. Commit the updated file.
-- This file is the single source of truth for what the production schema
-- should look like.

CREATE TABLE IF NOT EXISTS threads (
  thread_id      TEXT PRIMARY KEY,
  account_id     TEXT NOT NULL,
  title          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS messages (
  message_id              TEXT PRIMARY KEY,
  thread_id               TEXT NOT NULL REFERENCES threads(thread_id) ON DELETE CASCADE,
  role                    TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content                 TEXT NOT NULL,
  tool_calls              JSONB,
  cache_creation_tokens   INTEGER,
  cache_read_tokens       INTEGER,
  output_tokens           INTEGER,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS threads_account_active_idx
  ON threads (account_id, last_active_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS messages_thread_chronological_idx
  ON messages (thread_id, created_at);
