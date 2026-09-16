-- Completing/closing the former tutorial did not express an opt-out.
-- Existing accounts therefore see the guide again until explicitly opting out.
alter table shorts_mvp.language_guide_views
  add column dont_show_again boolean not null default false;
