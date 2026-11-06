begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
-- Keep both original language contracts. The additional branch belongs only
-- to bounded silence QA; assert_silence_test_job still verifies its owner,
-- source/image-bound scope, expiry, quota, exact queue and registered target.
alter table shorts_mvp.video_jobs drop constraint video_jobs_language_test_context;
alter table shorts_mvp.video_jobs add constraint video_jobs_language_test_context check (
  (language_test_release_id is null and source_language_hint is null)
  or (language_test_release_id is not null and source_language_hint is not null
    and source_language_hint in ('auto','ko','en','ja') and output_language in ('ko','en','ja')
    and source_type is not distinct from 'youtube' and pipeline_version is not distinct from 2
    and initial_editor_release_id is not distinct from language_test_release_id
    and initial_render_spec_version is not distinct from 4 and initial_caption_render_spec_version is not distinct from 4)
  or (silence_test_release_id is not null and language_test_release_id is null
    and source_language_hint is not null and source_language_hint in ('auto','ko','en','ja')
    and output_language in ('ko','en','ja')
    and source_type is not distinct from 'youtube' and pipeline_version is not distinct from 2
    and initial_editor_release_id is not distinct from silence_test_release_id
    and initial_render_spec_version is not distinct from 4 and initial_caption_render_spec_version is not distinct from 4)
) not valid;
commit;
