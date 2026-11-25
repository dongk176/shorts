-- Add verified extraction recovery identities; preserve old requests, owners and flags.
-- Baseline hashes prevent overwriting an intervening production guard change.

DO $guard$ BEGIN
 IF md5(pg_get_functiondef('shorts_mvp.assert_community_editor_request(shorts_mvp.editor_render_requests)'::regprocedure)) <> '2593327f16aee48fe314586a1efbccb5' THEN
 RAISE EXCEPTION 'YTDLP_RECOVERY_BASELINE_CHANGED: assert_community_editor_request';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION shorts_mvp.assert_community_editor_request(p_request shorts_mvp.editor_render_requests)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'shorts_mvp', 'pg_temp'
AS $function$
begin
  if (p_request.release_id is null or p_request.release_id not in ('601d3d10-62b9-47f2-a34e-78b53ab1ec99'::uuid,'11a62875-b24a-4874-9794-4aac13b0c305'::uuid,'242f96a3-fe3b-4f20-a006-3c6559d98573'::uuid,'d1bb4c9d-f055-4cbe-bdbd-318e51ffdf33'::uuid,'ca57c1ae-c841-4f44-835a-f566a3c097c1'::uuid,'a576138e-1ddf-4469-8494-252058595705'::uuid,'6f50a87c-250c-4d3e-a8c9-b79d1fbc2f91'::uuid,'3355b631-73ec-4f0f-a669-1fd460d2c284'::uuid,'0f39f8e7-f4e7-48d1-9c0e-7735276ae06b'::uuid,'8aa1a928-fbc0-4bba-af16-314296cc7d56'::uuid))
    or p_request.release_channel is distinct from 'canary'
    or not exists (
      select 1 from shorts_mvp.generated_shorts s
      join shorts_mvp.video_jobs j on j.id=s.job_id
      join shorts_mvp.app_users u on u.id=j.user_id and (u.is_admin or p_request.release_id in ('d1bb4c9d-f055-4cbe-bdbd-318e51ffdf33'::uuid,'ca57c1ae-c841-4f44-835a-f566a3c097c1'::uuid,'a576138e-1ddf-4469-8494-252058595705'::uuid,'6f50a87c-250c-4d3e-a8c9-b79d1fbc2f91'::uuid,'3355b631-73ec-4f0f-a669-1fd460d2c284'::uuid,'0f39f8e7-f4e7-48d1-9c0e-7735276ae06b'::uuid,'8aa1a928-fbc0-4bba-af16-314296cc7d56'::uuid))
      join shorts_mvp.language_test_releases generation on generation.id=j.language_test_release_id
        and generation.verified_at is not null
      join shorts_mvp.editor_releases e on e.id=p_request.release_id
      join shorts_mvp.editor_release_checks c on c.release_id=e.id
        and c.environment='isolated' and c.check_name='sns_editor_compatibility'
        and c.status='passed' and c.completed_at is not null
      where s.id=p_request.short_id and s.user_id=p_request.user_id and j.user_id=p_request.user_id
        and s.deleted_at is null and j.user_deleted_at is null and s.expires_at>clock_timestamp()
        and s.render_version=p_request.base_render_version
        and s.template_snapshot->>'snsTemplateVersion'='1'
        and j.template_snapshot->>'snsTemplateVersion'='1'
        and j.initial_editor_release_id=j.language_test_release_id
        and j.language_test_release_id in ('a7db3266-7fc0-4175-a818-39aaff712ad3'::uuid,'0641d236-5e76-467e-95f3-bf695e6d6083'::uuid,'1ce342d0-cf2d-41b4-961b-f3abd9f4e336'::uuid,'46d7f96b-7e16-4fa6-920f-b3c915cad8e8'::uuid,'8b0a6b0f-ab5d-43dd-afce-b3a2409b59b9'::uuid,'d2234ec0-5e71-42dd-9b89-bacdec2d7ce5'::uuid)
        and s.template_snapshot->>'communityTemplateVersion'='1'
        and j.template_snapshot->>'communityTemplateVersion'='1'
        and e.staging_verified_at is not null and e.status in ('canary_ready','canary_active','approved')
        and e.ui_version=3 and e.document_version=3
        and e.render_spec_version=4 and e.caption_render_spec_version=4
        and (p_request.release_id not in (
          '66f640ba-d156-4c90-9c4f-f79038bf9d14'::uuid,'34df634e-d49a-4171-b3ea-f86199543ec1'::uuid,'c8324dfe-06f1-4765-b6d3-14410d8bd114'::uuid,'340f9382-c8b0-4926-acd0-b8a3987316e4'::uuid,'38f0c9d2-5eb9-4310-b57a-ef7156497a71'::uuid,'a576138e-1ddf-4469-8494-252058595705'::uuid,'6f50a87c-250c-4d3e-a8c9-b79d1fbc2f91'::uuid,'3355b631-73ec-4f0f-a669-1fd460d2c284'::uuid,'0f39f8e7-f4e7-48d1-9c0e-7735276ae06b'::uuid,'8aa1a928-fbc0-4bba-af16-314296cc7d56'::uuid)
          or c.details->'unifiedTemplateEditorVersion'='1'::jsonb)
        and c.details->>'sourceGitSha'=e.git_sha
        and c.details->>'imageDigest'=e.worker_image_digest
        and c.details->>'fontManifestSha256'=e.font_manifest_sha256
        and c.details->'generationReleaseIds' ? j.language_test_release_id::text
    ) then raise exception 'SNS_EDITOR_BINDING_MISMATCH';
  end if;
