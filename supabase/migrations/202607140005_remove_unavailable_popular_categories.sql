begin;

delete from shorts_mvp.popular_video_items
where category in ('education', 'travel');

alter table shorts_mvp.popular_video_runs
  drop constraint if exists popular_video_runs_expected_categories_check,
  drop constraint if exists popular_video_runs_completed_categories_check;

update shorts_mvp.popular_video_runs
set
  expected_categories = 7,
  completed_categories = least(completed_categories, 7),
  category_summary = category_summary - 'education' - 'travel';

alter table shorts_mvp.popular_video_runs
  alter column expected_categories set default 7,
  add constraint popular_video_runs_expected_categories_check
    check (expected_categories = 7),
  add constraint popular_video_runs_completed_categories_check
    check (completed_categories between 0 and 7);

alter table shorts_mvp.popular_video_items
  drop constraint if exists popular_video_items_category_check,
  add constraint popular_video_items_category_check check (category in (
    'entertainment', 'gaming', 'sports', 'music',
    'news', 'science', 'howto'
  ));

commit;
