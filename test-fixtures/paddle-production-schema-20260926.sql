-- Production metadata observed read-only on 2026-09-26; no customer rows.

-- Six billing tables only. External foreign keys, RLS and pre-existing triggers

-- are excluded; this fixture does not claim to mirror the complete database.

create schema shorts_mvp; create role anon; create role authenticated; create role service_role;

create table shorts_mvp.app_users(
 "id" uuid default gen_random_uuid() not null,
 "auth_user_id" uuid,
 "email" text,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null,
 "display_name" text,
 "avatar_url" text,
 "provider" text,
 "selected_plan_code" text default 'free'::text not null,
 "last_sign_in_at" timestamp with time zone,
 "is_admin" boolean default false not null,
 "default_payment_method_id" uuid,
 "withdrawn_at" timestamp with time zone,
 "manual_service_access_until" timestamp with time zone,
 "referral_partner_id" uuid,
 "referral_visitor_id" uuid,
 "referral_attributed_at" timestamp with time zone
);

create table shorts_mvp.billing_orders(
 "id" uuid default gen_random_uuid() not null,
 "user_id" uuid not null,
 "subscription_id" uuid,
 "payment_method_id" uuid,
 "request_id" uuid not null,
 "kind" text not null,
 "product_code" text not null,
 "billing_cycle" text,
 "amount_krw" integer not null,
 "order_id" text not null,
 "order_name" text not null,
 "status" text default 'pending'::text not null,
 "provider_transaction_id" text,
 "provider_status" text,
 "failure_code" text,
 "failure_message" text,
 "renewal_period_start" timestamp with time zone,
 "checkout_expires_at" timestamp with time zone,
 "approved_at" timestamp with time zone,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null,
 "refunded_amount_krw" integer default 0 not null,
 "refund_status" text default 'none'::text not null,
 "provider" text default 'thepayone'::text not null,
 "provider_track_id" text,
 "provider_merchant_id" text,
 "provider_terminal_id" text,
 "provider_card_id_hash" text,
 "proration_credit_krw" integer default 0 not null,
 "proration_refund_track_id" text,
 "proration_refund_transaction_id" text,
 "proration_refund_status" text default 'none'::text not null,
 "provider_auth_code" text,
 "provider_transaction_day" date,
 "installment_months" integer default 0 not null,
 "installment_campaign_id" uuid,
 "installment_terms_snapshot" jsonb default '{}'::jsonb not null,
 "purchase_limit_version" smallint default 0 not null,
 "refund_policy_version" smallint default 4 not null
);

create table shorts_mvp.billing_toss_checkout_intents(
 "id" uuid default gen_random_uuid() not null,
 "request_id" uuid not null,
 "user_id" uuid not null,
 "cohort" text default 'toss_v1'::text not null,
 "provider_customer_key" text not null,
 "target_plan_code" text not null,
 "purpose" text default 'subscription_start'::text not null,
 "status" text default 'prepared'::text not null,
 "payment_method_id" uuid,
 "subscription_id" uuid,
 "result_summary" jsonb default '{}'::jsonb not null,
 "failure_code" text,
 "failure_message" text,
 "expires_at" timestamp with time zone default (now() + '00:15:00'::interval) not null,
 "completed_at" timestamp with time zone,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null
);

create table shorts_mvp.plans(
 "code" text not null,
 "display_name" text not null,
 "monthly_source_seconds" integer not null,
 "retention_days" integer default 30 not null,
 "sort_order" integer not null,
 "is_active" boolean default true not null,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null,
 "monthly_price_krw" integer default 0 not null,
 "yearly_price_krw" integer default 0 not null,
 "max_active_jobs" integer default 0 not null,
 "prepaid_months" integer default 12 not null
);

