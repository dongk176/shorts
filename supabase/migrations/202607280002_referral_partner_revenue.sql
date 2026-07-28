begin;

create table shorts_mvp.referral_partners (
  id uuid primary key default gen_random_uuid(),
  create_request_id uuid not null unique,
  creator_name text not null check (char_length(creator_name) between 1 and 100),
  slug text not null check (
    char_length(slug) between 3 and 32
    and slug = lower(slug)
    and slug ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
    and slug not in (
      'account','admin','ai-shorts-maker','api','auth','billing','compare','faq',
      'partner','payment-test','popular','pricing','pricing-2','privacy','projects',
      'purchase-terms','refund','settings','support','templates','terms'
    )
  ),
  commission_rate_bps integer not null default 2000
    check (commission_rate_bps between 0 and 10000),
  status text not null default 'active'
    check (status in ('active','paused','terminated')),
  recovery_email text,
  bank_name text,
  account_holder text,
  account_number_ciphertext text,
  account_number_iv text,
  account_number_tag text,
  account_number_last4 text check (
    account_number_last4 is null or account_number_last4 ~ '^[0-9]{2,4}$'
  ),
  payout_profile_updated_at timestamptz,
  created_by_user_id uuid references shorts_mvp.app_users(id) on delete set null,
  terminated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slug)
);

create table shorts_mvp.referral_partner_credentials (
  partner_id uuid primary key references shorts_mvp.referral_partners(id) on delete cascade,
  login_id text not null unique check (
    char_length(login_id) between 3 and 32
    and login_id = lower(login_id)
    and login_id ~ '^[a-z][a-z0-9._-]*$'
  ),
  password_hash text not null check (char_length(password_hash) between 64 and 256),
  password_salt text not null check (password_salt ~ '^[0-9a-f]{32}$'),
  password_version integer not null default 1 check (password_version >= 1),
  must_change_password boolean not null default true,
  password_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table shorts_mvp.referral_partner_sessions (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references shorts_mvp.referral_partners(id) on delete cascade,
  token_hash text not null unique check (length(token_hash) = 64),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index referral_partner_sessions_active_idx
  on shorts_mvp.referral_partner_sessions (partner_id,expires_at)
  where revoked_at is null;

create table shorts_mvp.referral_partner_login_attempts (
  id bigint generated always as identity primary key,
  login_id_hash text not null check (length(login_id_hash) = 64),
  ip_hash text not null check (length(ip_hash) = 64),
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);
create index referral_partner_login_attempts_limit_idx
  on shorts_mvp.referral_partner_login_attempts
  (login_id_hash,ip_hash,attempted_at desc);

create table shorts_mvp.referral_visitors (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (length(token_hash) = 64),
  partner_id uuid not null references shorts_mvp.referral_partners(id) on delete restrict,
  first_campaign text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at > first_seen_at)
);
create index referral_visitors_partner_seen_idx
  on shorts_mvp.referral_visitors (partner_id,first_seen_at desc);
create index referral_visitors_expiry_idx
  on shorts_mvp.referral_visitors (expires_at);

create table shorts_mvp.referral_clicks (
  id bigint generated always as identity primary key,
  clicked_partner_id uuid not null references shorts_mvp.referral_partners(id) on delete restrict,
  visitor_id uuid references shorts_mvp.referral_visitors(id) on delete set null,
  campaign text,
  is_attribution_candidate boolean not null default false,
  eligibility_reason text not null check (
    eligibility_reason in (
      'eligible_first_click','existing_first_click','existing_member',
      'partner_not_active','invalid_cookie'
    )
  ),
  occurred_at timestamptz not null default now()
);
create index referral_clicks_partner_occurred_idx
  on shorts_mvp.referral_clicks (clicked_partner_id,occurred_at desc);
create index referral_clicks_visitor_occurred_idx
  on shorts_mvp.referral_clicks (visitor_id,occurred_at desc)
  where visitor_id is not null;

alter table shorts_mvp.app_users
  add column referral_partner_id uuid references shorts_mvp.referral_partners(id) on delete set null,
  add column referral_visitor_id uuid references shorts_mvp.referral_visitors(id) on delete set null,
  add column referral_attributed_at timestamptz;
alter table shorts_mvp.app_users
  add constraint app_users_referral_attribution_check check (
    (
      referral_partner_id is null
      and referral_visitor_id is null
      and referral_attributed_at is null
    )
    or (
      referral_partner_id is not null
      and referral_attributed_at is not null
    )
  );
create index app_users_referral_partner_created_idx
  on shorts_mvp.app_users (referral_partner_id,created_at desc)
  where referral_partner_id is not null;

create table shorts_mvp.referral_attribution_audits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  previous_partner_id uuid references shorts_mvp.referral_partners(id) on delete set null,
  new_partner_id uuid references shorts_mvp.referral_partners(id) on delete set null,
  visitor_id uuid references shorts_mvp.referral_visitors(id) on delete set null,
  changed_by_user_id uuid references shorts_mvp.app_users(id) on delete set null,
  reason text not null check (char_length(reason) between 2 and 500),
  created_at timestamptz not null default now()
);
create index referral_attribution_audits_user_created_idx
  on shorts_mvp.referral_attribution_audits (user_id,created_at desc);

