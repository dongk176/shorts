begin;

set local lock_timeout = '3s';

create table if not exists shorts_mvp.background_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references shorts_mvp.app_users(id) on delete restrict,
  object_key text not null unique,
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  state text not null default 'pending' check (state in ('pending','ready','deleting','deleted')),
  original_byte_size integer not null check (original_byte_size between 1 and 3145728),
  reserved_bytes integer not null default 2097152 check (reserved_bytes between 0 and 2097152),
  byte_size integer check (byte_size between 1 and 2097152),
  width integer check (width=1080),
  height integer check (height=1920),
  display_name text not null default '내 배경' check (char_length(display_name) between 1 and 120),
  library_removed_at timestamptz,
  unreferenced_since timestamptz,
  retain_until timestamptz not null default clock_timestamp()+interval '15 minutes',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  cleanup_token uuid,
  constraint background_assets_key_check check (
    object_key='custom-backgrounds/' || user_id::text || '/' || id::text || '.webp'
  ),
  constraint background_assets_ready_check check (
    state<>'ready' or (
      sha256 is not null and byte_size is not null and width is not null and height is not null
      and width=1080 and height=1920 and reserved_bytes=0 and deleted_at is null
    )
  ),
  constraint background_assets_deleted_check check (
    (state='deleted')=(deleted_at is not null)
  ),
  constraint background_assets_unreferenced_check check (
    unreferenced_since is null or library_removed_at is not null
  )
);

-- The web serializes admissions/dedup/attachment with this same lock, which
-- maintenance must acquire BEFORE the asset row lock and reference recheck:
-- pg_advisory_xact_lock(hashtextextended('background-assets:' || user_id::text,0)).
create unique index if not exists background_assets_owner_digest_active_idx
  on shorts_mvp.background_assets (user_id,sha256)
  where sha256 is not null and state in ('pending','ready','deleting');
create index if not exists background_assets_owner_created_idx
  on shorts_mvp.background_assets (user_id,created_at desc);
create index if not exists background_assets_cleanup_idx
  on shorts_mvp.background_assets (state,retain_until,unreferenced_since)
  where state<>'deleted';

alter table shorts_mvp.background_assets enable row level security;
revoke all on shorts_mvp.background_assets from anon,authenticated;
grant all on shorts_mvp.background_assets to service_role;

drop trigger if exists background_assets_set_updated_at on shorts_mvp.background_assets;
create trigger background_assets_set_updated_at
before update on shorts_mvp.background_assets
for each row execute function shorts_mvp.set_updated_at();

insert into shorts_mvp.runtime_feature_flags (flag_key,enabled,description)
values
  ('custom_template_design_enabled',false,'내 배경 보관·재사용 및 템플릿 고정 텍스트 기능 사용 스위치'),
  ('custom_template_design_public',false,'내 배경·템플릿 고정 텍스트를 일반 회원에게 공개; 기능 사용 스위치가 켜져 있어야 적용')
on conflict (flag_key) do nothing;

comment on table shorts_mvp.background_assets is
  'Private, immutable, account-owned normalized backgrounds. Visible ready assets never expire. List removal does not delete content. No full source videos.';
comment on column shorts_mvp.background_assets.library_removed_at is
  'Discovery-only removal. Hidden ready assets remain valid in owned templates/documents/jobs. Physical deletion requires reference and lease checks.';
comment on column shorts_mvp.background_assets.unreferenced_since is
  'Set by locked cleanup only after all live references and draft leases have ended; reset on any attach/read. Delete after 30 consecutive unreferenced days.';
comment on column shorts_mvp.background_assets.retain_until is
  'Pending upload deadline or minimum draft/read/job lease. Never expires a visible library asset. No network operation may run under the asset lock.';
comment on column shorts_mvp.background_assets.reserved_bytes is
  'Pending upload quota reservation. All nondeleted bytes including hidden/deleting objects count toward the 1GiB account safety cap.';