create table shorts_mvp.usage_grants(
 "id" uuid default gen_random_uuid() not null,
 "user_id" uuid not null,
 "subscription_id" uuid,
 "billing_order_id" uuid,
 "kind" text not null,
 "product_code" text not null,
 "total_seconds" integer not null,
 "reserved_seconds" integer default 0 not null,
 "consumed_seconds" integer default 0 not null,
 "valid_from" timestamp with time zone not null,
 "expires_at" timestamp with time zone not null,
 "status" text default 'active'::text not null,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null,
 "credited_seconds" integer default 0 not null,
 "carried_seconds" integer default 0 not null,
 "funding_source" text
);

create table shorts_mvp.user_subscriptions(
 "id" uuid default gen_random_uuid() not null,
 "user_id" uuid not null,
 "plan_code" text not null,
 "status" text not null,
 "current_period_start" timestamp with time zone,
 "current_period_end" timestamp with time zone,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null,
 "billing_cycle" text,
 "payment_method_id" uuid,
 "next_charge_at" timestamp with time zone,
 "next_quota_at" timestamp with time zone,
 "cancel_at_period_end" boolean default false not null,
 "scheduled_plan_code" text,
 "scheduled_billing_cycle" text,
 "retry_count" integer default 0 not null,
 "next_retry_at" timestamp with time zone,
 "grace_ends_at" timestamp with time zone,
 "canceled_at" timestamp with time zone,
 "ended_at" timestamp with time zone,
 "billing_anchor_day" integer,
 "billing_review_status" text default 'clear'::text not null,
 "billing_review_reason" text,
 "payment_provider" text default 'thepayone'::text,
 "provider_schedule_status" text default 'none'::text not null,
 "last_provider_event_at" timestamp with time zone,
 "contract_months" smallint,
 "billing_price_krw" integer,
 "scheduled_contract_months" smallint,
 "scheduled_billing_price_krw" integer,
 "scheduled_change_effective_at" timestamp with time zone,
 "last_charge_at" timestamp with time zone,
 "last_charge_failure_code" text,
 "last_charge_failure_message" text
);

alter table shorts_mvp.app_users add constraint app_users_auth_user_id_key UNIQUE (auth_user_id);

alter table shorts_mvp.app_users add constraint app_users_pkey PRIMARY KEY (id);

alter table shorts_mvp.app_users add constraint app_users_referral_attribution_check CHECK ((((referral_partner_id IS NULL) AND (referral_visitor_id IS NULL) AND (referral_attributed_at IS NULL)) OR ((referral_partner_id IS NOT NULL) AND (referral_attributed_at IS NOT NULL))));

alter table shorts_mvp.billing_orders add constraint billing_orders_amount_krw_check CHECK ((amount_krw >= 0));

alter table shorts_mvp.billing_orders add constraint billing_orders_billing_cycle_check CHECK (((billing_cycle IS NULL) OR (billing_cycle = ANY (ARRAY['monthly'::text, 'yearly'::text]))));

alter table shorts_mvp.billing_orders add constraint billing_orders_installment_months_check CHECK ((((installment_months >= 0) AND (installment_months <= 36)) AND (installment_months <> 1)));

alter table shorts_mvp.billing_orders add constraint billing_orders_installment_terms_snapshot_object CHECK ((jsonb_typeof(installment_terms_snapshot) = 'object'::text));

alter table shorts_mvp.billing_orders add constraint billing_orders_kind_check CHECK ((kind = ANY (ARRAY['subscription_initial'::text, 'subscription_renewal'::text, 'subscription_change'::text, 'annual_renewal'::text, 'addon'::text, 'payment_method_update'::text])));

alter table shorts_mvp.billing_orders add constraint billing_orders_order_id_check CHECK (((char_length(order_id) >= 6) AND (char_length(order_id) <= 64)));

alter table shorts_mvp.billing_orders add constraint billing_orders_order_id_key UNIQUE (order_id);

alter table shorts_mvp.billing_orders add constraint billing_orders_order_name_check CHECK (((char_length(order_name) >= 1) AND (char_length(order_name) <= 100)));

