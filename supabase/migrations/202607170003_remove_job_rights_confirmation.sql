alter table shorts_mvp.video_jobs
  drop constraint if exists video_jobs_rights_confirmed_check;

alter table shorts_mvp.video_jobs
  alter column rights_confirmed set default false;

comment on column shorts_mvp.video_jobs.rights_confirmed is
  'Legacy per-job rights attestation; false for jobs created after the confirmation UI was removed.';
