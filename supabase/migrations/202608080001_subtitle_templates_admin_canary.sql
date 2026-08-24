begin;

set local lock_timeout = '3s';
set local statement_timeout = '10min';

alter table shorts_mvp.video_jobs
  add column if not exists subtitle_template_id text,
  add column if not exists subtitle_template_snapshot jsonb;

alter table shorts_mvp.generated_shorts
  add column if not exists subtitle_template_id text,
  add column if not exists subtitle_template_snapshot jsonb,
  add column if not exists caption_render_spec jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid='shorts_mvp.video_jobs'::regclass
      and conname='video_jobs_subtitle_template_check'
  ) then
    alter table shorts_mvp.video_jobs
      add constraint video_jobs_subtitle_template_check check (
        (
          subtitle_template_id is null
          and subtitle_template_snapshot is null
        ) or (
          subtitle_template_id in ('basic','highlight','pop')
          and jsonb_typeof(subtitle_template_snapshot)='object'
          and (subtitle_template_snapshot->>'subtitleTemplateId')
            is not distinct from subtitle_template_id
        )
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid='shorts_mvp.generated_shorts'::regclass
      and conname='generated_shorts_subtitle_template_check'
  ) then
    alter table shorts_mvp.generated_shorts
      add constraint generated_shorts_subtitle_template_check check (
        (
          subtitle_template_id is null
          and subtitle_template_snapshot is null
          and caption_render_spec is null
        ) or (
          subtitle_template_id in ('basic','highlight','pop')
          and jsonb_typeof(subtitle_template_snapshot)='object'
          and (subtitle_template_snapshot->>'subtitleTemplateId')
            is not distinct from subtitle_template_id
          and (
            caption_render_spec is null
            or (
              jsonb_typeof(caption_render_spec)='object'
              and (caption_render_spec->>'templateId')
                is not distinct from subtitle_template_id
            )
          )
        )
      ) not valid;
  end if;
end;
$$;

create or replace function shorts_mvp.prevent_subtitle_template_identity_update()
returns trigger
language plpgsql
set search_path = shorts_mvp, pg_temp
as $$
begin
  if new.subtitle_template_id is distinct from old.subtitle_template_id
    or new.subtitle_template_snapshot is distinct from old.subtitle_template_snapshot
  then
    raise exception 'subtitle template identity is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists video_jobs_subtitle_template_identity_immutable
  on shorts_mvp.video_jobs;
create trigger video_jobs_subtitle_template_identity_immutable
before update of subtitle_template_id,subtitle_template_snapshot
on shorts_mvp.video_jobs
for each row execute function shorts_mvp.prevent_subtitle_template_identity_update();

drop trigger if exists generated_shorts_subtitle_template_identity_immutable
  on shorts_mvp.generated_shorts;
create trigger generated_shorts_subtitle_template_identity_immutable
before update of subtitle_template_id,subtitle_template_snapshot
on shorts_mvp.generated_shorts
for each row execute function shorts_mvp.prevent_subtitle_template_identity_update();

insert into shorts_mvp.runtime_feature_flags (flag_key,enabled,description)
values
  (
    'subtitle_templates',
    false,
    '완성형 자막 템플릿 3종을 어드민 카나리에 허용하는 스위치'
  ),
  (
    'subtitle_templates_public',
    false,
    '검증된 완성형 자막 템플릿을 전체 사용자에게 공개하는 스위치'
  )
on conflict (flag_key) do nothing;

comment on column shorts_mvp.video_jobs.subtitle_template_id is
  'Immutable admin-canary subtitle template selection: basic, highlight, or pop';
comment on column shorts_mvp.video_jobs.subtitle_template_snapshot is
  'Immutable trusted style snapshot selected when the job is created';
comment on column shorts_mvp.generated_shorts.subtitle_template_id is
  'Subtitle template copied from the owning job; null for all legacy outputs';
comment on column shorts_mvp.generated_shorts.subtitle_template_snapshot is
  'Immutable trusted caption style snapshot used by the candidate renderer';
comment on column shorts_mvp.generated_shorts.caption_render_spec is
  'Clip-local 30fps caption events, fixed line breaks, safe box, and font/style identity';

commit;
