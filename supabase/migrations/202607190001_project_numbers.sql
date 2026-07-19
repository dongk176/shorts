begin;

lock table shorts_mvp.video_jobs in access exclusive mode;

create sequence if not exists shorts_mvp.video_job_project_number_seq
  as bigint
  minvalue 1
  start with 1
  increment by 1;

alter table shorts_mvp.video_jobs
  add column if not exists project_number bigint;

with existing_max as (
  select coalesce(max(project_number), 0)::bigint as value
  from shorts_mvp.video_jobs
), missing_numbers as (
  select id,
    row_number() over (order by created_at, id)::bigint
      + (select value from existing_max) as project_number
  from shorts_mvp.video_jobs
  where project_number is null
)
update shorts_mvp.video_jobs jobs
set project_number = missing_numbers.project_number
from missing_numbers
where jobs.id = missing_numbers.id;

do $$
declare
  max_project_number bigint;
  current_sequence_value bigint;
  sequence_was_called boolean;
begin
  select max(project_number)
  into max_project_number
  from shorts_mvp.video_jobs;

  select last_value, is_called
  into current_sequence_value, sequence_was_called
  from shorts_mvp.video_job_project_number_seq;

  if max_project_number is null then
    perform setval(
      'shorts_mvp.video_job_project_number_seq',
      current_sequence_value,
      sequence_was_called
    );
  else
    perform setval(
      'shorts_mvp.video_job_project_number_seq',
      greatest(
        max_project_number,
        case when sequence_was_called then current_sequence_value else 0 end
      ),
      true
    );
  end if;
end $$;

alter sequence shorts_mvp.video_job_project_number_seq
  owned by shorts_mvp.video_jobs.project_number;

alter table shorts_mvp.video_jobs
  alter column project_number set default
    nextval('shorts_mvp.video_job_project_number_seq'),
  alter column project_number set not null;

alter table shorts_mvp.video_jobs
  drop constraint if exists video_jobs_project_number_positive;
alter table shorts_mvp.video_jobs
  add constraint video_jobs_project_number_positive
  check (project_number > 0);

create unique index if not exists video_jobs_project_number_uidx
  on shorts_mvp.video_jobs (project_number);

grant usage, select on sequence shorts_mvp.video_job_project_number_seq
  to service_role;

comment on column shorts_mvp.video_jobs.project_number is
  'Globally unique, monotonically increasing public project route number.';

commit;
