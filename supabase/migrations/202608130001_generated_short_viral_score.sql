alter table shorts_mvp.generated_shorts
  add column if not exists viral_score smallint;

alter table shorts_mvp.generated_shorts
  drop constraint if exists generated_shorts_viral_score_check;

alter table shorts_mvp.generated_shorts
  add constraint generated_shorts_viral_score_check check (
    viral_score is null or viral_score between 0 and 100
  );

comment on column shorts_mvp.generated_shorts.viral_score is
  'Transcript-based AI estimate of the selected clip viral potential, from 0 to 100';
