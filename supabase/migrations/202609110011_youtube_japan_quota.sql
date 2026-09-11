begin;
-- Default keeps Japan search disabled. The approved KR 90 + JP 10 allocation
-- requires recorded evidence and a verified 100-call Google limit before JP runs.
alter table shorts_mvp.youtube_quota_verifications add column japan_search_daily_ceiling integer not null default 90 check(japan_search_daily_ceiling in (90,100));
create function shorts_mvp.reserve_youtube_region_quota(p_project text,p_bucket text,p_purpose text,p_units integer,p_region text)
returns uuid language plpgsql set search_path=pg_catalog,shorts_mvp as $$
declare d date := (clock_timestamp() at time zone 'America/Los_Angeles')::date;
  used_total bigint; used_region bigint; used_lane bigint; used_background bigint;
  result uuid; search_ceiling integer := 90; verification shorts_mvp.youtube_quota_verifications%rowtype;
begin
  if p_project='' or p_units<1 or p_units>100 or p_region not in ('KR','JP') or p_bucket not in ('search','general')
    or p_purpose not in ('analysis','trending','views','reusable','free','refresh')
    or (p_region='JP' and p_purpose not in ('trending','views','reusable')) then
    raise exception 'INVALID_YOUTUBE_QUOTA_RESERVATION';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_project || ':' || d::text,0));
  select * into verification from shorts_mvp.youtube_quota_verifications where project_id=p_project;
  if p_purpose<>'analysis' and (verification.accounting_ready_from is null or verification.accounting_ready_from>d) then return null; end if;
  if p_region='JP' and (not coalesce(verification.japan_collection_enabled,false) or verification.japan_activated_at is null or verification.japan_verified_at is null or verification.japan_verified_at<=clock_timestamp()-interval '7 days'
    or coalesce(length(verification.japan_evidence),0)=0 or not verification.other_clients_reviewed
    or verification.search_daily_limit<100 or verification.general_daily_limit<10000) then return null; end if;
  -- KR must retain all 90 calls even after JP verification expires or is disabled.
  -- The regional caps remain authoritative; JP eligibility is checked above.
  search_ceiling:=100;
  select coalesce(sum(units),0),coalesce(sum(units) filter(where region_code=p_region),0),
    coalesce(sum(units) filter(where region_code=p_region and purpose=p_purpose),0),
    coalesce(sum(units) filter(where region_code=p_region and purpose<>'analysis'),0)
    into used_total,used_region,used_lane,used_background from (
      select units,purpose,region_code from shorts_mvp.youtube_quota_attempts where project_id=p_project and quota_day=d and bucket=p_bucket
      union all
      select units,purpose,'KR' from shorts_mvp.youtube_quota_opening_balances where project_id=p_project and quota_day=d and bucket=p_bucket
    ) counted;
  if p_bucket='search' then
    if p_purpose not in ('views','reusable','free') or used_total+p_units>search_ceiling then return null; end if;
    if p_region='JP' then
      -- The existing Korean allocation is reserved, not first-come-first-served.
      if coalesce(verification.japan_search_daily_ceiling,90)<100 then return null; end if;
      if used_region+p_units>10 or used_lane+p_units>(case p_purpose when 'reusable' then 7 when 'views' then 3 else 0 end) then return null; end if;
    elsif used_region+p_units>90 or used_lane+p_units>(case p_purpose when 'views' then 40 when 'reusable' then 20 else 30 end) then return null;
    end if;
  else
    -- Preserve the full KR 9000/3000 allocation; JP uses at most 17 of the existing 1000-unit buffer.
    if used_total+p_units>9017 or (p_region='KR' and used_region+p_units>9000) then return null; end if;
    if p_region='JP' then
      if used_region+p_units>17 or used_lane+p_units>(case p_purpose when 'views' then 3 else 7 end) then return null; end if;
    elsif p_purpose<>'analysis' and used_background+p_units>3000 then return null;
    end if;
  end if;
  insert into shorts_mvp.youtube_quota_attempts(project_id,quota_day,bucket,purpose,units,region_code)
    values(p_project,d,p_bucket,p_purpose,p_units,p_region) returning id into result;
  return result;
end $$;
-- Preserve the existing original-video API entry point and its allocation.
create or replace function shorts_mvp.reserve_youtube_quota(p_project text,p_bucket text,p_purpose text,p_units integer)
returns uuid language sql set search_path=pg_catalog,shorts_mvp as $$
  select shorts_mvp.reserve_youtube_region_quota(p_project,p_bucket,p_purpose,p_units,'KR')
$$;
create function shorts_mvp.reserve_youtube_japan_quota(p_project text,p_bucket text,p_purpose text,p_units integer)
returns uuid language sql set search_path=pg_catalog,shorts_mvp as $$
  select shorts_mvp.reserve_youtube_region_quota(p_project,p_bucket,p_purpose,p_units,'JP')
$$;
grant execute on function shorts_mvp.reserve_youtube_region_quota(text,text,text,integer,text), shorts_mvp.reserve_youtube_japan_quota(text,text,text,integer) to service_role;
revoke all on function shorts_mvp.reserve_youtube_region_quota(text,text,text,integer,text) from public;
revoke all on function shorts_mvp.reserve_youtube_japan_quota(text,text,text,integer) from public;
commit;
