begin;

create index if not exists popular_video_items_reusable_history_idx
  on shorts_mvp.popular_video_items (run_id, video_id, collected_at desc)
  where license = 'creativeCommon';

create index if not exists popular_search_items_reusable_history_idx
  on shorts_mvp.popular_search_items (run_id, video_id, collected_at desc)
  where license = 'creativeCommon';

commit;
