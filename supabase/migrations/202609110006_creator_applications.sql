begin;

-- Existing enrollments, consent evidence, installments and grants stay intact.
-- The new terms must receive their own real review; never carry a v1 attestation forward.
update shorts_mvp.creator_support_programs set enrollment_open=false,
  terms_version='2026-09-11.v2',updated_at=clock_timestamp()
where code='creator_support_2026_v1';

create table shorts_mvp.creator_support_applications (
  id uuid primary key default gen_random_uuid(),
  program_code text not null references shorts_mvp.creator_support_programs(code),
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  request_id uuid not null,
  state text not null default 'pending_review' check(state in ('pending_review','selected','rejected','withdrawn','expired')),
  phone_number text check(phone_number ~ '^01[016789]-[0-9]{3,4}-[0-9]{4}$'),
  terms_version text not null,
  consent_snapshot jsonb,
  submitted_at timestamptz not null default clock_timestamp(),
  reviewed_at timestamptz,
  selected_at timestamptz,
  selected_by uuid references shorts_mvp.app_users(id) on delete set null,
  enrollment_id uuid unique references shorts_mvp.creator_support_enrollments(id),
  personal_data_deleted_at timestamptz,
  unique(program_code,user_id), unique(user_id,request_id),
  check(state<>'selected' or (selected_at is not null and enrollment_id is not null))
);
create index creator_applications_submitted_idx on shorts_mvp.creator_support_applications(program_code,state,submitted_at desc);
create table shorts_mvp.creator_support_application_channels (
  application_id uuid not null references shorts_mvp.creator_support_applications(id) on delete cascade,
  program_code text not null references shorts_mvp.creator_support_programs(code),
  platform text not null check(platform in ('youtube','instagram')),
  channel_hash text not null check(channel_hash ~ '^[a-f0-9]{64}$'),
  channel_url text check(length(channel_url) between 1 and 400),
  primary key(application_id,platform), unique(program_code,channel_hash)
);
create table shorts_mvp.creator_support_application_audit (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references shorts_mvp.creator_support_applications(id) on delete cascade,
  actor_id uuid references shorts_mvp.app_users(id) on delete set null,
  action text not null,
  reference text,
  created_at timestamptz not null default clock_timestamp()
);
create index creator_application_audit_idx on shorts_mvp.creator_support_application_audit(application_id,created_at);

create function shorts_mvp.submit_creator_application(
  p_user_id uuid,p_request_id uuid,p_phone text,p_channels jsonb,p_terms text,p_consent jsonb
) returns uuid language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
declare program_row record; application_id uuid; channel jsonb;
begin
  select * into program_row from shorts_mvp.creator_support_programs where code='creator_support_2026_v1' for share;
  perform 1 from shorts_mvp.app_users where id=p_user_id and withdrawn_at is null for update;
  if not found then raise exception 'CREATOR_ACCOUNT_UNAVAILABLE'; end if;
  select id into application_id from shorts_mvp.creator_support_applications where program_code=program_row.code and user_id=p_user_id;
  if application_id is not null then return application_id; end if;
  if exists(select 1 from shorts_mvp.creator_support_enrollments where program_code=program_row.code and user_id=p_user_id) then
    raise exception 'CREATOR_ALREADY_ENROLLED'; end if;
  if program_row.retired_at is not null or not coalesce(program_row.enrollment_open,false) then raise exception 'CREATOR_ENROLLMENT_CLOSED'; end if;
  if p_terms is distinct from '2026-09-11.v2' or p_terms is distinct from program_row.terms_version
    or program_row.legal_review_version is distinct from p_terms or program_row.legal_reviewed_at is null then raise exception 'CREATOR_TERMS_CHANGED'; end if;
  if (select count(*) from shorts_mvp.creator_support_applications where program_code=program_row.code and selected_at is not null)>=10 then raise exception 'CREATOR_SELECTION_FULL'; end if;
  if (p_consent->'consents') is distinct from '{"collection":true,"disclosure":true,"license":true}'::jsonb
    or (p_consent->'ownsChannel') is distinct from 'true'::jsonb or jsonb_typeof(p_consent->'terms') is distinct from 'array'
    then raise exception 'CREATOR_CONSENT_REQUIRED'; end if;
  if p_phone is null or p_phone !~ '^01[016789]-[0-9]{3,4}-[0-9]{4}$' then raise exception 'CREATOR_INVALID_PHONE'; end if;
  if jsonb_typeof(p_channels) is distinct from 'array' then raise exception 'CREATOR_INVALID_CHANNEL'; end if;
  if jsonb_array_length(p_channels) not between 1 and 2 then raise exception 'CREATOR_INVALID_CHANNEL'; end if;
  insert into shorts_mvp.creator_support_applications(program_code,user_id,request_id,phone_number,terms_version,consent_snapshot)
    values(program_row.code,p_user_id,p_request_id,p_phone,p_terms,p_consent) returning id into application_id;
  for channel in select value from jsonb_array_elements(p_channels) loop
    if channel->>'platform' is null or channel->>'platform' not in ('youtube','instagram')
      or channel->>'channelHash' is null or channel->>'channelHash' !~ '^[a-f0-9]{64}$'
      or channel->>'channelUrl' is null or length(channel->>'channelUrl') not between 1 and 400 then raise exception 'CREATOR_INVALID_CHANNEL'; end if;
    if exists(select 1 from shorts_mvp.creator_support_enrollments where program_code=program_row.code and channel_hash=channel->>'channelHash')
      then raise exception 'CREATOR_DUPLICATE_CHANNEL'; end if;
    insert into shorts_mvp.creator_support_application_channels values(application_id,program_row.code,channel->>'platform',channel->>'channelHash',channel->>'channelUrl');
  end loop;
  insert into shorts_mvp.creator_support_application_audit(application_id,actor_id,action) values(application_id,p_user_id,'submitted');
  return application_id;