alter table shorts_mvp.billing_orders add constraint billing_orders_payment_key_key UNIQUE (provider_transaction_id);

alter table shorts_mvp.billing_orders add constraint billing_orders_pkey PRIMARY KEY (id);

alter table shorts_mvp.billing_orders add constraint billing_orders_proration_credit_check CHECK (((proration_credit_krw >= 0) AND (proration_credit_krw <= amount_krw)));

alter table shorts_mvp.billing_orders add constraint billing_orders_proration_refund_status_check CHECK ((proration_refund_status = ANY (ARRAY['none'::text, 'pending'::text, 'succeeded'::text, 'failed'::text, 'manual_review'::text])));

alter table shorts_mvp.billing_orders add constraint billing_orders_provider_check CHECK ((provider = ANY (ARRAY['nicepay'::text, 'thepayone'::text, 'toss'::text]))) NOT VALID;

alter table shorts_mvp.billing_orders add constraint billing_orders_purchase_limit_version_check CHECK ((purchase_limit_version = ANY (ARRAY[0, 1])));

alter table shorts_mvp.billing_orders add constraint billing_orders_refund_policy_version_check CHECK ((refund_policy_version = ANY (ARRAY[1, 2, 3, 4])));

alter table shorts_mvp.billing_orders add constraint billing_orders_refund_status_check CHECK ((refund_status = ANY (ARRAY['none'::text, 'partial'::text, 'full'::text, 'manual_review'::text])));

alter table shorts_mvp.billing_orders add constraint billing_orders_refunded_amount_check CHECK (((refunded_amount_krw >= 0) AND (refunded_amount_krw <= amount_krw)));

alter table shorts_mvp.billing_orders add constraint billing_orders_request_id_key UNIQUE (request_id);

alter table shorts_mvp.billing_orders add constraint billing_orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'succeeded'::text, 'failed'::text, 'unknown'::text, 'manual_review'::text, 'canceled'::text, 'expired'::text])));

alter table shorts_mvp.billing_toss_checkout_intents add constraint billing_toss_checkout_intents_cohort_check CHECK ((cohort = 'toss_v1'::text));

alter table shorts_mvp.billing_toss_checkout_intents add constraint billing_toss_checkout_intents_pkey PRIMARY KEY (id);

alter table shorts_mvp.billing_toss_checkout_intents add constraint billing_toss_checkout_intents_provider_customer_key_check CHECK (((char_length(provider_customer_key) >= 10) AND (char_length(provider_customer_key) <= 100)));

alter table shorts_mvp.billing_toss_checkout_intents add constraint billing_toss_checkout_intents_purpose_check CHECK ((purpose = ANY (ARRAY['subscription_start'::text, 'payment_method_replace'::text])));

alter table shorts_mvp.billing_toss_checkout_intents add constraint billing_toss_checkout_intents_request_id_key UNIQUE (request_id);

alter table shorts_mvp.billing_toss_checkout_intents add constraint billing_toss_checkout_intents_status_check CHECK ((status = ANY (ARRAY['prepared'::text, 'processing'::text, 'payment_method_registered'::text, 'succeeded'::text, 'failed'::text, 'expired'::text, 'manual_review'::text])));

alter table shorts_mvp.billing_toss_checkout_intents add constraint billing_toss_checkout_intents_target_plan_code_check CHECK ((target_plan_code = ANY (ARRAY['toss_easycut_pro_1m'::text, 'toss_easycut_pro_6m'::text, 'toss_easycut_pro_12m'::text, 'toss_starter_1m'::text, 'toss_starter_3m'::text, 'toss_starter_6m'::text, 'toss_starter_12m'::text, 'toss_expert_1m'::text, 'toss_expert_3m'::text, 'toss_expert_6m'::text, 'toss_expert_12m'::text]))) NOT VALID;

