ALTER TABLE run_track_reviews
  ADD COLUMN cart_status TEXT CHECK (
    cart_status IN ('added', 'already-in-cart', 'not-found', 'provider-error')
  );

ALTER TABLE run_track_reviews
  ADD COLUMN cart_detail TEXT;

ALTER TABLE run_track_reviews
  ADD COLUMN cart_updated_at TEXT;
