-- Session attachment updates previously scanned all generated shorts, including
-- rows already owned by a user. Keep only unclaimed rows in this lookup index.
-- Run outside a transaction: production writes must remain available while built.
SET lock_timeout = '3s';
SET statement_timeout = '3min';
CREATE INDEX CONCURRENTLY IF NOT EXISTS generated_shorts_unclaimed_session_idx
    ON shorts_mvp.generated_shorts (mvp_session_id)
    WHERE user_id IS NULL;
RESET statement_timeout;
RESET lock_timeout;
