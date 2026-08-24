begin;

alter table shorts_mvp.generated_shorts
  add column if not exists edit_timeline_s3_key text,
  add column if not exists edit_timeline_start_seconds numeric(10,3),
  add column if not exists edit_timeline_end_seconds numeric(10,3),
  add column if not exists edit_timeline_subtitle_segments jsonb,
  add column if not exists edit_timeline_version smallint,
  add column if not exists initial_start_seconds numeric(10,3),
  add column if not exists initial_end_seconds numeric(10,3),
  add column if not exists pending_edit_snapshot jsonb;

update shorts_mvp.generated_shorts
set initial_start_seconds=coalesce(initial_start_seconds,start_seconds),
    initial_end_seconds=coalesce(initial_end_seconds,end_seconds)
where initial_start_seconds is null or initial_end_seconds is null;

-- Older rows calculated the three values separately in the worker. Normalize the
-- stored duration before adding an exact range-consistency constraint.
update shorts_mvp.generated_shorts
set duration_seconds=end_seconds-start_seconds
where duration_seconds is distinct from end_seconds-start_seconds;

alter table shorts_mvp.generated_shorts
  drop constraint if exists generated_shorts_duration_seconds_check,
  drop constraint if exists generated_shorts_duration_range_check,
  drop constraint if exists generated_shorts_initial_range_check,
  drop constraint if exists generated_shorts_edit_timeline_check,
  drop constraint if exists generated_shorts_edit_timeline_json_check,
  drop constraint if exists generated_shorts_pending_edit_snapshot_check;

alter table shorts_mvp.generated_shorts
  add constraint generated_shorts_duration_range_check check (
    duration_seconds >= 1
    and end_seconds > start_seconds
    and duration_seconds = end_seconds - start_seconds
  ),
  add constraint generated_shorts_initial_range_check check (
    (initial_start_seconds is null and initial_end_seconds is null)
    or (
      initial_start_seconds is not null
      and initial_start_seconds >= 0
      and initial_end_seconds is not null
      and initial_end_seconds > initial_start_seconds
    )
  ),
  add constraint generated_shorts_edit_timeline_check check (
    (
      edit_timeline_s3_key is null
      and edit_timeline_start_seconds is null
      and edit_timeline_end_seconds is null
      and edit_timeline_subtitle_segments is null
      and edit_timeline_version is null
    ) or (
      edit_timeline_s3_key is not null
      and edit_timeline_start_seconds is not null
      and edit_timeline_start_seconds >= 0
      and edit_timeline_end_seconds is not null
      and edit_timeline_end_seconds > edit_timeline_start_seconds
      and edit_timeline_subtitle_segments is not null
      and edit_timeline_version is not null
      and edit_timeline_version >= 1
      and initial_start_seconds is not null
      and initial_end_seconds is not null
      and start_seconds >= edit_timeline_start_seconds
      and end_seconds <= edit_timeline_end_seconds
    )
  ),
  add constraint generated_shorts_edit_timeline_json_check check (
    edit_timeline_subtitle_segments is null
    or jsonb_typeof(edit_timeline_subtitle_segments)='array'
  ),
  add constraint generated_shorts_pending_edit_snapshot_check check (
    pending_edit_snapshot is null
    or jsonb_typeof(pending_edit_snapshot)='object'
  );

comment on column shorts_mvp.generated_shorts.edit_timeline_s3_key is
  'Same-layout edit source containing up to 30 seconds before and after the initial clip';
comment on column shorts_mvp.generated_shorts.edit_timeline_start_seconds is
  'Absolute source timestamp represented by edit timeline time zero';
comment on column shorts_mvp.generated_shorts.edit_timeline_subtitle_segments is
  'Subtitle segments relative to the beginning of the edit timeline';
comment on column shorts_mvp.generated_shorts.pending_edit_snapshot is
  'Validated local range-editor configuration awaiting atomic rerender promotion';

commit;
