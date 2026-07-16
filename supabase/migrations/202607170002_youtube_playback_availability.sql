alter table shorts_mvp.youtube_analyses
  drop constraint if exists youtube_analyses_creation_availability_check;

alter table shorts_mvp.youtube_analyses
  add constraint youtube_analyses_creation_availability_check check (
    (
      creation_allowed = true
      and creation_block_code is null
      and creation_block_reason is null
    )
    or
    (
      creation_allowed = false
      and creation_block_code in (
        'region_restricted',
        'age_restricted',
        'not_public',
        'removed',
        'copyright_restricted',
        'authentication_required',
        'members_only',
        'paid_content',
        'drm_protected',
        'not_yet_available',
        'playback_unavailable',
        'not_processed',
        'embedding_disabled',
        'availability_unverified'
      )
      and length(trim(creation_block_reason)) > 0
    )
  );
