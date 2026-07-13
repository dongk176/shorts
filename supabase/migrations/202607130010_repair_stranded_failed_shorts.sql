begin;

-- Repair rows left behind by terminal job failures before failed-artifact
-- cleanup was introduced. The minute cleanup deletes their S3 objects and
-- sets deleted_at only after deletion succeeds.
update shorts_mvp.generated_shorts s
set status='failed', render_progress=0,
    render_error_code=coalesce(s.render_error_code, j.error_code, 'job_failed'),
    render_error_message=coalesce(
      s.render_error_message,
      j.error_message,
      '상위 쇼츠 생성 작업이 실패했습니다.'
    )
from shorts_mvp.video_jobs j
where j.id=s.job_id
  and j.status in ('failed','expired','deleted')
  and s.status in ('rendering','rerendering','ready')
  and s.deleted_at is null;

commit;
