begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
-- A byte-hash-bound, append-only Japanese font addition; existing faces and metrics cannot change.
create function shorts_mvp.is_additive_japanese_font_manifest(previous_text text,next_text text)
returns boolean language plpgsql immutable strict set search_path=pg_catalog as $$
declare previous jsonb; successor jsonb;
begin
 previous:=previous_text::jsonb;successor:=next_text::jsonb;
 if jsonb_typeof(previous->'entries') is distinct from 'array'
   or jsonb_typeof(successor->'entries') is distinct from 'array'
   or previous->'fallbackDetected' is distinct from 'false'::jsonb
   or (previous-'entries') is distinct from (successor-'entries') then return false;end if;
 return jsonb_array_length(previous->'entries')>0
   and jsonb_array_length(successor->'entries')=jsonb_array_length(previous->'entries')+1
   and (successor->'entries') @> (previous->'entries')
   and not exists(select 1 from jsonb_array_elements(previous->'entries') e where e->>'fontId'='noto-sans-jp')
   and (select count(*) from jsonb_array_elements(successor->'entries') e where e->>'fontId'='noto-sans-jp')=1
   and (select count(distinct e->>'fontId') from jsonb_array_elements(successor->'entries') e)=jsonb_array_length(successor->'entries');
exception when others then return false;
end; $$;
revoke all on function shorts_mvp.is_additive_japanese_font_manifest(text,text) from public,anon,authenticated;
grant execute on function shorts_mvp.is_additive_japanese_font_manifest(text,text) to service_role;

create table shorts_mvp.upload_font_compatibility (
 release_id uuid not null references shorts_mvp.editor_releases(id),
 previous_manifest_sha256 text not null check(previous_manifest_sha256~'^[0-9a-f]{64}$'),
 next_manifest_sha256 text not null check(next_manifest_sha256~'^[0-9a-f]{64}$'),
 previous_manifest_canonical text not null,
 next_manifest_canonical text not null,
 probe_run_id uuid not null references shorts_mvp.editor_release_probe_runs(id),
 evidence_uri text not null check(evidence_uri~'^s3://'),
 evidence_version_id text not null check(length(evidence_version_id)>0),
 recorded_by uuid not null references shorts_mvp.app_users(id),
 created_at timestamptz not null default clock_timestamp(),
 primary key(release_id,previous_manifest_sha256),
 check(previous_manifest_sha256=encode(sha256(convert_to(previous_manifest_canonical,'UTF8')),'hex')),
 check(next_manifest_sha256=encode(sha256(convert_to(next_manifest_canonical,'UTF8')),'hex')),
 check(shorts_mvp.is_additive_japanese_font_manifest(previous_manifest_canonical,next_manifest_canonical))
);
alter table shorts_mvp.upload_font_compatibility enable row level security;
revoke all on shorts_mvp.upload_font_compatibility from public,anon,authenticated;
grant select,insert on shorts_mvp.upload_font_compatibility to service_role;
create function shorts_mvp.guard_upload_font_compatibility() returns trigger
language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
begin
 if tg_op<>'INSERT' then raise exception 'UPLOAD_FONT_PROOF_IMMUTABLE';end if;
 if not exists(select 1 from shorts_mvp.app_users u where u.id=new.recorded_by and u.is_admin and u.withdrawn_at is null)
   or not exists(select 1 from shorts_mvp.editor_release_probe_runs p
     join shorts_mvp.editor_releases e on e.id=p.finalized_release_id
     where p.id=new.probe_run_id and p.state='finalized' and e.id=new.release_id
       and e.staging_verified_at is not null and e.render_spec_version=4 and e.caption_render_spec_version=4
       and e.git_sha=p.git_sha and e.worker_image_digest=p.worker_image_digest
       and e.font_manifest_sha256=new.next_manifest_sha256 and p.font_manifest_sha256=new.next_manifest_sha256
       and p.artifact_uri=new.evidence_uri and p.manifest_s3_version_id=new.evidence_version_id)
 then raise exception 'UPLOAD_FONT_PROOF_NOT_ATTESTED';end if;
 return new;
end; $$;
revoke all on function shorts_mvp.guard_upload_font_compatibility() from public,anon,authenticated;
create trigger upload_font_proof_guard before insert or update or delete on shorts_mvp.upload_font_compatibility
 for each row execute function shorts_mvp.guard_upload_font_compatibility();

do $$ declare body text; anchor text:='and release.font_manifest_sha256=p_font_manifest_sha256';begin
 body:=pg_get_functiondef('shorts_mvp._verified_file_upload_successor_identity(uuid,text)'::regprocedure);
 if position(anchor in body)=0 or position('upload_font_compatibility' in body)>0 then
   raise exception 'UPLOAD_FONT_GUARD_BASELINE_CHANGED';end if;
 execute replace(body,anchor,'and (release.font_manifest_sha256=p_font_manifest_sha256 or exists (
   select 1 from shorts_mvp.upload_font_compatibility font_proof
   where font_proof.release_id=release.id and font_proof.previous_manifest_sha256=p_font_manifest_sha256
     and font_proof.next_manifest_sha256=release.font_manifest_sha256))');
end $$;
commit;