end; $function$
;

DO $guard$ BEGIN
 IF md5(pg_get_functiondef('shorts_mvp.assert_community_template_job(shorts_mvp.video_jobs)'::regprocedure)) <> '61e94a38649a4519f7c253d9389c6e83' THEN
 RAISE EXCEPTION 'YTDLP_RECOVERY_BASELINE_CHANGED: assert_community_template_job';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION shorts_mvp.assert_community_template_job(p_job shorts_mvp.video_jobs)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'shorts_mvp', 'pg_temp'
AS $function$
declare r record; t jsonb;
begin
  if p_job.template_snapshot->>'snsTemplateVersion' is distinct from '1'
    or p_job.template_id is distinct from 'white-yellow'
    or p_job.subtitle_template_id is not null then
    raise exception 'SNS_TEMPLATE_CONTEXT_MISMATCH';
  end if;
  if (p_job.language_test_release_id is null or p_job.language_test_release_id not in ('a7db3266-7fc0-4175-a818-39aaff712ad3'::uuid,'0641d236-5e76-467e-95f3-bf695e6d6083'::uuid,'1ce342d0-cf2d-41b4-961b-f3abd9f4e336'::uuid,'46d7f96b-7e16-4fa6-920f-b3c915cad8e8'::uuid,'8b0a6b0f-ab5d-43dd-afce-b3a2409b59b9'::uuid,'d2234ec0-5e71-42dd-9b89-bacdec2d7ce5'::uuid))
    or p_job.template_snapshot->>'communityTemplateVersion' is distinct from '1' then
    raise exception 'COMMUNITY_TEMPLATE_CONTEXT_MISMATCH';
  end if;
  perform id from shorts_mvp.app_users where id=p_job.user_id and (is_admin or p_job.language_test_release_id in ('46d7f96b-7e16-4fa6-920f-b3c915cad8e8'::uuid,'8b0a6b0f-ab5d-43dd-afce-b3a2409b59b9'::uuid,'d2234ec0-5e71-42dd-9b89-bacdec2d7ce5'::uuid)) for share;
  if not found then raise exception 'COMMUNITY_TEMPLATE_ADMIN_ONLY'; end if;
  select l.*,e.git_sha,e.worker_image_digest,e.font_manifest_sha256,e.status,e.staging_verified_at
    into r from shorts_mvp.language_test_releases l
    join shorts_mvp.editor_releases e on e.id=l.id
    where l.id=p_job.language_test_release_id and l.verified_at is not null
      and l.verification->>'kind'=case when l.id in ('46d7f96b-7e16-4fa6-920f-b3c915cad8e8'::uuid,'8b0a6b0f-ab5d-43dd-afce-b3a2409b59b9'::uuid,'d2234ec0-5e71-42dd-9b89-bacdec2d7ce5'::uuid) then 'community_public_generation' else 'community_admin_generation_only' end
      and (l.id<>'d2234ec0-5e71-42dd-9b89-bacdec2d7ce5'::uuid or (
        e.git_sha='f969c8be6a5dc18088d9c3b5cba77f8e783a5d7b' and e.worker_image_digest='sha256:39df0ff6f234fd39453d19ad040508296b1f6fb821af892b89933e9bfd70c098'
        and e.font_manifest_sha256='1da578de91943f1299bb48e33649264dc748f89356879702817ceab38668beff'
        and l.verification->>'sourceGitSha'=e.git_sha
        and l.verification->>'imageDigest'=e.worker_image_digest
        and l.verification->'component'->>'batchStatus'='SUCCEEDED'
        and l.verification->'snsCopyAndEditor'->>'passed'='true'
        and l.verification->'probe'->>'batchStatus'='SUCCEEDED'
        and l.verification->'probe'->>'gitSha'=e.git_sha
        and l.verification->'probe'->>'workerImageDigest'=e.worker_image_digest
        and l.verification->'probe'->>'fontManifestSha256'=e.font_manifest_sha256
        and l.verification->'renderParity'->>'passed'='true'))
      and e.ui_version=3 and e.document_version=3
      and e.render_spec_version=4 and e.caption_render_spec_version=4 for share of l,e;
  if not found or r.status not in ('canary_ready','canary_active','approved') or r.staging_verified_at is null then
    raise exception 'SNS_TEMPLATE_UNAVAILABLE';
  end if;
  t:=r.registry->'lanes'->p_job.batch_target_key->'current';
  if t is null or p_job.initial_editor_release_id is distinct from r.id
    or p_job.batch_target_release_id is distinct from t->>'releaseId'
    or p_job.batch_job_definition is distinct from t->>'jobDefinitionArn'
    or p_job.batch_job_queue is distinct from t->>'jobQueueArn'
    or r.git_sha is distinct from t->>'workerSourceGitSha'
    or r.worker_image_digest is distinct from split_part(t->>'imageUri','@',2)
    or r.font_manifest_sha256 is distinct from t->>'fontManifestSha256'
    or coalesce(t->>'releaseId','') !~ '^sns-template-community-'
    or coalesce(t->>'jobDefinitionArn','') !~ '^arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-language-test-sns-'
    or coalesce(t->>'jobQueueArn','') !~ '^arn:aws:batch:ap-northeast-2:181651591905:job-queue/shorts-mvp-language-test-'
  then raise exception 'SNS_TEMPLATE_TARGET_MISMATCH'; end if;
