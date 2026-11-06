begin;

-- A larger manifest is compatible only when the finalized, versioned probe
-- artifacts prove that every existing face and layout metric is unchanged.
create table shorts_mvp.file_upload_font_successor_proofs (
  previous_release_id uuid not null references shorts_mvp.editor_releases(id),
  successor_release_id uuid not null references shorts_mvp.editor_releases(id),
  previous_font_sha256 text not null,
  successor_font_sha256 text not null,
  previous_probe_id uuid not null references shorts_mvp.editor_release_probe_runs(id),
  successor_probe_id uuid not null references shorts_mvp.editor_release_probe_runs(id),
  previous_manifest_sha256 text not null,
  successor_manifest_sha256 text not null,
  retained_font_count integer not null check(retained_font_count>0),
  added_font_count integer not null check(added_font_count>0),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(previous_release_id,successor_release_id)
);
alter table shorts_mvp.file_upload_font_successor_proofs enable row level security;
revoke all on shorts_mvp.file_upload_font_successor_proofs from public,anon,authenticated,service_role;

create function shorts_mvp.record_file_upload_font_successor_proof(
  p_previous_release_id uuid,p_successor_release_id uuid,
  p_previous_manifest text,p_successor_manifest text,p_admin_user_id uuid
) returns void language plpgsql security definer
set search_path=shorts_mvp,pg_temp as $$
declare
  old_probe shorts_mvp.editor_release_probe_runs%rowtype;
  new_probe shorts_mvp.editor_release_probe_runs%rowtype;
  old_doc jsonb; new_doc jsonb; old_fonts jsonb; new_fonts jsonb;
  old_count integer; new_count integer;
begin
  if not exists(select 1 from shorts_mvp.app_users where id=p_admin_user_id and is_admin) then
    raise exception 'administrator required' using errcode='42501';
  end if;
  if p_previous_release_id=p_successor_release_id
    or octet_length(p_previous_manifest)>8388608 or octet_length(p_successor_manifest)>8388608
    or p_previous_manifest is null or p_successor_manifest is null then
    raise exception 'invalid font proof input' using errcode='23514';
  end if;
  select * into strict old_probe from shorts_mvp.editor_release_probe_runs
    where finalized_release_id=p_previous_release_id and state='finalized' for share;
  select * into strict new_probe from shorts_mvp.editor_release_probe_runs
    where finalized_release_id=p_successor_release_id and state='finalized' for share;
  if encode(sha256(convert_to(p_previous_manifest,'UTF8')),'hex') is distinct from old_probe.manifest_sha256
    or encode(sha256(convert_to(p_successor_manifest,'UTF8')),'hex') is distinct from new_probe.manifest_sha256
    or coalesce(length(old_probe.manifest_s3_version_id),0)=0
    or coalesce(length(new_probe.manifest_s3_version_id),0)=0 then
    raise exception 'font proof does not match finalized artifacts' using errcode='23514';
  end if;
  old_doc:=p_previous_manifest::jsonb; new_doc:=p_successor_manifest::jsonb;
  if old_doc->>'gitSha' is distinct from old_probe.git_sha
    or new_doc->>'gitSha' is distinct from new_probe.git_sha
    or old_doc->>'workerImageDigest' is distinct from old_probe.worker_image_digest
    or new_doc->>'workerImageDigest' is distinct from new_probe.worker_image_digest
    or old_doc->>'fontManifestSha256' is distinct from old_probe.font_manifest_sha256
    or new_doc->>'fontManifestSha256' is distinct from new_probe.font_manifest_sha256
    or old_doc#>>'{fontManifest,sha256}' is distinct from old_probe.font_manifest_sha256
    or new_doc#>>'{fontManifest,sha256}' is distinct from new_probe.font_manifest_sha256
    or old_doc#>'{fontManifest,fallbackDetected}' is distinct from 'false'::jsonb
    or new_doc#>'{fontManifest,fallbackDetected}' is distinct from 'false'::jsonb then
    raise exception 'font proof identity mismatch' using errcode='23514';
  end if;
  old_fonts:=old_doc#>'{fontManifest,entries}'; new_fonts:=new_doc#>'{fontManifest,entries}';
  if jsonb_typeof(old_fonts) is distinct from 'array' or jsonb_typeof(new_fonts) is distinct from 'array' then
    raise exception 'font entries missing' using errcode='23514';
  end if;
  old_count:=jsonb_array_length(old_fonts);new_count:=jsonb_array_length(new_fonts);
  if old_count=0 or new_count<=old_count
    or (select count(distinct e->>'fontId') from jsonb_array_elements(old_fonts) e)<>old_count
    or (select count(distinct e->>'fontId') from jsonb_array_elements(new_fonts) e)<>new_count
    or exists(select 1 from jsonb_array_elements(old_fonts) old_face
      where not exists(select 1 from jsonb_array_elements(new_fonts) new_face where new_face=old_face)) then
    raise exception 'existing font bytes or metrics changed' using errcode='23514';
  end if;
  perform 1 from shorts_mvp.file_upload_release_checks where check_key='runtime_identity'
    and passed and details->>'releaseId'=p_previous_release_id::text
    and details->>'fontManifestSha256'=old_probe.font_manifest_sha256 for share;
  if not found then raise exception 'previous upload identity changed' using errcode='23514'; end if;
  insert into shorts_mvp.file_upload_font_successor_proofs values(
    p_previous_release_id,p_successor_release_id,old_probe.font_manifest_sha256,new_probe.font_manifest_sha256,
    old_probe.id,new_probe.id,old_probe.manifest_sha256,new_probe.manifest_sha256,
    old_count,new_count-old_count,clock_timestamp());
