begin;

-- Opening balances are evidence-backed accounting, not fabricated API attempts.
create table shorts_mvp.youtube_quota_opening_balances (
  project_id text not null references shorts_mvp.youtube_quota_verifications(project_id),
  quota_day date not null,
  bucket text not null check(bucket in ('search','general')),
  purpose text not null check(purpose in ('analysis','trending','views','reusable','free','refresh')),
  units integer not null check(units>=0),
  observed_through timestamptz not null,
  evidence text not null check(length(evidence)>0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(project_id,quota_day,bucket,purpose),
  check(bucket<>'search' or purpose in ('views','reusable','free'))
);
alter table shorts_mvp.youtube_quota_opening_balances enable row level security;
alter table shorts_mvp.youtube_quota_verifications add column accounting_ready_from date;

-- Refuse accidental reductions/replacements of already counted usage.
create function shorts_mvp.guard_youtube_opening_balance() returns trigger
language plpgsql set search_path=pg_catalog,shorts_mvp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.project_id || ':' || new.quota_day::text,0));
  if TG_OP='UPDATE' and (new.units<old.units or new.observed_through<old.observed_through
    or (new.project_id,new.quota_day,new.bucket,new.purpose)
      is distinct from (old.project_id,old.quota_day,old.bucket,old.purpose)) then
    raise exception 'YOUTUBE_OPENING_BALANCE_CANNOT_DECREASE';
  end if;
  new.updated_at:=clock_timestamp();
  return new;
end $$;
create trigger youtube_opening_balance_monotonic before insert or update
on shorts_mvp.youtube_quota_opening_balances for each row
execute function shorts_mvp.guard_youtube_opening_balance();

create or replace function shorts_mvp.reserve_youtube_quota(p_project text,p_bucket text,p_purpose text,p_units integer)
returns uuid language plpgsql set search_path=pg_catalog,shorts_mvp as $$
declare d date := (clock_timestamp() at time zone 'America/Los_Angeles')::date;
  used_total bigint; used_background bigint; used_lane bigint; result uuid;
begin
  if p_project='' or p_units<1 or p_units>100 or p_bucket not in ('search','general')
    or p_purpose not in ('analysis','trending','views','reusable','free','refresh') then
    raise exception 'INVALID_YOUTUBE_QUOTA_RESERVATION';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_project || ':' || d::text,0));
  -- Foreground remains available during reconciliation, using its conservative
  -- opening balance. No background calls before accounting is confirmed.
  if p_purpose<>'analysis' and not exists(select 1 from shorts_mvp.youtube_quota_verifications
    where project_id=p_project and accounting_ready_from<=d) then return null; end if;
  select coalesce(sum(units),0),coalesce(sum(units) filter(where purpose<>'analysis'),0),
    coalesce(sum(units) filter(where purpose=p_purpose),0)
    into used_total,used_background,used_lane from (
      select units,purpose from shorts_mvp.youtube_quota_attempts where project_id=p_project and quota_day=d and bucket=p_bucket
      union all
      select units,purpose from shorts_mvp.youtube_quota_opening_balances where project_id=p_project and quota_day=d and bucket=p_bucket
    ) counted;
  if p_bucket='search' then
    if p_purpose not in ('views','reusable','free') or used_total+p_units>90
      or used_lane+p_units>(case p_purpose when 'views' then 40 when 'reusable' then 20 else 30 end) then return null; end if;
  elsif used_total+p_units>9000 or (p_purpose<>'analysis' and used_background+p_units>3000) then return null;
  end if;
  insert into shorts_mvp.youtube_quota_attempts(project_id,quota_day,bucket,purpose,units)
    values(p_project,d,p_bucket,p_purpose,p_units) returning id into result;
  return result;
end $$;
revoke all on function shorts_mvp.reserve_youtube_quota(text,text,text,integer) from public;
revoke all on function shorts_mvp.guard_youtube_opening_balance() from public;
commit;
