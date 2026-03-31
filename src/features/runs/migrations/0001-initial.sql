CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('spotify', 'soundcloud')),
  playlist_url TEXT NOT NULL,
  playlist_title TEXT,
  status TEXT NOT NULL CHECK (
    status IN (
      'queued',
      'ingesting',
      'matching',
      'awaiting-approval',
      'packaging',
      'completed',
      'failed'
    )
  ),
  resume_after_status TEXT CHECK (
    resume_after_status IS NULL OR resume_after_status IN (
      'queued',
      'ingesting',
      'matching',
      'awaiting-approval',
      'packaging',
      'completed',
      'failed'
    )
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  failed_at TEXT
);

CREATE INDEX IF NOT EXISTS runs_updated_at_idx ON runs(updated_at DESC);

CREATE TABLE IF NOT EXISTS run_tracks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  source_position INTEGER NOT NULL,
  source_track_id TEXT,
  artist TEXT NOT NULL,
  title TEXT NOT NULL,
  version TEXT,
  status TEXT NOT NULL CHECK (
    status IN (
      'queued',
      'matched',
      'awaiting-approval',
      'acquired',
      'missed',
      'failed'
    )
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS run_tracks_run_position_idx
  ON run_tracks(run_id, source_position);

CREATE TABLE IF NOT EXISTS acquisition_attempts (
  id TEXT PRIMARY KEY,
  run_track_id TEXT NOT NULL REFERENCES run_tracks(id) ON DELETE CASCADE,
  provider_key TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (
    outcome IN ('matched', 'missed', 'skipped', 'failed', 'purchased')
  ),
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS acquisition_attempts_track_created_idx
  ON acquisition_attempts(run_track_id, created_at DESC);

CREATE TABLE IF NOT EXISTS run_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  artifact_kind TEXT NOT NULL CHECK (
    artifact_kind IN (
      'downloads-zip',
      'manifest-json',
      'misses-txt',
      'run-report'
    )
  ),
  relative_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS run_artifacts_run_created_idx
  ON run_artifacts(run_id, created_at DESC);
