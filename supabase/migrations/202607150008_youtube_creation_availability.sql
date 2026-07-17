alter table shorts_mvp.youtube_analyses
  add column if not exists creation_allowed boolean not null default false,
  add column if not exists creation_block_code text default 'availability_unverified',
  add column if not exists creation_block_reason text default '영상 이용 가능 여부를 다시 확인해 주세요.';

update shorts_mvp.youtube_analyses
set creation_allowed = false,
    creation_block_code = coalesce(creation_block_code, 'availability_unverified'),
    creation_block_reason = coalesce(
      creation_block_reason,
      '영상 이용 가능 여부를 다시 확인해 주세요.'
    )
where creation_allowed = false;

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
