alter table shorts_mvp.generated_shorts
  add column if not exists selection_raw_start_seconds numeric(10,3),
  add column if not exists selection_raw_end_seconds numeric(10,3),
  add column if not exists selection_raw_duration_seconds numeric(10,3),
  add column if not exists selection_candidate_index integer,
  add column if not exists selection_provider text,
  add column if not exists selection_model text,
  add column if not exists selection_length_adjustment text,
  add column if not exists selection_repositioned boolean;

alter table shorts_mvp.generated_shorts
  drop constraint if exists generated_shorts_selection_raw_range_check,
  drop constraint if exists generated_shorts_selection_candidate_index_check,
  drop constraint if exists generated_shorts_selection_provider_length_check,
  drop constraint if exists generated_shorts_selection_model_length_check,
  drop constraint if exists generated_shorts_selection_length_adjustment_check;

alter table shorts_mvp.generated_shorts
  add constraint generated_shorts_selection_raw_range_check check (
    (
      selection_raw_start_seconds is null
      and selection_raw_end_seconds is null
      and selection_raw_duration_seconds is null
    )
    or (
      selection_raw_start_seconds is not null
      and selection_raw_end_seconds is not null
      and selection_raw_duration_seconds is not null
      and selection_raw_end_seconds > selection_raw_start_seconds
      and selection_raw_duration_seconds > 0
      and abs(
        selection_raw_duration_seconds
        - (selection_raw_end_seconds - selection_raw_start_seconds)
      ) <= 0.001
    )
  ),
  add constraint generated_shorts_selection_candidate_index_check check (
    selection_candidate_index is null or selection_candidate_index >= 1
  ),
  add constraint generated_shorts_selection_provider_length_check check (
    selection_provider is null or char_length(selection_provider) between 1 and 50
  ),
  add constraint generated_shorts_selection_model_length_check check (
    selection_model is null or char_length(selection_model) between 1 and 200
  ),
  add constraint generated_shorts_selection_length_adjustment_check check (
    selection_length_adjustment is null
    or selection_length_adjustment in ('none', 'min_clamp', 'max_clamp')
  );

comment on column shorts_mvp.generated_shorts.selection_raw_start_seconds is
  'Provider-selected start time before clip normalization';
comment on column shorts_mvp.generated_shorts.selection_raw_end_seconds is
  'Provider-selected end time before clip normalization';
comment on column shorts_mvp.generated_shorts.selection_raw_duration_seconds is
  'Provider-selected duration before clip normalization';
comment on column shorts_mvp.generated_shorts.selection_length_adjustment is
  'Length normalization applied to the provider-selected clip';
comment on column shorts_mvp.generated_shorts.selection_repositioned is
  'Whether overlap or source bounds moved the selected start time';