-- These are the only locations accepted by the web reference extractor. Do
-- not recursively treat arbitrary user text as an ownership/storage reference.
create or replace function shorts_mvp.background_asset_json_references(
  p_document jsonb,
  p_asset_id uuid
) returns boolean
language sql immutable
set search_path = pg_catalog,shorts_mvp
as $$
  select coalesce(bool_or(
    candidate->>'kind'='uploaded_image'
    and lower(candidate->>'assetId')=p_asset_id::text
  ),false)
  from (values
    (p_document),
    (p_document->'background'),
    (p_document#>'{config,background}'),
    (p_document#>'{overlays,background}'),
    (p_document#>'{template,snapshot,config,background}')
  ) backgrounds(candidate)
$$;

create or replace function shorts_mvp.background_asset_has_live_references(
  p_asset_id uuid,
  p_user_id uuid
) returns boolean
language sql volatile
set search_path = pg_catalog,shorts_mvp
as $$
  select exists (
    select 1 from shorts_mvp.custom_templates template
    where template.user_id=p_user_id
      and shorts_mvp.background_asset_json_references(template.config,p_asset_id)
  ) or exists (
    select 1 from shorts_mvp.video_jobs job
    where job.user_id=p_user_id
      and shorts_mvp.background_asset_json_references(job.template_snapshot,p_asset_id)
      and (
        job.status not in ('completed','failed','expired','deleted')
        or exists (
          select 1 from shorts_mvp.upload_sessions upload
          where upload.job_id=job.id and upload.user_id=p_user_id
            and upload.status in ('awaiting_upload','claimed')
        )
      )
  ) or exists (
    select 1 from shorts_mvp.generated_shorts short
    join shorts_mvp.video_jobs job on job.id=short.job_id
    where short.user_id=p_user_id
      and (
        (
          short.deleted_at is null and short.expires_at>clock_timestamp()
          and short.status not in ('expired','deleted')
          and job.user_deleted_at is null
        )
        or exists (
          select 1 from shorts_mvp.editor_render_requests request
          where request.short_id=short.id and request.user_id=p_user_id
            and request.status in ('queued','rendering')
        )
      )
      and (
        shorts_mvp.background_asset_json_references(short.template_snapshot,p_asset_id)
        or shorts_mvp.background_asset_json_references(short.editor_document,p_asset_id)
        or shorts_mvp.background_asset_json_references(short.pending_edit_snapshot,p_asset_id)
      )
  )
$$;

create or replace function shorts_mvp.claim_background_asset_cleanup(
  p_asset_id uuid
) returns table(asset_id uuid,user_id uuid,object_key text,cleanup_token uuid)
language plpgsql security definer
set search_path = pg_catalog,shorts_mvp
as $$
declare
  v_owner uuid;
  v_asset shorts_mvp.background_assets%rowtype;
  v_now timestamptz;
  v_token uuid;
begin
  select asset.user_id into v_owner from shorts_mvp.background_assets asset
  where asset.id=p_asset_id;
  if v_owner is null then return; end if;

  perform pg_advisory_xact_lock(hashtextextended('background-assets:' || v_owner::text,0));
  select asset.* into v_asset from shorts_mvp.background_assets asset
  where asset.id=p_asset_id and asset.user_id=v_owner for update;
  if not found or v_asset.state='deleted' then return; end if;
  v_now := clock_timestamp();

  -- Account withdrawal anonymizes app_users rather than deleting its row.
  -- Hide its library here while still protecting any in-flight renderer.
  if v_asset.library_removed_at is null and exists (
    select 1 from shorts_mvp.app_users account
    where account.id=v_owner and account.withdrawn_at is not null
  ) then
    update shorts_mvp.background_assets asset
    set library_removed_at=v_now,unreferenced_since=null
    where asset.id=p_asset_id;
    v_asset.library_removed_at := v_now;
    v_asset.unreferenced_since := null;
  end if;

  -- A successful listed upload is a saved library item, not a temporary file.
  if v_asset.state='ready' and v_asset.library_removed_at is null then return; end if;

  -- A separate statement AFTER acquiring both locks observes commits that
  -- finished while waiting. All new web attachments take the same locks.
  if shorts_mvp.background_asset_has_live_references(p_asset_id,v_owner) then
    update shorts_mvp.background_assets asset
    set unreferenced_since=null where asset.id=p_asset_id;
    return;
  end if;
  if v_asset.retain_until>v_now then return; end if;

  if v_asset.state='pending' and v_asset.sha256 is null then
    -- No PUT can have started until the normalized digest is persisted.
    -- Keep this tombstone so failed attempts still count in the rolling rate.
    update shorts_mvp.background_assets asset
    set state='deleted',reserved_bytes=0,deleted_at=v_now,
      library_removed_at=coalesce(asset.library_removed_at,v_now),cleanup_token=null
    where asset.id=p_asset_id;
    return;
  end if;

  if v_asset.state='ready' then
    if v_asset.unreferenced_since is null then
      update shorts_mvp.background_assets asset
      set unreferenced_since=v_now where asset.id=p_asset_id;
      return;
    end if;
    if v_asset.unreferenced_since>v_now-interval '30 days' then return; end if;
  end if;

  -- pending-after-PUT and failed/deleting reservations may be retried after
  -- their bounded lease. Immutable keys are never assigned to another asset.
  v_token := gen_random_uuid();
  update shorts_mvp.background_assets asset
  set state='deleting',library_removed_at=coalesce(asset.library_removed_at,v_now),
    cleanup_token=v_token,retain_until=v_now+interval '5 minutes'
  where asset.id=p_asset_id;
  return query select p_asset_id,v_owner,v_asset.object_key,v_token;
end
$$;

create or replace function shorts_mvp.claim_background_asset_cleanup_batch(
  p_limit integer default 20
) returns table(asset_id uuid,user_id uuid,object_key text,cleanup_token uuid)
language plpgsql security definer
set search_path = pg_catalog,shorts_mvp
as $$
declare
  v_candidate record;
begin
  -- Deterministic owner ordering avoids lock-order inversion between two
  -- concurrent maintenance runs. The scan is a hint; claim rechecks everything.
  for v_candidate in
    select oldest.id from (
      select asset.id,asset.user_id
      from shorts_mvp.background_assets asset
      join shorts_mvp.app_users account on account.id=asset.user_id
      where asset.state<>'deleted' and (
        (asset.state in ('pending','deleting') and asset.retain_until<=clock_timestamp())
        or (asset.state='ready' and (
          (asset.library_removed_at is null and account.withdrawn_at is not null)
          or (asset.library_removed_at is not null and asset.retain_until<=clock_timestamp()
            and (asset.unreferenced_since is null
              or asset.unreferenced_since<=clock_timestamp()-interval '30 days'))
        ))
      )
      order by asset.updated_at,asset.id
      limit greatest(1,least(coalesce(p_limit,20),20))
    ) oldest order by oldest.user_id,oldest.id
  loop
    return query select * from shorts_mvp.claim_background_asset_cleanup(v_candidate.id);
  end loop;
  -- Tombstones are not media. A bounded seven-day metadata cleanup prevents
  -- malformed upload attempts growing this table forever, while keeping far
  -- more than the one-minute admission window used by the rate limiter.
  delete from shorts_mvp.background_assets asset where asset.id in (
    select tombstone.id from shorts_mvp.background_assets tombstone
    where tombstone.state='deleted'
      and tombstone.deleted_at<clock_timestamp()-interval '7 days'
    order by tombstone.deleted_at,tombstone.id limit 200
  );
end
$$;

create or replace function shorts_mvp.finalize_background_asset_cleanup(
  p_asset_id uuid,
  p_cleanup_token uuid
) returns boolean
language plpgsql security definer
set search_path = pg_catalog,shorts_mvp
as $$
declare
  v_owner uuid;
  v_asset shorts_mvp.background_assets%rowtype;
begin
  select asset.user_id into v_owner from shorts_mvp.background_assets asset where asset.id=p_asset_id;
  if v_owner is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('background-assets:' || v_owner::text,0));
  select asset.* into v_asset from shorts_mvp.background_assets asset
  where asset.id=p_asset_id for update;
  if not found or v_asset.state<>'deleting'
    or v_asset.cleanup_token is distinct from p_cleanup_token
    or p_cleanup_token is null then return false; end if;
  if shorts_mvp.background_asset_has_live_references(p_asset_id,v_owner) then return false; end if;
  -- Only the maintenance caller, after a successful single-object S3 delete,
  -- can release held bytes. A failed delete/finalize remains charged/retryable.
  update shorts_mvp.background_assets asset
  set state='deleted',deleted_at=clock_timestamp(),reserved_bytes=0,cleanup_token=null
  where asset.id=p_asset_id;
  return true;
end
$$;

revoke all on function shorts_mvp.background_asset_json_references(jsonb,uuid) from public,anon,authenticated;
revoke all on function shorts_mvp.background_asset_has_live_references(uuid,uuid) from public,anon,authenticated;
revoke all on function shorts_mvp.claim_background_asset_cleanup(uuid) from public,anon,authenticated;
revoke all on function shorts_mvp.claim_background_asset_cleanup_batch(integer) from public,anon,authenticated;
revoke all on function shorts_mvp.finalize_background_asset_cleanup(uuid,uuid) from public,anon,authenticated;
grant execute on function shorts_mvp.background_asset_json_references(jsonb,uuid) to service_role;
grant execute on function shorts_mvp.background_asset_has_live_references(uuid,uuid) to service_role;
grant execute on function shorts_mvp.claim_background_asset_cleanup(uuid) to service_role;
grant execute on function shorts_mvp.claim_background_asset_cleanup_batch(integer) to service_role;
grant execute on function shorts_mvp.finalize_background_asset_cleanup(uuid,uuid) to service_role;

commit;
