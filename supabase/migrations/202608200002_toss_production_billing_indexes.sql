-- These indexes touch existing, potentially busy production tables. They are
-- intentionally isolated from the schema transaction and built concurrently,
-- so legacy ThePayOne reads and writes keep flowing. Both predicates match no
-- legacy provider rows. Abort quickly instead of waiting on production locks.
set lock_timeout = '3s';
set statement_timeout = '15min';

create unique index concurrently if not exists billing_payment_methods_toss_customer_active_idx
  on shorts_mvp.billing_payment_methods (provider_customer_key)
  where provider='toss' and status='active' and provider_customer_key is not null;

create unique index concurrently if not exists user_subscriptions_one_current_toss_idx
  on shorts_mvp.user_subscriptions (user_id)
  where payment_provider='toss'
    and status in ('pending','trialing','active','past_due');

reset statement_timeout;
reset lock_timeout;