end; $function$
;

DO $guard$ BEGIN
 IF md5(pg_get_functiondef('shorts_mvp.assert_sns_editor_request(shorts_mvp.editor_render_requests)'::regprocedure)) <> '9704229d14396c1c3ab26dde4c767483' THEN
 RAISE EXCEPTION 'YTDLP_RECOVERY_BASELINE_CHANGED: assert_sns_editor_request';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION shorts_mvp.assert_sns_editor_request(p_request shorts_mvp.editor_render_requests)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'shorts_mvp', 'pg_temp'
AS $function$
begin
  if p_request.release_id in ('601d3d10-62b9-47f2-a34e-78b53ab1ec99'::uuid,'11a62875-b24a-4874-9794-4aac13b0c305'::uuid,'242f96a3-fe3b-4f20-a006-3c6559d98573'::uuid,'d1bb4c9d-f055-4cbe-bdbd-318e51ffdf33'::uuid,'ca57c1ae-c841-4f44-835a-f566a3c097c1'::uuid,'a576138e-1ddf-4469-8494-252058595705'::uuid,'6f50a87c-250c-4d3e-a8c9-b79d1fbc2f91'::uuid,'3355b631-73ec-4f0f-a669-1fd460d2c284'::uuid,'0f39f8e7-f4e7-48d1-9c0e-7735276ae06b'::uuid,'8aa1a928-fbc0-4bba-af16-314296cc7d56'::uuid) then
    perform shorts_mvp.assert_community_editor_request(p_request);
    return;
  end if;
  if (p_request.release_id is null or p_request.release_id not in ('406dadcf-f290-4eb8-b82e-a6e8c6b40105'::uuid,'77d3b2de-12a4-4b7d-a134-87170b1d3ecf'::uuid,'4fbfeeaa-e210-4143-aece-c17029d962a0'::uuid,'66f640ba-d156-4c90-9c4f-f79038bf9d14'::uuid,'34df634e-d49a-4171-b3ea-f86199543ec1'::uuid,'c8324dfe-06f1-4765-b6d3-14410d8bd114'::uuid,'340f9382-c8b0-4926-acd0-b8a3987316e4'::uuid,'38f0c9d2-5eb9-4310-b57a-ef7156497a71'::uuid))
    or p_request.release_channel is distinct from 'canary'
    or not exists (
      select 1 from shorts_mvp.generated_shorts s
      join shorts_mvp.video_jobs j on j.id=s.job_id
      join shorts_mvp.app_users u on u.id=j.user_id and (u.is_admin or p_request.release_id in ('77d3b2de-12a4-4b7d-a134-87170b1d3ecf'::uuid,'4fbfeeaa-e210-4143-aece-c17029d962a0'::uuid,'66f640ba-d156-4c90-9c4f-f79038bf9d14'::uuid,'34df634e-d49a-4171-b3ea-f86199543ec1'::uuid,'c8324dfe-06f1-4765-b6d3-14410d8bd114'::uuid,'340f9382-c8b0-4926-acd0-b8a3987316e4'::uuid,'38f0c9d2-5eb9-4310-b57a-ef7156497a71'::uuid))
      join shorts_mvp.language_test_releases generation on generation.id=j.language_test_release_id
        and generation.verified_at is not null
      join shorts_mvp.editor_releases e on e.id=p_request.release_id
      join shorts_mvp.editor_release_checks c on c.release_id=e.id
        and c.environment='isolated' and c.check_name='sns_editor_compatibility'
        and c.status='passed' and c.completed_at is not null
      where s.id=p_request.short_id and s.user_id=p_request.user_id and j.user_id=p_request.user_id
        and s.deleted_at is null and j.user_deleted_at is null and s.expires_at>clock_timestamp()
        and s.render_version=p_request.base_render_version
        and s.template_snapshot->>'snsTemplateVersion'='1'
        and j.template_snapshot->>'snsTemplateVersion'='1'
        and j.initial_editor_release_id=j.language_test_release_id
        and j.language_test_release_id in (
          'b871796a-f83a-4aed-8d56-bf039de1cdbf'::uuid,
          '8dc98fc0-a5bb-411f-9cc6-0e8dc28648ca'::uuid,
          '8af2c7e6-5421-4e93-9671-b0e8bb41de8a'::uuid,'221b1fcd-9b06-499d-97e9-d2093db2a4e3'::uuid,'c9969722-6f41-4a19-b9e5-b608ec236056'::uuid)
        and e.staging_verified_at is not null and e.status in ('canary_ready','canary_active','approved')
        and e.ui_version=3 and e.document_version=3
        and e.render_spec_version=4 and e.caption_render_spec_version=4
        and (p_request.release_id not in (
          '66f640ba-d156-4c90-9c4f-f79038bf9d14'::uuid,'34df634e-d49a-4171-b3ea-f86199543ec1'::uuid,'c8324dfe-06f1-4765-b6d3-14410d8bd114'::uuid,'340f9382-c8b0-4926-acd0-b8a3987316e4'::uuid,'38f0c9d2-5eb9-4310-b57a-ef7156497a71'::uuid,'a576138e-1ddf-4469-8494-252058595705'::uuid,'6f50a87c-250c-4d3e-a8c9-b79d1fbc2f91'::uuid,'3355b631-73ec-4f0f-a669-1fd460d2c284'::uuid,'0f39f8e7-f4e7-48d1-9c0e-7735276ae06b'::uuid,'8aa1a928-fbc0-4bba-af16-314296cc7d56'::uuid)
          or c.details->'unifiedTemplateEditorVersion'='1'::jsonb)
        and c.details->>'sourceGitSha'=e.git_sha
        and c.details->>'imageDigest'=e.worker_image_digest
        and c.details->>'fontManifestSha256'=e.font_manifest_sha256
        and c.details->'generationReleaseIds' ? j.language_test_release_id::text
    ) then raise exception 'SNS_EDITOR_BINDING_MISMATCH';
  end if;
