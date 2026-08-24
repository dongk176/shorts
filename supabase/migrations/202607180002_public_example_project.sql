alter table shorts_mvp.video_jobs
  add column if not exists is_example boolean not null default false;

create index if not exists video_jobs_public_examples_idx
  on shorts_mvp.video_jobs (created_at desc)
  where is_example and status = 'completed';

alter table shorts_mvp.generated_shorts
  alter column expires_at drop not null;

alter table shorts_mvp.generated_shorts
  drop constraint if exists generated_shorts_expires_at_check;

alter table shorts_mvp.generated_shorts
  add constraint generated_shorts_expires_at_check check (
    expires_at is null or expires_at <= created_at + interval '30 days'
  );

update shorts_mvp.video_jobs
set is_example = true,
    expires_at = null
where id = 'aa9f0409-4dfd-47fa-8014-a0091cb8d08d'::uuid
  and video_title = '3% 확률로 초전설 잡아버린 씩씩맨 [마크 코블몬 EP.03]'
  and status = 'completed';

update shorts_mvp.generated_shorts s
set expires_at = null,
    output_s3_key = concat(
      'examples/aa9f0409-4dfd-47fa-8014-a0091cb8d08d/',
      s.id,
      '/v',
      s.render_version,
      '.mp4'
    )
where s.job_id = 'aa9f0409-4dfd-47fa-8014-a0091cb8d08d'::uuid
  and s.status = 'ready'
  and s.deleted_at is null
  and exists (
    select 1
    from shorts_mvp.video_jobs j
    where j.id = s.job_id and j.is_example
  );
