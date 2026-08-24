begin;

set local lock_timeout = '3s';

alter table shorts_mvp.video_jobs
  add column if not exists transcription_policy text not null default 'openai_stable',
  add column if not exists transcription_provider_used text,
  add column if not exists transcription_model_used text,
  add column if not exists transcription_language_code text,
  add column if not exists transcription_fallback_used boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='shorts_mvp.video_jobs'::regclass
      and conname='video_jobs_transcription_policy_check'
  ) then
    alter table shorts_mvp.video_jobs
      add constraint video_jobs_transcription_policy_check check (
        transcription_policy in (
          'openai_stable',
          'elevenlabs_primary_openai_fallback'
        )
      ) not valid;
  end if;
end;
$$;

create table if not exists shorts_mvp.job_transcripts (
  job_id uuid primary key
    references shorts_mvp.video_jobs(id) on delete cascade,
  requested_policy text not null,
  provider_used text not null
    check (provider_used in ('openai','elevenlabs','mixed')),
  model_used text not null,
  language_code text,
  language_probability numeric(6,5),
  fallback_used boolean not null default false,
  fallback_reasons jsonb not null default '[]'::jsonb,
  source_offset_seconds numeric(12,3) not null default 0,
  transcript_text text not null,
  segments jsonb not null default '[]'::jsonb,
  words jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_transcripts_requested_policy_check check (
    requested_policy in (
      'openai_stable',
      'elevenlabs_primary_openai_fallback'
    )
  ),
  constraint job_transcripts_json_shape_check check (
    jsonb_typeof(fallback_reasons)='array'
    and jsonb_typeof(segments)='array'
    and jsonb_typeof(words)='array'
  ),
  constraint job_transcripts_language_probability_check check (
    language_probability is null
    or language_probability between 0 and 1
  )
);

alter table shorts_mvp.job_transcripts enable row level security;
revoke all on shorts_mvp.job_transcripts from anon,authenticated;
grant all on shorts_mvp.job_transcripts to service_role;

drop trigger if exists job_transcripts_set_updated_at
  on shorts_mvp.job_transcripts;
create trigger job_transcripts_set_updated_at
before update on shorts_mvp.job_transcripts
for each row execute function shorts_mvp.set_updated_at();

insert into shorts_mvp.runtime_feature_flags (flag_key,enabled,description)
values (
  'elevenlabs_transcription',
  false,
  'ElevenLabs Scribe v2 다국어 전사를 어드민 카나리에 허용하는 스위치'
)
on conflict (flag_key) do nothing;

insert into shorts_mvp.runtime_feature_flags (flag_key,enabled,description)
values (
  'elevenlabs_transcription_public',
  false,
  '검증된 ElevenLabs 우선 전사를 전체 신규 작업으로 승격하는 공개 스위치'
)
on conflict (flag_key) do nothing;

comment on column shorts_mvp.video_jobs.transcription_policy is
  'Immutable provider policy selected when the job is created';
comment on table shorts_mvp.job_transcripts is
  'Service-only transcript artifact with word timing; deleted with its 30-day job';

commit;