end $$;

-- Serializes the 10-person cap and idempotent selection. Grants are created only here.
create function shorts_mvp.select_creator_application(p_application_id uuid,p_admin_id uuid,p_reference text)
returns uuid language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
<<selection>>
declare program_row record; app record; channel record; enrollment_id uuid; grant_id uuid; activated timestamptz; i integer;
begin
  select * into program_row from shorts_mvp.creator_support_programs where code='creator_support_2026_v1' for update;
  perform 1 from shorts_mvp.app_users where id=p_admin_id and is_admin=true and withdrawn_at is null;
  if not found then raise exception 'CREATOR_ADMIN_REQUIRED'; end if;
  select * into app from shorts_mvp.creator_support_applications where id=p_application_id and program_code=program_row.code for update;
  if not found then raise exception 'CREATOR_APPLICATION_NOT_FOUND'; end if;
  if app.state='selected' then return app.enrollment_id; end if;
  if app.state<>'pending_review' or app.submitted_at<=clock_timestamp()-interval '90 days' then raise exception 'CREATOR_APPLICATION_CLOSED'; end if;
  if program_row.retired_at is not null or app.terms_version is distinct from program_row.terms_version
    or program_row.legal_review_version is distinct from app.terms_version or program_row.legal_reviewed_at is null then raise exception 'CREATOR_TERMS_CHANGED'; end if;
  if p_reference is null or length(trim(p_reference)) not between 5 and 500 then raise exception 'CREATOR_REVIEW_REQUIRED'; end if;
  perform 1 from shorts_mvp.app_users where id=app.user_id and withdrawn_at is null for update;
  if not found then raise exception 'CREATOR_ACCOUNT_UNAVAILABLE'; end if;
  if (select count(*) from shorts_mvp.creator_support_applications where program_code=program_row.code and selected_at is not null)>=10 then raise exception 'CREATOR_SELECTION_FULL'; end if;
  select * into channel from shorts_mvp.creator_support_application_channels where application_id=app.id and channel_url is not null order by platform desc limit 1;
  if not found then raise exception 'CREATOR_INVALID_CHANNEL'; end if;
  activated:=clock_timestamp();
  insert into shorts_mvp.creator_support_enrollments(program_code,user_id,request_id,platform,channel_hash,channel_url,channel_name,
    terms_version,consent_snapshot,consented_at,activated_at,support_ends_at,promotion_ends_at)
  values(program_row.code,app.user_id,app.request_id,channel.platform,channel.channel_hash,channel.channel_url,
    case when channel.platform='youtube' then '유튜브' else '인스타그램' end,
    app.terms_version,app.consent_snapshot,app.submitted_at,activated,shorts_mvp.creator_support_month(activated,3),shorts_mvp.creator_support_month(activated,12)) returning id into enrollment_id;
  for i in 0..2 loop
    insert into shorts_mvp.usage_grants(user_id,kind,product_code,total_seconds,credited_seconds,valid_from,expires_at,status)
      values(app.user_id,'addon','creator_support_100min_v2',6000,6000,shorts_mvp.creator_support_month(activated,i),shorts_mvp.creator_support_month(activated,i+1),'active') returning id into grant_id;
    insert into shorts_mvp.creator_support_installments values(enrollment_id,i+1,grant_id);
  end loop;
  update shorts_mvp.creator_support_applications set state='selected',selected_at=activated,reviewed_at=activated,
    selected_by=p_admin_id,enrollment_id=selection.enrollment_id where id=app.id;
  insert into shorts_mvp.creator_support_application_audit(application_id,actor_id,action,reference) values(app.id,p_admin_id,'selected',p_reference);
  insert into shorts_mvp.creator_support_audit(program_code,enrollment_id,actor_id,action,reference) values(program_row.code,enrollment_id,p_admin_id,'selected',p_reference);
  if (select count(*) from shorts_mvp.creator_support_applications where program_code=program_row.code and selected_at is not null)>=10 then
    update shorts_mvp.creator_support_programs set enrollment_open=false,updated_at=activated where code=program_row.code;
  end if;
  return enrollment_id;
end $$;

alter table shorts_mvp.creator_support_applications enable row level security;
alter table shorts_mvp.creator_support_application_channels enable row level security;
alter table shorts_mvp.creator_support_application_audit enable row level security;
revoke all on shorts_mvp.creator_support_applications,shorts_mvp.creator_support_application_channels,shorts_mvp.creator_support_application_audit from public,anon,authenticated;
grant all on shorts_mvp.creator_support_applications,shorts_mvp.creator_support_application_channels,shorts_mvp.creator_support_application_audit to service_role;
revoke all on function shorts_mvp.submit_creator_application(uuid,uuid,text,jsonb,text,jsonb),shorts_mvp.select_creator_application(uuid,uuid,text) from public,anon,authenticated;
grant execute on function shorts_mvp.submit_creator_application(uuid,uuid,text,jsonb,text,jsonb),shorts_mvp.select_creator_application(uuid,uuid,text) to service_role;

-- Extend the exact prior reservation function, preserving all other products and rules.
do $$ declare source text; begin
  select pg_get_functiondef('shorts_mvp.reserve_usage_grants(uuid,uuid,integer)'::regprocedure) into source;
  if position('creator_support_30min_v1' in source)=0 then raise exception 'CREATOR_USAGE_BASELINE_MISMATCH'; end if;
  if position('creator_support_100min_v2' in source)>0 then raise exception 'CREATOR_USAGE_ALREADY_MIGRATED'; end if;
  execute replace(source,'''creator_support_30min_v1''','''creator_support_30min_v1'', ''creator_support_100min_v2''');
end $$;
commit;
