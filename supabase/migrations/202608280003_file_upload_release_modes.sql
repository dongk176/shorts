begin;

set local lock_timeout = '3s';

insert into shorts_mvp.runtime_feature_flags (
  flag_key,enabled,description
) values
  (
    'file_upload',false,
    '파일 업로드 신규 세션 허용 스위치'
  ),
  (
    'file_upload_public',false,
    '검증된 파일 업로드 기능의 전체 공개 스위치'
  ),
  (
    'file_upload_emergency_stop',false,
    '파일 업로드 신규 수신과 진행 중 수신을 즉시 중단하는 비상 스위치'
  )
on conflict (flag_key) do nothing;

create table if not exists shorts_mvp.file_upload_release_checks (
  check_key text primary key check (
    check_key in (
      'admin_end_to_end','render_parity','upload_1gb','upload_5gb',
      'source_cleanup','usage_integrity','runtime_identity',
      'no_proxy_environment','no_stuck_sessions'
    )
  ),
  passed boolean not null default false,
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details)='object'),
  verified_at timestamptz,
  verified_by_user_id uuid
    references shorts_mvp.app_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into shorts_mvp.file_upload_release_checks (check_key)
values
  ('admin_end_to_end'),('render_parity'),('upload_1gb'),('upload_5gb'),
  ('source_cleanup'),('usage_integrity'),('runtime_identity'),
  ('no_proxy_environment'),('no_stuck_sessions')
on conflict (check_key) do nothing;

alter table shorts_mvp.file_upload_release_checks enable row level security;
revoke all on shorts_mvp.file_upload_release_checks from anon,authenticated;
grant select,insert,update on shorts_mvp.file_upload_release_checks
  to service_role;

create or replace function shorts_mvp.record_file_upload_release_check(
  p_check_key text,
  p_passed boolean,
  p_details jsonb,
  p_admin_user_id uuid
)
returns shorts_mvp.file_upload_release_checks
language plpgsql
security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  v_row shorts_mvp.file_upload_release_checks;
begin
  if not exists (
    select 1 from shorts_mvp.app_users
    where id=p_admin_user_id and is_admin
  ) then
    raise exception 'administrator required' using errcode='42501';
  end if;
  if p_check_key not in (
    'admin_end_to_end','render_parity','upload_1gb','upload_5gb',
    'source_cleanup','usage_integrity','runtime_identity',
    'no_proxy_environment','no_stuck_sessions'
  ) then
    raise exception 'invalid file upload release check' using errcode='22023';
  end if;
  if p_details is null or jsonb_typeof(p_details)<>'object' then
    raise exception 'file upload release check details must be an object'
      using errcode='22023';
  end if;

  insert into shorts_mvp.file_upload_release_checks (
    check_key,passed,details,verified_at,verified_by_user_id,updated_at
  ) values (
    p_check_key,p_passed,p_details,clock_timestamp(),p_admin_user_id,
    clock_timestamp()
  )
  on conflict (check_key) do update
  set passed=excluded.passed,
      details=excluded.details,
      verified_at=excluded.verified_at,
      verified_by_user_id=excluded.verified_by_user_id,
      updated_at=excluded.updated_at
  returning * into v_row;

  insert into shorts_mvp.admin_audit_logs (
    actor_user_id,action,entity_type,entity_id,metadata
  ) values (
    p_admin_user_id,'file_upload.release_check_recorded',
    'file_upload_release',p_check_key,
    jsonb_build_object('passed',p_passed,'details',p_details)
  );
  return v_row;
end;
$$;

revoke all on function shorts_mvp.record_file_upload_release_check(
  text,boolean,jsonb,uuid
) from public,anon,authenticated;
grant execute on function shorts_mvp.record_file_upload_release_check(
  text,boolean,jsonb,uuid
) to service_role;

create or replace function shorts_mvp.set_file_upload_release_mode(
  p_mode text,
  p_admin_user_id uuid
)
returns table (
  mode text,
  feature_enabled boolean,
  public_enabled boolean,
  emergency_stopped boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  v_feature boolean;
  v_public boolean;
  v_emergency boolean;
  v_updated_at timestamptz;
  v_missing_checks text[];
begin
  if not exists (
    select 1 from shorts_mvp.app_users
    where id=p_admin_user_id and is_admin
  ) then
    raise exception 'administrator required' using errcode='42501';
  end if;
  if p_mode not in ('stopped','admin_test','public','emergency_stop') then
    raise exception 'invalid file upload mode' using errcode='22023';
  end if;

  if p_mode='public' then
    select array_agg(required.check_key order by required.check_key)
    into v_missing_checks
    from (
      values
        ('admin_end_to_end'),('render_parity'),('upload_1gb'),('upload_5gb'),
        ('source_cleanup'),('usage_integrity'),('runtime_identity'),
        ('no_proxy_environment'),('no_stuck_sessions')
    ) required(check_key)
    left join shorts_mvp.file_upload_release_checks checked
      on checked.check_key=required.check_key
      and checked.passed
      and checked.verified_at>=clock_timestamp()-interval '24 hours'
    where checked.check_key is null;
    if coalesce(cardinality(v_missing_checks),0)>0 then
      raise exception 'file upload public checks are incomplete: %',
        array_to_string(v_missing_checks,',') using errcode='23514';
    end if;
  end if;

  v_feature := p_mode in ('admin_test','public');
  v_public := p_mode='public';
  v_emergency := p_mode='emergency_stop';

  perform 1 from shorts_mvp.runtime_feature_flags
  where flag_key in (
    'file_upload','file_upload_public','file_upload_emergency_stop'
  ) for update;
  if (
    select count(*)
    from shorts_mvp.runtime_feature_flags
    where flag_key in (
      'file_upload','file_upload_public','file_upload_emergency_stop'
    )
  ) <> 3 then
    raise exception 'file upload release flags are incomplete'
      using errcode='23514';
  end if;

  update shorts_mvp.runtime_feature_flags
  set enabled=case flag_key
      when 'file_upload' then v_feature
      when 'file_upload_public' then v_public
      when 'file_upload_emergency_stop' then v_emergency
    end,
    updated_by_user_id=p_admin_user_id
  where flag_key in (
    'file_upload','file_upload_public','file_upload_emergency_stop'
  );
  select max(flag.updated_at) into v_updated_at
  from shorts_mvp.runtime_feature_flags flag
  where flag.flag_key in (
    'file_upload','file_upload_public','file_upload_emergency_stop'
  );

  insert into shorts_mvp.admin_audit_logs (
    actor_user_id,action,entity_type,entity_id,metadata
  ) values (
    p_admin_user_id,'file_upload.release_mode_changed',
    'file_upload_release','singleton',
    jsonb_build_object('mode',p_mode)
  );

  return query select p_mode,v_feature,v_public,v_emergency,v_updated_at;
end;
$$;

revoke all on function shorts_mvp.set_file_upload_release_mode(text,uuid)
  from public,anon,authenticated;
grant execute on function shorts_mvp.set_file_upload_release_mode(text,uuid)
  to service_role;

comment on function shorts_mvp.set_file_upload_release_mode(text,uuid) is
  'Atomically changes all file-upload release flags; public mode requires fresh release checks.';

comment on function shorts_mvp.record_file_upload_release_check(
  text,boolean,jsonb,uuid
) is 'Stores auditable evidence for one public file-upload prerequisite.';

commit;