end; $function$
;

DO $guard$ BEGIN
 IF md5(pg_get_functiondef('shorts_mvp.assert_sns_template_job(shorts_mvp.video_jobs)'::regprocedure)) <> '1151d9573360e913878569f1d3016223' THEN
 RAISE EXCEPTION 'YTDLP_RECOVERY_BASELINE_CHANGED: assert_sns_template_job';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION shorts_mvp.assert_sns_template_job(p_job shorts_mvp.video_jobs)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'shorts_mvp', 'pg_temp'
AS $function$
declare r record; t jsonb;
begin
  if p_job.language_test_release_id in ('a7db3266-7fc0-4175-a818-39aaff712ad3'::uuid,'0641d236-5e76-467e-95f3-bf695e6d6083'::uuid,'1ce342d0-cf2d-41b4-961b-f3abd9f4e336'::uuid,'46d7f96b-7e16-4fa6-920f-b3c915cad8e8'::uuid,'8b0a6b0f-ab5d-43dd-afce-b3a2409b59b9'::uuid,'d2234ec0-5e71-42dd-9b89-bacdec2d7ce5'::uuid)
    or p_job.template_snapshot ? 'communityTemplateVersion' then
    perform shorts_mvp.assert_community_template_job(p_job);
    return;
  end if;
  if p_job.template_snapshot->>'snsTemplateVersion' is distinct from '1'
    or p_job.template_id is distinct from 'white-yellow'
    or p_job.subtitle_template_id is not null then
    raise exception 'SNS_TEMPLATE_CONTEXT_MISMATCH';
  end if;
  perform id from shorts_mvp.app_users where id=p_job.user_id
    and (is_admin or p_job.language_test_release_id in ('8dc98fc0-a5bb-411f-9cc6-0e8dc28648ca'::uuid,'b871796a-f83a-4aed-8d56-bf039de1cdbf'::uuid,'221b1fcd-9b06-499d-97e9-d2093db2a4e3'::uuid,'c9969722-6f41-4a19-b9e5-b608ec236056'::uuid)) for share;
  if not found then raise exception 'SNS_TEMPLATE_ADMIN_ONLY'; end if;
  select l.*,e.git_sha,e.worker_image_digest,e.font_manifest_sha256,e.status,e.staging_verified_at
    into r from shorts_mvp.language_test_releases l
    join shorts_mvp.editor_releases e on e.id=l.id
    where l.id=p_job.language_test_release_id and l.verified_at is not null
      and ((l.id not in ('221b1fcd-9b06-499d-97e9-d2093db2a4e3'::uuid,'c9969722-6f41-4a19-b9e5-b608ec236056'::uuid) and l.verification->>'kind'='sns_admin_generation_only')
        or (l.id='221b1fcd-9b06-499d-97e9-d2093db2a4e3'::uuid
          and l.verification->>'kind'='japanese-quality-prompt-only'
          and e.git_sha='a730f07144dffc8e77af65b93949dcda4b6690de'
          and e.worker_image_digest='sha256:f61567d7cad262a7401cdfbf5638ffce6ad9b9a2354d15c690b1d2e0ba127787'
          and e.font_manifest_sha256='1da578de91943f1299bb48e33649264dc748f89356879702817ceab38668beff'
          and l.verification->>'sourceGitSha'=e.git_sha
          and l.verification->>'imageDigest'=e.worker_image_digest
          and l.verification->'snsCopyAndEditor'->>'passed'='true'
          and l.verification->'probe'->>'batchStatus'='SUCCEEDED'
          and l.verification->'probe'->>'gitSha'=e.git_sha
          and l.verification->'probe'->>'workerImageDigest'=e.worker_image_digest
          and l.verification->'probe'->>'fontManifestSha256'=e.font_manifest_sha256)
        or (l.id='c9969722-6f41-4a19-b9e5-b608ec236056'::uuid
          and l.verification->>'kind'='yt-dlp-recovery'
          and e.git_sha='f969c8be6a5dc18088d9c3b5cba77f8e783a5d7b'
          and e.worker_image_digest='sha256:5d43bce55a3ea6b8c5060c8f01074f7d9853e3626227689aa7ea2019550d70ff'
          and e.font_manifest_sha256='1da578de91943f1299bb48e33649264dc748f89356879702817ceab38668beff'
          and l.verification->>'sourceGitSha'=e.git_sha
          and l.verification->>'imageDigest'=e.worker_image_digest
          and l.verification->'component'->>'batchStatus'='SUCCEEDED'
          and l.verification->'snsCopyAndEditor'->>'passed'='true'
          and l.verification->'probe'->>'batchStatus'='SUCCEEDED'
          and l.verification->'probe'->>'gitSha'=e.git_sha
          and l.verification->'probe'->>'workerImageDigest'=e.worker_image_digest
          and l.verification->'probe'->>'fontManifestSha256'=e.font_manifest_sha256
          and l.verification->'renderParity'->>'passed'='true'))
      and e.ui_version=3 and e.document_version=3
      and e.render_spec_version=4 and e.caption_render_spec_version=4 for share of l,e;
  if not found or r.status not in ('canary_ready','canary_active','approved') or r.staging_verified_at is null then
    raise exception 'SNS_TEMPLATE_UNAVAILABLE';
  end if;
  t:=r.registry->'lanes'->p_job.batch_target_key->'current';
  if t is null or p_job.initial_editor_release_id is distinct from r.id
    or p_job.batch_target_release_id is distinct from t->>'releaseId'
    or p_job.batch_job_definition is distinct from t->>'jobDefinitionArn'
    or p_job.batch_job_queue is distinct from t->>'jobQueueArn'
    or r.git_sha is distinct from t->>'workerSourceGitSha'
    or r.worker_image_digest is distinct from split_part(t->>'imageUri','@',2)
    or r.font_manifest_sha256 is distinct from t->>'fontManifestSha256'
    or coalesce(t->>'releaseId','') !~ '^sns-template-'
    or (coalesce(t->>'jobDefinitionArn','') !~ '^arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-language-test-sns-'
      and not (r.id='221b1fcd-9b06-499d-97e9-d2093db2a4e3'::uuid
        and p_job.batch_target_key in ('legacy_project','source_range','elevenlabs_transcription','subtitle_templates','unified_template_subtitles')
        and t->>'jobDefinitionArn'='arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-language-test-ja-sns-' || replace(p_job.batch_target_key,'_','-') || '-a730f07144df:3'))
    or coalesce(t->>'jobQueueArn','') !~ '^arn:aws:batch:ap-northeast-2:181651591905:job-queue/shorts-mvp-language-test-'
  then raise exception 'SNS_TEMPLATE_TARGET_MISMATCH'; end if;
