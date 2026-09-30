begin;

-- Retain the generation binding. Only this separately attested SNS editor may
-- render existing administrator-owned SNS projects from the two known releases.
create function shorts_mvp.assert_sns_editor_request(p_request shorts_mvp.editor_render_requests)
returns void language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
begin
  if p_request.release_id is distinct from '406dadcf-f290-4eb8-b82e-a6e8c6b40105'::uuid
    or p_request.release_channel is distinct from 'canary'
    or not exists (
      select 1 from shorts_mvp.generated_shorts s
      join shorts_mvp.video_jobs j on j.id=s.job_id
      join shorts_mvp.app_users u on u.id=j.user_id and u.is_admin
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
          '8dc98fc0-a5bb-411f-9cc6-0e8dc28648ca'::uuid,
          '8af2c7e6-5421-4e93-9671-b0e8bb41de8a'::uuid)
        and e.staging_verified_at is not null and e.status in ('canary_ready','canary_active','approved')
        and e.ui_version=3 and e.document_version=3
        and e.render_spec_version=4 and e.caption_render_spec_version=4
        and c.details->>'sourceGitSha'=e.git_sha
        and c.details->>'imageDigest'=e.worker_image_digest
        and c.details->>'fontManifestSha256'=e.font_manifest_sha256
        and c.details->'generationReleaseIds' ? j.language_test_release_id::text
    ) then raise exception 'SNS_EDITOR_BINDING_MISMATCH';
  end if;
end; $$;
revoke all on function shorts_mvp.assert_sns_editor_request(shorts_mvp.editor_render_requests)
  from public,anon,authenticated;
grant execute on function shorts_mvp.assert_sns_editor_request(shorts_mvp.editor_render_requests) to service_role;

do $$ declare body text; anchor text := E'  if pinned is not null then\n'; begin
  body := pg_get_functiondef('shorts_mvp.enforce_language_test_editor_binding()'::regprocedure);
  if position(anchor in body)=0 or position('assert_sns_editor_request' in body)>0 then
    raise exception 'SNS_EDITOR_GUARD_BASELINE_CHANGED';
  end if;
  body := replace(body,anchor,E'  if new.release_id=\'406dadcf-f290-4eb8-b82e-a6e8c6b40105\'::uuid then\n    perform shorts_mvp.assert_sns_editor_request(new);\n    return new;\n  end if;\n'||anchor);
  execute body;
end $$;
commit;
