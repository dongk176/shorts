begin;

create table if not exists shorts_mvp.custom_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 50),
  base_template_id text not null check (
    base_template_id in ('dark-red', 'white-yellow', 'dark-minimal', 'paper', 'comment-capture')
  ),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists custom_templates_user_updated_idx
  on shorts_mvp.custom_templates (user_id, updated_at desc);

alter table shorts_mvp.custom_templates enable row level security;
revoke all on table shorts_mvp.custom_templates from anon, authenticated;
grant all on table shorts_mvp.custom_templates to service_role;

drop trigger if exists custom_templates_set_updated_at on shorts_mvp.custom_templates;
create trigger custom_templates_set_updated_at before update on shorts_mvp.custom_templates
for each row execute function shorts_mvp.set_updated_at();

alter table shorts_mvp.video_jobs
  add column if not exists custom_template_id uuid
    references shorts_mvp.custom_templates(id) on delete set null;
alter table shorts_mvp.video_jobs
  add column if not exists template_snapshot jsonb;

alter table shorts_mvp.generated_shorts
  add column if not exists custom_template_id uuid
    references shorts_mvp.custom_templates(id) on delete set null;
alter table shorts_mvp.generated_shorts
  add column if not exists template_snapshot jsonb;

alter table shorts_mvp.video_jobs
  drop constraint if exists video_jobs_template_snapshot_object_check;
alter table shorts_mvp.video_jobs
  add constraint video_jobs_template_snapshot_object_check check (
    template_snapshot is null or jsonb_typeof(template_snapshot) = 'object'
  );

alter table shorts_mvp.generated_shorts
  drop constraint if exists generated_shorts_template_snapshot_object_check;
alter table shorts_mvp.generated_shorts
  add constraint generated_shorts_template_snapshot_object_check check (
    template_snapshot is null or jsonb_typeof(template_snapshot) = 'object'
  );

create index if not exists video_jobs_custom_template_idx
  on shorts_mvp.video_jobs (custom_template_id) where custom_template_id is not null;
create index if not exists generated_shorts_custom_template_idx
  on shorts_mvp.generated_shorts (custom_template_id) where custom_template_id is not null;

commit;