end;
$$;

alter function shorts_mvp._verified_file_upload_successor_identity(uuid,text)
  rename to _verified_file_upload_successor_identity_same_fonts;
create function shorts_mvp._verified_file_upload_successor_identity(p_release_id uuid,p_font_manifest_sha256 text)
returns jsonb language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
declare v_font text;
begin
  select font_manifest_sha256 into v_font from shorts_mvp.editor_releases where id=p_release_id for share;
  if v_font is distinct from p_font_manifest_sha256 then
    perform 1 from shorts_mvp.file_upload_font_successor_proofs proof
    join shorts_mvp.editor_release_probe_runs old_probe on old_probe.id=proof.previous_probe_id
    join shorts_mvp.editor_release_probe_runs new_probe on new_probe.id=proof.successor_probe_id
    join shorts_mvp.file_upload_release_checks runtime on runtime.check_key='runtime_identity' and runtime.passed
    where proof.successor_release_id=p_release_id
      and proof.previous_release_id::text=runtime.details->>'releaseId'
      and proof.previous_font_sha256=p_font_manifest_sha256 and proof.successor_font_sha256=v_font
      and old_probe.state='finalized' and new_probe.state='finalized'
      and old_probe.finalized_release_id=proof.previous_release_id and new_probe.finalized_release_id=p_release_id
      and old_probe.manifest_sha256=proof.previous_manifest_sha256
      and new_probe.manifest_sha256=proof.successor_manifest_sha256
      and old_probe.font_manifest_sha256=proof.previous_font_sha256
      and new_probe.font_manifest_sha256=proof.successor_font_sha256
    for share of proof,old_probe,new_probe,runtime;
    if not found then raise exception 'finalized additive font proof required' using errcode='23514'; end if;
  end if;
  -- All original capability, versioned-probe, exact fifteen checks, and custom
  -- design checks remain mandatory; no passed=true replacement is accepted.
  return shorts_mvp._verified_file_upload_successor_identity_same_fonts(p_release_id,v_font);
end;
$$;
revoke all on function shorts_mvp.record_file_upload_font_successor_proof(uuid,uuid,text,text,uuid)
  from public,anon,authenticated;
grant execute on function shorts_mvp.record_file_upload_font_successor_proof(uuid,uuid,text,text,uuid) to service_role;
revoke all on function shorts_mvp._verified_file_upload_successor_identity(uuid,text)
  from public,anon,authenticated,service_role;
commit;