alter table shorts_mvp.plans add constraint plans_code_check CHECK ((code = ANY (ARRAY['free'::text, 'plus'::text, 'standard'::text, 'pro'::text, 'easycut_pro_v2'::text, 'starter_3m'::text, 'starter_6m'::text, 'starter_12m'::text, 'expert_3m'::text, 'expert_6m'::text, 'expert_12m'::text, 'toss_easycut_pro_1m'::text, 'toss_easycut_pro_6m'::text, 'toss_easycut_pro_12m'::text, 'toss_starter_1m'::text, 'toss_starter_3m'::text, 'toss_starter_6m'::text, 'toss_starter_12m'::text, 'toss_expert_1m'::text, 'toss_expert_3m'::text, 'toss_expert_6m'::text, 'toss_expert_12m'::text]))) NOT VALID;

alter table shorts_mvp.plans add constraint plans_max_active_jobs_check CHECK (((max_active_jobs >= 0) AND (max_active_jobs <= 3)));

alter table shorts_mvp.plans add constraint plans_monthly_price_krw_check CHECK ((monthly_price_krw >= 0));

alter table shorts_mvp.plans add constraint plans_monthly_source_seconds_check CHECK ((monthly_source_seconds >= 0));

alter table shorts_mvp.plans add constraint plans_pkey PRIMARY KEY (code);

alter table shorts_mvp.plans add constraint plans_prepaid_months_check CHECK (((prepaid_months >= 1) AND (prepaid_months <= 12)));

alter table shorts_mvp.plans add constraint plans_retention_days_check CHECK (((retention_days >= 1) AND (retention_days <= 30)));

alter table shorts_mvp.plans add constraint plans_sort_order_key UNIQUE (sort_order);

alter table shorts_mvp.plans add constraint plans_yearly_price_krw_check CHECK ((yearly_price_krw >= 0));

alter table shorts_mvp.usage_grants add constraint usage_grants_check CHECK ((expires_at > valid_from));

alter table shorts_mvp.usage_grants add constraint usage_grants_check1 CHECK (((reserved_seconds + consumed_seconds) <= total_seconds));

alter table shorts_mvp.usage_grants add constraint usage_grants_consumed_seconds_check CHECK ((consumed_seconds >= 0));

alter table shorts_mvp.usage_grants add constraint usage_grants_credit_components_check CHECK (((credited_seconds >= 0) AND (carried_seconds >= 0) AND ((credited_seconds + carried_seconds) = total_seconds)));

alter table shorts_mvp.usage_grants add constraint usage_grants_kind_check CHECK ((kind = ANY (ARRAY['base'::text, 'addon'::text])));

alter table shorts_mvp.usage_grants add constraint usage_grants_pkey PRIMARY KEY (id);

alter table shorts_mvp.usage_grants add constraint usage_grants_reserved_seconds_check CHECK ((reserved_seconds >= 0));

alter table shorts_mvp.usage_grants add constraint usage_grants_status_check CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text, 'revoked'::text])));

alter table shorts_mvp.usage_grants add constraint usage_grants_total_seconds_check CHECK ((total_seconds > 0));

alter table shorts_mvp.user_subscriptions add constraint user_subscriptions_billing_anchor_day_check CHECK (((billing_anchor_day IS NULL) OR ((billing_anchor_day >= 1) AND (billing_anchor_day <= 31))));

alter table shorts_mvp.user_subscriptions add constraint user_subscriptions_billing_cycle_check CHECK (((billing_cycle IS NULL) OR (billing_cycle = ANY (ARRAY['monthly'::text, 'yearly'::text]))));

alter table shorts_mvp.user_subscriptions add constraint user_subscriptions_billing_price_krw_check CHECK (((billing_price_krw IS NULL) OR (billing_price_krw > 0))) NOT VALID;

alter table shorts_mvp.user_subscriptions add constraint user_subscriptions_billing_review_status_check CHECK ((billing_review_status = ANY (ARRAY['clear'::text, 'manual_review'::text])));

alter table shorts_mvp.user_subscriptions add constraint user_subscriptions_contract_months_check CHECK (((contract_months IS NULL) OR (contract_months = ANY (ARRAY[1, 3, 6, 12])))) NOT VALID;

