-- The reconciliation cron scans only unresolved initial checkouts. Build the
-- partial index concurrently so legacy billing traffic is never blocked.
set lock_timeout = '3s';
set statement_timeout = '15min';

create index concurrently if not exists billing_toss_checkout_intents_reconciliation_idx
  on shorts_mvp.billing_toss_checkout_intents (updated_at,request_id)
  where status='manual_review';

reset statement_timeout;
reset lock_timeout;
