begin;

create table shorts_mvp.creator_support_programs (
  code text primary key,
  enrollment_open boolean not null default false,
  terms_version text not null,
  retired_at timestamptz,
  legal_review_version text,
  legal_review_reference text,
  legal_reviewed_at timestamptz,
  legal_reviewed_by uuid references shorts_mvp.app_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (not enrollment_open or (coalesce(legal_review_version=terms_version,false) and legal_reviewed_at is not null and retired_at is null))
);
insert into shorts_mvp.creator_support_programs(code,terms_version)
values ('creator_support_2026_v1','2026-09-11.v1');

create table shorts_mvp.creator_support_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  image_bytes bytea not null check (octet_length(image_bytes) between 1 and 262144),
  created_at timestamptz not null default now()
);
create index creator_support_assets_user_idx on shorts_mvp.creator_support_assets(user_id,created_at);

create table shorts_mvp.creator_support_enrollments (
  id uuid primary key default gen_random_uuid(),
  program_code text not null references shorts_mvp.creator_support_programs(code),
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  request_id uuid not null,
  platform text not null check (platform in ('youtube','instagram')),
  channel_hash text not null check (length(channel_hash)=64),
  channel_url text,
  channel_name text,
  asset_id uuid references shorts_mvp.creator_support_assets(id) on delete set null,
  terms_version text not null,
  consent_snapshot jsonb,
  consented_at timestamptz not null,
  activated_at timestamptz not null,
  support_ends_at timestamptz not null,
  promotion_ends_at timestamptz not null,
  promotion_status text not null default 'pending' check (promotion_status in ('pending','approved','stopped','expired')),
  rights_verified_at timestamptz,
  rights_verified_by uuid references shorts_mvp.app_users(id) on delete set null,
  terminated_at timestamptz,
  takedown_completed_at timestamptz,
  material_deleted_at timestamptz,
  evidence_deleted_at timestamptz,
  unique(program_code,user_id),
  unique(program_code,channel_hash),
  unique(user_id,request_id),
  check (support_ends_at>activated_at and promotion_ends_at>support_ends_at)
);
create index creator_support_enrollments_created_idx on shorts_mvp.creator_support_enrollments(activated_at desc);
create table shorts_mvp.creator_support_installments (
  enrollment_id uuid not null references shorts_mvp.creator_support_enrollments(id) on delete cascade,
  installment integer not null check (installment between 1 and 3),
  grant_id uuid not null unique references shorts_mvp.usage_grants(id),
  primary key(enrollment_id,installment)
);
create table shorts_mvp.creator_support_audit (
  id uuid primary key default gen_random_uuid(),
  program_code text not null references shorts_mvp.creator_support_programs(code),
  enrollment_id uuid references shorts_mvp.creator_support_enrollments(id) on delete cascade,
  actor_id uuid references shorts_mvp.app_users(id) on delete set null,
  action text not null,
  reference text,
  created_at timestamptz not null default now()
);
create index creator_support_audit_enrollment_idx on shorts_mvp.creator_support_audit(enrollment_id,created_at);

-- Every boundary is calculated from the original anchor, never the prior clamp.
create function shorts_mvp.creator_support_month(p_anchor timestamptz,p_months integer)
returns timestamptz language sql immutable strict
set search_path=shorts_mvp,pg_temp
as $$
  select (
    date_trunc('month',p_anchor at time zone 'Asia/Seoul') + make_interval(months=>p_months)
    + (least(extract(day from p_anchor at time zone 'Asia/Seoul')::integer,
        extract(day from date_trunc('month',p_anchor at time zone 'Asia/Seoul')
          + make_interval(months=>p_months+1) - interval '1 day')::integer)-1)*interval '1 day'
    + ((p_anchor at time zone 'Asia/Seoul')::time-time '00:00')
  ) at time zone 'Asia/Seoul'
$$;

-- Only the authenticated server can call this function. All three grants,
-- consent evidence and the enrollment either commit together or roll back.
create function shorts_mvp.enroll_creator_support(
  p_user_id uuid,p_request_id uuid,p_platform text,p_channel_hash text,
  p_channel_url text,p_channel_name text,p_asset_id uuid,
  p_terms_version text,p_consent_snapshot jsonb
)
returns uuid language plpgsql security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  program_row record;
  enrollment_id uuid;
  grant_id uuid;
  activated timestamptz;
  i integer;