alter table shorts_mvp.user_subscriptions add constraint user_subscriptions_payment_provider_check CHECK (((payment_provider IS NULL) OR (payment_provider = ANY (ARRAY['nicepay'::text, 'thepayone'::text, 'toss'::text])))) NOT VALID;

alter table shorts_mvp.user_subscriptions add constraint user_subscriptions_pkey PRIMARY KEY (id);

alter table shorts_mvp.user_subscriptions add constraint user_subscriptions_provider_schedule_status_check CHECK ((provider_schedule_status = ANY (ARRAY['none'::text, 'active'::text, 'paused'::text, 'disposed'::text, 'manual_review'::text])));

alter table shorts_mvp.user_subscriptions add constraint user_subscriptions_retry_count_check CHECK (((retry_count >= 0) AND (retry_count <= 3)));

alter table shorts_mvp.user_subscriptions add constraint user_subscriptions_scheduled_billing_cycle_check CHECK (((scheduled_billing_cycle IS NULL) OR (scheduled_billing_cycle = ANY (ARRAY['monthly'::text, 'yearly'::text]))));

alter table shorts_mvp.user_subscriptions add constraint user_subscriptions_scheduled_billing_price_krw_check CHECK (((scheduled_billing_price_krw IS NULL) OR (scheduled_billing_price_krw > 0))) NOT VALID;

alter table shorts_mvp.user_subscriptions add constraint user_subscriptions_scheduled_contract_months_check CHECK (((scheduled_contract_months IS NULL) OR (scheduled_contract_months = ANY (ARRAY[1, 3, 6, 12])))) NOT VALID;

alter table shorts_mvp.user_subscriptions add constraint user_subscriptions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'trialing'::text, 'active'::text, 'past_due'::text, 'canceled'::text, 'expired'::text])));

alter table shorts_mvp.app_users add constraint app_users_selected_plan_code_fkey FOREIGN KEY (selected_plan_code) REFERENCES shorts_mvp.plans(code);

alter table shorts_mvp.billing_orders add constraint billing_orders_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES shorts_mvp.user_subscriptions(id) ON DELETE SET NULL;

alter table shorts_mvp.billing_orders add constraint billing_orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES shorts_mvp.app_users(id) ON DELETE CASCADE;

alter table shorts_mvp.billing_toss_checkout_intents add constraint billing_toss_checkout_intents_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES shorts_mvp.user_subscriptions(id) ON DELETE SET NULL;

alter table shorts_mvp.billing_toss_checkout_intents add constraint billing_toss_checkout_intents_user_id_fkey FOREIGN KEY (user_id) REFERENCES shorts_mvp.app_users(id) ON DELETE RESTRICT;

alter table shorts_mvp.usage_grants add constraint usage_grants_billing_order_id_fkey FOREIGN KEY (billing_order_id) REFERENCES shorts_mvp.billing_orders(id) ON DELETE RESTRICT;

alter table shorts_mvp.usage_grants add constraint usage_grants_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES shorts_mvp.user_subscriptions(id) ON DELETE CASCADE;

alter table shorts_mvp.usage_grants add constraint usage_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES shorts_mvp.app_users(id) ON DELETE CASCADE;

alter table shorts_mvp.user_subscriptions add constraint user_subscriptions_plan_code_fkey FOREIGN KEY (plan_code) REFERENCES shorts_mvp.plans(code);

alter table shorts_mvp.user_subscriptions add constraint user_subscriptions_scheduled_plan_code_fkey FOREIGN KEY (scheduled_plan_code) REFERENCES shorts_mvp.plans(code);

