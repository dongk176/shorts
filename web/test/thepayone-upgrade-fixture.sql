-- Synthetic, disposable local database only. No customer or provider data.
drop schema if exists shorts_mvp cascade;
create schema shorts_mvp;
create table shorts_mvp.app_users(id text primary key, selected_plan_code text);
create table shorts_mvp.mvp_sessions(user_id text, selected_plan_code text);
create table shorts_mvp.user_subscriptions(
 id text primary key, user_id text, plan_code text, status text, billing_cycle text,
 payment_method_id text,payment_provider text,provider_schedule_status text,
 billing_review_status text,billing_review_reason text,current_period_start timestamptz,
 current_period_end timestamptz,next_charge_at timestamptz,next_quota_at timestamptz,
 next_retry_at timestamptz,grace_ends_at timestamptz,retry_count int,cancel_at_period_end boolean,
 canceled_at timestamptz,scheduled_plan_code text,scheduled_billing_cycle text,billing_anchor_day int,
 created_at timestamptz default now()
);
create table shorts_mvp.billing_payment_methods(
 id text primary key,user_id text,provider text,status text,provider_schedule_status text,
 issuer_name text,card_last4 text,billing_key_ciphertext text,billing_key_iv text,billing_key_tag text,
 payer_tel_ciphertext text,payer_tel_iv text,payer_tel_tag text,revoked_at timestamptz
);
create table shorts_mvp.billing_orders(
 id text primary key default gen_random_uuid()::text,user_id text,subscription_id text,
 request_id text unique,kind text,product_code text,billing_cycle text,amount_krw int,
 order_id text,order_name text,provider text,provider_track_id text,provider_merchant_id text,
 provider_terminal_id text,renewal_period_start timestamptz,checkout_expires_at timestamptz,
 proration_credit_krw int default 0,installment_months int,installment_campaign_id text,
 installment_terms_snapshot jsonb,purchase_limit_version int,status text default 'pending',
 provider_transaction_id text,provider_status text,provider_auth_code text,provider_card_id_hash text,
 provider_transaction_day date,approved_at timestamptz,failure_code text,failure_message text,
 refunded_amount_krw int default 0,refund_status text default 'none',
 proration_refund_track_id text,proration_refund_transaction_id text,
 proration_refund_status text default 'none',created_at timestamptz default now()
);
create table shorts_mvp.admin_billing_refunds(billing_order_id text,status text);
create table shorts_mvp.billing_attempts(
 id text primary key default gen_random_uuid()::text,order_id text,attempt_no int,
 provider_order_id text,status text default 'processing',provider_transaction_id text,
 provider_code text,finished_at timestamptz,unique(order_id,attempt_no)
);
create table shorts_mvp.usage_grants(
 id text primary key default gen_random_uuid()::text,user_id text,subscription_id text,
 billing_order_id text references shorts_mvp.billing_orders(id),kind text,product_code text,
 total_seconds int,credited_seconds int,carried_seconds int,
 reserved_seconds int default 0,consumed_seconds int default 0,
 valid_from timestamptz,expires_at timestamptz,status text default 'active',
 check(total_seconds>=0 and credited_seconds>=0 and carried_seconds>=0),
 check(credited_seconds+carried_seconds=total_seconds),
 check(reserved_seconds>=0 and consumed_seconds>=0 and reserved_seconds+consumed_seconds<=total_seconds)
);
create unique index usage_grants_subscription_period_idx on shorts_mvp.usage_grants(subscription_id,valid_from,kind) where subscription_id is not null and kind='base';
create table shorts_mvp.usage_grant_allocations(
 reservation_id text,grant_id text references shorts_mvp.usage_grants(id),allocated_seconds int,status text,
 unique(reservation_id,grant_id)
);
create table shorts_mvp.subscription_upgrade_refunds(
 id text primary key default gen_random_uuid()::text,upgrade_order_id text unique references shorts_mvp.billing_orders(id),
 source_order_id text references shorts_mvp.billing_orders(id),user_id text,source_plan_code text,target_plan_code text,
 target_billing_cycle text,source_provider_transaction_id text,source_transaction_day date,
 source_approved_at timestamptz,source_auth_code text,source_amount_krw int,refund_amount_krw int,
 period_start timestamptz,period_end timestamptz,total_period_days int,unused_period_days int,
 card_issuer text,card_last4 text,status text,admin_note text,
 check (status in ('pending','submitted','completed','manual_review')),
 check (refund_amount_krw>0 and refund_amount_krw<=source_amount_krw),
 check(total_period_days>0 and unused_period_days>0 and unused_period_days<=total_period_days),
 check(period_end>period_start)
);
create table shorts_mvp.billing_payment_events(
 billing_order_id text,subscription_id text,payment_method_id text,validation_status text,
 processing_result text,processed_at timestamptz,provider text,provider_transaction_id text
);
