alter table shorts_mvp.video_jobs
  add column if not exists output_language text not null default 'ko';

alter table shorts_mvp.video_jobs
  drop constraint if exists video_jobs_output_language_check;

alter table shorts_mvp.video_jobs
  add constraint video_jobs_output_language_check check (
    output_language in ('ko', 'en', 'ja', 'zh-CN', 'es', 'fr', 'de', 'pt-BR')
  );
