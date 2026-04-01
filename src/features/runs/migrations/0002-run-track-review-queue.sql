CREATE TABLE IF NOT EXISTS run_track_reviews (
  id TEXT PRIMARY KEY,
  run_track_id TEXT NOT NULL UNIQUE REFERENCES run_tracks(id) ON DELETE CASCADE,
  provider_key TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  provider_url TEXT,
  authorization_basis TEXT NOT NULL CHECK (
    authorization_basis IN (
      'uploader-enabled-download',
      'rights-holder-storefront',
      'purchase-entitlement'
    )
  ),
  price_tier TEXT NOT NULL CHECK (
    price_tier IN ('free', 'free-or-owned', 'paid')
  ),
  candidate_id TEXT NOT NULL,
  mix_label TEXT,
  available_formats TEXT NOT NULL,
  queue_name TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'approved', 'rejected', 'purchased')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS run_track_reviews_track_created_idx
  ON run_track_reviews(run_track_id, created_at DESC);
