begin;

set local lock_timeout = '3s';

-- Additive only: historical jobs keep NULL and retain their original renderer.
-- New link and upload jobs persist the immutable release selected at creation.
alter table shorts_mvp.video_jobs
  add column if not exists initial_editor_release_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='shorts_mvp.video_jobs'::regclass
      and conname='video_jobs_initial_editor_release_id_fkey'
  ) then
    alter table shorts_mvp.video_jobs
      add constraint video_jobs_initial_editor_release_id_fkey
      foreign key (initial_editor_release_id)
      references shorts_mvp.editor_releases(id)
      on delete restrict not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='shorts_mvp.video_jobs'::regclass
      and conname='video_jobs_initial_editor_release_v4_check'
  ) then
    alter table shorts_mvp.video_jobs
      add constraint video_jobs_initial_editor_release_v4_check check (
        initial_editor_release_id is null
        or (
          initial_render_spec_version=4
          and initial_caption_render_spec_version=4
        )
      ) not valid;
  end if;
end;
$$;

create index if not exists video_jobs_initial_editor_release_idx
  on shorts_mvp.video_jobs(initial_editor_release_id)
  where initial_editor_release_id is not null;

comment on column shorts_mvp.video_jobs.initial_editor_release_id is
  'Immutable editor release selected at initial-render admission; historical jobs remain NULL.';

commit;