alter table shorts_mvp.user_subscriptions add constraint user_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES shorts_mvp.app_users(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX billing_orders_one_renewal_period_idx ON shorts_mvp.billing_orders USING btree (subscription_id, renewal_period_start) WHERE ((kind = 'subscription_renewal'::text) AND (renewal_period_start IS NOT NULL));

CREATE UNIQUE INDEX billing_orders_proration_refund_track_idx ON shorts_mvp.billing_orders USING btree (provider, proration_refund_track_id) WHERE (proration_refund_track_id IS NOT NULL);

CREATE UNIQUE INDEX billing_orders_proration_refund_transaction_idx ON shorts_mvp.billing_orders USING btree (provider, proration_refund_transaction_id) WHERE (proration_refund_transaction_id IS NOT NULL);

CREATE UNIQUE INDEX billing_orders_one_earlybird_product_per_user_idx ON shorts_mvp.billing_orders USING btree (user_id, product_code) WHERE ((kind = 'addon'::text) AND (status = ANY (ARRAY['pending'::text, 'processing'::text, 'succeeded'::text, 'manual_review'::text])) AND (product_code = ANY (ARRAY['earlybird_300'::text, 'earlybird_600'::text, 'earlybird_1000'::text])));

CREATE UNIQUE INDEX billing_orders_one_resubscription_in_flight_idx ON shorts_mvp.billing_orders USING btree (subscription_id) WHERE ((kind = 'subscription_change'::text) AND (product_code = 'easycut_pro_v2'::text) AND (status = ANY (ARRAY['pending'::text, 'processing'::text])));

CREATE UNIQUE INDEX billing_orders_one_package_product_per_user_idx ON shorts_mvp.billing_orders USING btree (user_id, product_code) WHERE ((purchase_limit_version = 1) AND (status = ANY (ARRAY['pending'::text, 'processing'::text, 'succeeded'::text, 'manual_review'::text])) AND (product_code = ANY (ARRAY['starter_3m'::text, 'starter_6m'::text, 'starter_12m'::text, 'expert_3m'::text, 'expert_6m'::text, 'expert_12m'::text])));

CREATE UNIQUE INDEX usage_grants_subscription_period_idx ON shorts_mvp.usage_grants USING btree (subscription_id, valid_from, kind) WHERE ((subscription_id IS NOT NULL) AND (kind = 'base'::text));

CREATE UNIQUE INDEX usage_grants_addon_order_idx ON shorts_mvp.usage_grants USING btree (billing_order_id) WHERE (kind = 'addon'::text);

CREATE UNIQUE INDEX usage_grants_one_feedback_reward_per_user_idx ON shorts_mvp.usage_grants USING btree (user_id, product_code) WHERE (product_code = 'feedback_reward_30m'::text);

CREATE UNIQUE INDEX usage_grants_editor_launch_bonus_subscription_idx ON shorts_mvp.usage_grants USING btree (subscription_id, product_code) WHERE ((subscription_id IS NOT NULL) AND (product_code = 'editor_launch_bonus_20260728'::text));

CREATE UNIQUE INDEX usage_grants_one_onboarding_welcome_per_user_idx ON shorts_mvp.usage_grants USING btree (user_id, product_code) WHERE (product_code = 'onboarding_welcome_20min_v1'::text);

CREATE UNIQUE INDEX usage_grants_one_shorts_10k_thank_you_per_user_idx ON shorts_mvp.usage_grants USING btree (user_id, product_code) WHERE (product_code = 'shorts_10k_thank_you_50min_v1'::text);

CREATE UNIQUE INDEX user_subscriptions_one_current_monthly_idx ON shorts_mvp.user_subscriptions USING btree (user_id) WHERE ((status = ANY (ARRAY['pending'::text, 'trialing'::text, 'active'::text, 'past_due'::text])) AND (billing_cycle = 'monthly'::text));

CREATE UNIQUE INDEX user_subscriptions_one_current_toss_idx ON shorts_mvp.user_subscriptions USING btree (user_id) WHERE ((payment_provider = 'toss'::text) AND (status = ANY (ARRAY['pending'::text, 'trialing'::text, 'active'::text, 'past_due'::text])));