end; $function$
;

DO $guard$ BEGIN
 IF md5(pg_get_functiondef('shorts_mvp.enforce_language_test_editor_binding()'::regprocedure)) <> '7cb92ca0d86d9ff78a2dd165f76b9b4a' THEN
 RAISE EXCEPTION 'YTDLP_RECOVERY_BASELINE_CHANGED: enforce_language_test_editor_binding';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION shorts_mvp.enforce_language_test_editor_binding()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'shorts_mvp', 'pg_temp'
AS $function$
declare pinned uuid;
begin
  select j.language_test_release_id into pinned from shorts_mvp.generated_shorts s
    join shorts_mvp.video_jobs j on j.id=s.job_id
    where s.id=new.short_id and s.user_id=new.user_id and j.user_id=new.user_id;
  if new.release_id in ('406dadcf-f290-4eb8-b82e-a6e8c6b40105'::uuid,'77d3b2de-12a4-4b7d-a134-87170b1d3ecf'::uuid,'4fbfeeaa-e210-4143-aece-c17029d962a0'::uuid,'66f640ba-d156-4c90-9c4f-f79038bf9d14'::uuid,'34df634e-d49a-4171-b3ea-f86199543ec1'::uuid,'c8324dfe-06f1-4765-b6d3-14410d8bd114'::uuid,'340f9382-c8b0-4926-acd0-b8a3987316e4'::uuid,'38f0c9d2-5eb9-4310-b57a-ef7156497a71'::uuid) then
    perform shorts_mvp.assert_sns_editor_request(new);
    return new;
  end if;
  if new.release_id in ('601d3d10-62b9-47f2-a34e-78b53ab1ec99'::uuid,'11a62875-b24a-4874-9794-4aac13b0c305'::uuid,'242f96a3-fe3b-4f20-a006-3c6559d98573'::uuid,'d1bb4c9d-f055-4cbe-bdbd-318e51ffdf33'::uuid,'ca57c1ae-c841-4f44-835a-f566a3c097c1'::uuid,'a576138e-1ddf-4469-8494-252058595705'::uuid,'6f50a87c-250c-4d3e-a8c9-b79d1fbc2f91'::uuid,'3355b631-73ec-4f0f-a669-1fd460d2c284'::uuid,'0f39f8e7-f4e7-48d1-9c0e-7735276ae06b'::uuid,'8aa1a928-fbc0-4bba-af16-314296cc7d56'::uuid) then
    perform shorts_mvp.assert_community_editor_request(new);
    return new;
  end if;
  if pinned is not null then
    if new.release_id is distinct from pinned or new.release_channel<>'canary'
      or not exists(select 1 from shorts_mvp.language_test_releases where id=pinned and verified_at is not null) then
      raise exception 'LANGUAGE_TEST_EDITOR_BINDING_MISMATCH';
    end if;
  elsif exists(select 1 from shorts_mvp.language_test_releases where id=new.release_id) then
    raise exception 'LANGUAGE_TEST_EDITOR_BINDING_MISMATCH';
  end if;
  return new;
end; $function$
;
