begin;
create table if not exists shorts_mvp.paddle_plan_changes (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references shorts_mvp.app_users(id),
 paddle_subscription_id text not null references shorts_mvp.paddle_subscriptions(paddle_id),
 from_code text not null references shorts_mvp.plans(code),
 to_code text not null references shorts_mvp.plans(code),
 currency text not null check(currency in ('USD','JPY')),
 timing text not null check(timing in ('immediate','renewal')),
 status text not null check(status in ('quoted','processing','unknown','scheduled','applied','failed','superseded')),
 source_updated_at timestamptz not null,
 period_start timestamptz not null, period_end timestamptz not null,
 effective_at timestamptz not null,
 amount_minor bigint not null check(amount_minor>=0),
 expires_at timestamptz not null,
 transaction_id text unique,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists paddle_one_pending_change on shorts_mvp.paddle_plan_changes(paddle_subscription_id)
 where status in ('processing','unknown','scheduled');
create index if not exists paddle_change_user on shorts_mvp.paddle_plan_changes(user_id,created_at desc);
alter table shorts_mvp.paddle_plan_changes enable row level security;
revoke all on shorts_mvp.paddle_plan_changes from public,anon,authenticated;
grant all on shorts_mvp.paddle_plan_changes to service_role;
alter table shorts_mvp.paddle_payment_grants add column if not exists original_seconds integer check(original_seconds>0);
-- Use the purchased grant's product, not the subscription's potentially newer plan.
update shorts_mvp.paddle_payment_grants pg set original_seconds=pl.monthly_source_seconds
 from shorts_mvp.usage_grants g join shorts_mvp.plans pl on pl.code=g.product_code
 where pg.grant_id=g.id and pg.original_seconds is null;
alter table shorts_mvp.paddle_payments add column if not exists plan_code text references shorts_mvp.plans(code);
update shorts_mvp.paddle_payments p set plan_code=g.product_code
 from shorts_mvp.usage_grants g where p.grant_id=g.id and p.plan_code is null;
commit;