create table shorts_mvp.referral_commissions (
  id uuid primary key default gen_random_uuid(),
  billing_order_id uuid not null unique
    references shorts_mvp.billing_orders(id) on delete cascade,
  partner_id uuid not null references shorts_mvp.referral_partners(id) on delete restrict,
  user_id uuid references shorts_mvp.app_users(id) on delete set null,
  commission_rate_bps integer not null check (commission_rate_bps between 0 and 10000),
  gross_amount_krw integer not null check (gross_amount_krw >= 0),
  refunded_amount_krw integer not null default 0 check (
    refunded_amount_krw >= 0 and refunded_amount_krw <= gross_amount_krw
  ),
  commission_amount_krw integer not null default 0 check (commission_amount_krw >= 0),
  available_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index referral_commissions_partner_available_idx
  on shorts_mvp.referral_commissions (partner_id,available_at,created_at);

create table shorts_mvp.referral_commission_events (
  id bigint generated always as identity primary key,
  commission_id uuid not null references shorts_mvp.referral_commissions(id) on delete cascade,
  event_kind text not null check (
    event_kind in ('earned','refund_adjustment','correction')
  ),
  amount_delta_krw integer not null check (amount_delta_krw <> 0),
  target_commission_krw integer not null check (target_commission_krw >= 0),
  source_refunded_amount_krw integer not null check (source_refunded_amount_krw >= 0),
  created_at timestamptz not null default now(),
  unique (commission_id,target_commission_krw,source_refunded_amount_krw)
);
create index referral_commission_events_commission_created_idx
  on shorts_mvp.referral_commission_events (commission_id,created_at);

create table shorts_mvp.referral_payouts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  partner_id uuid not null references shorts_mvp.referral_partners(id) on delete restrict,
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  commission_cutoff_at timestamptz not null,
  amount_krw integer not null check (amount_krw >= 0),
  status text not null default 'draft' check (status in ('draft','paid','canceled')),
  bank_name_snapshot text,
  account_holder_snapshot text,
  account_number_ciphertext_snapshot text,
  account_number_iv_snapshot text,
  account_number_tag_snapshot text,
  account_number_last4_snapshot text,
  transfer_reference text,
  note text,
  created_by_user_id uuid not null references shorts_mvp.app_users(id) on delete restrict,
  paid_by_user_id uuid references shorts_mvp.app_users(id) on delete restrict,
  paid_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index referral_payouts_partner_created_idx
  on shorts_mvp.referral_payouts (partner_id,created_at desc);
create unique index referral_payouts_active_period_idx
  on shorts_mvp.referral_payouts (partner_id,period_start,period_end)
  where status in ('draft','paid');

create table shorts_mvp.referral_partner_audit_logs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid unique,
  partner_id uuid references shorts_mvp.referral_partners(id) on delete set null,
  actor_type text not null check (actor_type in ('admin','partner','system')),
  actor_admin_user_id uuid references shorts_mvp.app_users(id) on delete set null,
  action text not null check (char_length(action) between 2 and 100),
  entity_type text not null check (char_length(entity_type) between 2 and 100),
  entity_id text not null check (char_length(entity_id) between 1 and 200),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index referral_partner_audit_logs_partner_created_idx
  on shorts_mvp.referral_partner_audit_logs (partner_id,created_at desc);

create or replace function shorts_mvp.sync_referral_commission()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, shorts_mvp
as $$
declare
  existing_commission shorts_mvp.referral_commissions%rowtype;
  selected_partner shorts_mvp.referral_partners%rowtype;
  target_commission integer;
  commission_delta integer;
  commission_id uuid;
begin
  if new.amount_krw <= 0 then
    return new;
  end if;

  select *
  into existing_commission
  from shorts_mvp.referral_commissions
  where billing_order_id = new.id
  for update;

  if found then
    target_commission := floor(
      greatest(new.amount_krw - new.refunded_amount_krw, 0)::numeric
      * existing_commission.commission_rate_bps
      / 10000
    )::integer;
    commission_delta := target_commission - existing_commission.commission_amount_krw;
    commission_id := existing_commission.id;

    update shorts_mvp.referral_commissions
    set gross_amount_krw = new.amount_krw,
      refunded_amount_krw = new.refunded_amount_krw,
      commission_amount_krw = target_commission,
      updated_at = now()
    where id = commission_id;

    if commission_delta <> 0 then
      insert into shorts_mvp.referral_commission_events (
        commission_id,event_kind,amount_delta_krw,target_commission_krw,
        source_refunded_amount_krw
      ) values (
        commission_id,
        case when commission_delta < 0 then 'refund_adjustment' else 'correction' end,
        commission_delta,target_commission,new.refunded_amount_krw
      ) on conflict do nothing;
    end if;
    return new;
  end if;

  if new.status <> 'succeeded' or new.approved_at is null then
    return new;
  end if;

  select p.*
  into selected_partner
  from shorts_mvp.app_users u
  join shorts_mvp.referral_partners p on p.id = u.referral_partner_id
  where u.id = new.user_id
    and (
      p.status <> 'terminated'
      or p.terminated_at is null
      or new.approved_at < p.terminated_at
    )
  limit 1;

  if not found then
    return new;
  end if;

  target_commission := floor(
    greatest(new.amount_krw - new.refunded_amount_krw, 0)::numeric
    * selected_partner.commission_rate_bps
    / 10000
  )::integer;

  insert into shorts_mvp.referral_commissions (
    billing_order_id,partner_id,user_id,commission_rate_bps,gross_amount_krw,
    refunded_amount_krw,commission_amount_krw,available_at
  ) values (
    new.id,selected_partner.id,new.user_id,selected_partner.commission_rate_bps,
    new.amount_krw,new.refunded_amount_krw,target_commission,
    new.approved_at + interval '7 days'
  )
  on conflict (billing_order_id) do nothing
  returning id into commission_id;

  if commission_id is not null and target_commission <> 0 then
    insert into shorts_mvp.referral_commission_events (
      commission_id,event_kind,amount_delta_krw,target_commission_krw,
      source_refunded_amount_krw
    ) values (
      commission_id,'earned',target_commission,target_commission,new.refunded_amount_krw
    ) on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists billing_orders_referral_commission_insert
  on shorts_mvp.billing_orders;
create trigger billing_orders_referral_commission_insert
after insert on shorts_mvp.billing_orders
for each row execute function shorts_mvp.sync_referral_commission();

drop trigger if exists billing_orders_referral_commission_update
  on shorts_mvp.billing_orders;
create trigger billing_orders_referral_commission_update
after update of status,amount_krw,refunded_amount_krw,approved_at,user_id
on shorts_mvp.billing_orders
for each row execute function shorts_mvp.sync_referral_commission();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'referral_partners','referral_partner_credentials','referral_partner_sessions',
    'referral_partner_login_attempts','referral_visitors','referral_clicks',
    'referral_attribution_audits','referral_commissions','referral_commission_events',
    'referral_payouts','referral_partner_audit_logs'
  ] loop
    execute format('alter table shorts_mvp.%I enable row level security', table_name);
    execute format('revoke all on table shorts_mvp.%I from anon, authenticated', table_name);
    execute format('grant all on table shorts_mvp.%I to service_role', table_name);
  end loop;
end $$;

grant usage, select on all sequences in schema shorts_mvp to service_role;

drop trigger if exists referral_partners_set_updated_at
  on shorts_mvp.referral_partners;
create trigger referral_partners_set_updated_at
before update on shorts_mvp.referral_partners
for each row execute function shorts_mvp.set_updated_at();

drop trigger if exists referral_partner_credentials_set_updated_at
  on shorts_mvp.referral_partner_credentials;
create trigger referral_partner_credentials_set_updated_at
before update on shorts_mvp.referral_partner_credentials
for each row execute function shorts_mvp.set_updated_at();

drop trigger if exists referral_commissions_set_updated_at
  on shorts_mvp.referral_commissions;
create trigger referral_commissions_set_updated_at
before update on shorts_mvp.referral_commissions
for each row execute function shorts_mvp.set_updated_at();

drop trigger if exists referral_payouts_set_updated_at
  on shorts_mvp.referral_payouts;
create trigger referral_payouts_set_updated_at
before update on shorts_mvp.referral_payouts
for each row execute function shorts_mvp.set_updated_at();

commit;