begin
  select * into program_row from shorts_mvp.creator_support_programs
    where code='creator_support_2026_v1' for share;
  perform 1 from shorts_mvp.app_users where id=p_user_id and withdrawn_at is null for update;
  if not found then raise exception 'CREATOR_ACCOUNT_UNAVAILABLE'; end if;
  select id into enrollment_id from shorts_mvp.creator_support_enrollments
    where program_code='creator_support_2026_v1' and user_id=p_user_id;
  if enrollment_id is not null then return enrollment_id; end if;
  if program_row.retired_at is not null or not coalesce(program_row.enrollment_open,false) then raise exception 'CREATOR_ENROLLMENT_CLOSED'; end if;
  if p_terms_version is distinct from program_row.terms_version
    or program_row.legal_review_version is distinct from p_terms_version
    or program_row.legal_reviewed_at is null then raise exception 'CREATOR_TERMS_CHANGED'; end if;
  if (p_consent_snapshot->'consents') is distinct from
      '{"collection":true,"disclosure":true,"license":true}'::jsonb
    or (p_consent_snapshot->'ownsChannel') is distinct from 'true'::jsonb
    or jsonb_typeof(p_consent_snapshot->'terms') is distinct from 'array'
    then raise exception 'CREATOR_CONSENT_REQUIRED'; end if;
  if p_platform not in ('youtube','instagram') or length(p_channel_name) not between 1 and 60
    or length(p_channel_url) not between 1 and 400 or p_channel_hash !~ '^[a-f0-9]{64}$'
    then raise exception 'CREATOR_INVALID_CHANNEL'; end if;
  if p_asset_id is not null then
    perform 1 from shorts_mvp.creator_support_assets where id=p_asset_id and user_id=p_user_id for update;
    if not found then raise exception 'CREATOR_ASSET_UNAVAILABLE'; end if;
  end if;
  activated := clock_timestamp();
  insert into shorts_mvp.creator_support_enrollments (
    program_code,user_id,request_id,platform,channel_hash,channel_url,channel_name,asset_id,
    terms_version,consent_snapshot,consented_at,activated_at,support_ends_at,promotion_ends_at
  ) values (
    'creator_support_2026_v1',p_user_id,p_request_id,p_platform,p_channel_hash,p_channel_url,p_channel_name,p_asset_id,
    p_terms_version,p_consent_snapshot,activated,activated,
    shorts_mvp.creator_support_month(activated,3),shorts_mvp.creator_support_month(activated,12)
  ) returning id into enrollment_id;
  for i in 0..2 loop
    insert into shorts_mvp.usage_grants (
      user_id,kind,product_code,total_seconds,credited_seconds,valid_from,expires_at,status
    ) values (
      p_user_id,'addon','creator_support_30min_v1',1800,1800,
      shorts_mvp.creator_support_month(activated,i),shorts_mvp.creator_support_month(activated,i+1),'active'
    ) returning id into grant_id;
    insert into shorts_mvp.creator_support_installments values(enrollment_id,i+1,grant_id);
  end loop;
  insert into shorts_mvp.creator_support_audit(program_code,enrollment_id,actor_id,action)
    values ('creator_support_2026_v1',enrollment_id,p_user_id,'enrolled');
  return enrollment_id;
end;
$$;

alter table shorts_mvp.creator_support_programs enable row level security;
alter table shorts_mvp.creator_support_assets enable row level security;
alter table shorts_mvp.creator_support_enrollments enable row level security;
alter table shorts_mvp.creator_support_installments enable row level security;
alter table shorts_mvp.creator_support_audit enable row level security;
revoke all on shorts_mvp.creator_support_programs,shorts_mvp.creator_support_assets,
  shorts_mvp.creator_support_enrollments,shorts_mvp.creator_support_installments,shorts_mvp.creator_support_audit
  from public,anon,authenticated;
grant all on shorts_mvp.creator_support_programs,shorts_mvp.creator_support_assets,
  shorts_mvp.creator_support_enrollments,shorts_mvp.creator_support_installments,shorts_mvp.creator_support_audit to service_role;
revoke all on function shorts_mvp.creator_support_month(timestamptz,integer) from public,anon,authenticated;
grant execute on function shorts_mvp.creator_support_month(timestamptz,integer) to service_role;
revoke all on function shorts_mvp.enroll_creator_support(uuid,uuid,text,text,text,text,uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function shorts_mvp.enroll_creator_support(uuid,uuid,text,text,text,text,uuid,text,jsonb) to service_role;

commit;
