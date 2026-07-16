begin;

alter table shorts_mvp.free_video_items
  add column if not exists is_korean boolean not null default false;
alter table shorts_mvp.popular_video_items
  add column if not exists is_korean boolean not null default false;
alter table shorts_mvp.popular_search_items
  add column if not exists is_korean boolean not null default false;

update shorts_mvp.free_video_items
set is_korean = true
where title ~ '[가-힣].*[가-힣]';

update shorts_mvp.popular_video_items
set is_korean = true
where title ~ '[가-힣].*[가-힣]';

update shorts_mvp.popular_search_items
set is_korean = true
where title ~ '[가-힣].*[가-힣]';

create index if not exists free_video_items_korean_views_idx
  on shorts_mvp.free_video_items (run_id, view_count desc, published_at desc, video_id)
  where is_korean;
create index if not exists popular_video_items_korean_rank_idx
  on shorts_mvp.popular_video_items (run_id, category, category_rank, view_count desc)
  where is_korean;
create index if not exists popular_search_items_korean_views_idx
  on shorts_mvp.popular_search_items (run_id, category, view_count desc, published_at desc, video_id)
  where is_korean;

commit;
