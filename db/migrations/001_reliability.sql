-- Migration 001: reliability layer tables
-- Tables: errands, traces, provider_memory, outcomes, audit

BEGIN;

-- ── errands ──────────────────────────────────────────────────────────────────
-- Central record for each top-level errand initiated by a user.

CREATE TABLE IF NOT EXISTS errands (
  errand_id   text        PRIMARY KEY,
  user_id     text        NOT NULL,
  template_id text,
  request     jsonb       DEFAULT '{}',
  status      text        NOT NULL DEFAULT 'pending',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS errands_user_id_idx  ON errands (user_id);
CREATE INDEX IF NOT EXISTS errands_status_idx   ON errands (status);
CREATE INDEX IF NOT EXISTS errands_created_at_idx ON errands (created_at);

-- ── traces ────────────────────────────────────────────────────────────────────
-- Step-level log entries for each job executed within an errand.

CREATE TABLE IF NOT EXISTS traces (
  id          bigserial   PRIMARY KEY,
  errand_id   text        NOT NULL REFERENCES errands (errand_id) ON DELETE CASCADE,
  job_id      text,
  step        text,
  provider    text,
  status      text        NOT NULL DEFAULT 'started',
  meta        jsonb       DEFAULT '{}',
  ts          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS traces_errand_id_idx ON traces (errand_id);
CREATE INDEX IF NOT EXISTS traces_ts_idx        ON traces (ts);
CREATE INDEX IF NOT EXISTS traces_status_idx    ON traces (status);

-- ── provider_memory ──────────────────────────────────────────────────────────
-- Persistent profile/statistics for each external provider (e.g. agentphone).
-- profile is merged (not replaced) on each update.

CREATE TABLE IF NOT EXISTS provider_memory (
  provider_key text        PRIMARY KEY,
  profile      jsonb       NOT NULL DEFAULT '{}',
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_memory_provider_key_idx ON provider_memory (provider_key);

-- ── outcomes ─────────────────────────────────────────────────────────────────
-- Final result record for each errand.

CREATE TABLE IF NOT EXISTS outcomes (
  errand_id   text        PRIMARY KEY REFERENCES errands (errand_id) ON DELETE CASCADE,
  completed   boolean     NOT NULL DEFAULT false,
  confirmed   boolean     NOT NULL DEFAULT false,
  cost_cents  integer,
  channel     text,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outcomes_errand_id_idx   ON outcomes (errand_id);
CREATE INDEX IF NOT EXISTS outcomes_recorded_at_idx ON outcomes (recorded_at);

-- ── audit ─────────────────────────────────────────────────────────────────────
-- Append-only ledger for any state change touching an errand.

CREATE TABLE IF NOT EXISTS audit (
  id          bigserial   PRIMARY KEY,
  errand_id   text        NOT NULL,
  actor       text,
  action      text        NOT NULL,
  payload     jsonb       DEFAULT '{}',
  ts          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_errand_id_idx ON audit (errand_id);
CREATE INDEX IF NOT EXISTS audit_ts_idx        ON audit (ts);

COMMIT;
