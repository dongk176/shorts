-- Keep the three curated public examples outside the normal 30-day retention path.
-- Their rendered MP4s are copied to the lifecycle-exempt examples/ prefix before
-- this migration is applied in production.
update shorts_mvp.video_jobs
set is_example = true,
    expires_at = null
where (id, project_number, video_title) in (
  (
    'a8e6ea45-89e1-4a3e-a2b7-4b297ce439dc'::uuid,
    106,
    '🔞 13:1 극악의 성비 체대 MT란... (ft. b급)'
  ),
  (
    'cf3211c5-8cc2-45f4-af99-cab3c7b98d13'::uuid,
    108,
    '24시간 동안 한파 날씨의 야외에서 살면 생기는 일'
  ),
  (
    'ddf33f5f-03d1-43e6-abd4-50cf163445d0'::uuid,
    112,
    '[HOT] 무한도전 가요제 - "넌 가로수길 가" 핫플레이스 동묘 침범을 거부하는 정형돈과 데프콘 20131012'
  )
)
  and status = 'completed';

update shorts_mvp.generated_shorts s
set expires_at = null,
    status = 'ready',
    rerender_progress = 0,
    pending_render_hash = null,
    rerender_batch_job_id = null,
    output_s3_key = concat(
      'examples/',
      s.job_id,
      '/',
      s.id,
      '/v',
      s.render_version,
      '.mp4'
    )
where s.job_id in (
    'a8e6ea45-89e1-4a3e-a2b7-4b297ce439dc'::uuid,
    'cf3211c5-8cc2-45f4-af99-cab3c7b98d13'::uuid,
    'ddf33f5f-03d1-43e6-abd4-50cf163445d0'::uuid
  )
  and s.status in ('ready', 'rerendering')
  and s.deleted_at is null
  and exists (
    select 1
    from shorts_mvp.video_jobs j
    where j.id = s.job_id
      and j.is_example
      and j.status = 'completed'
  );
