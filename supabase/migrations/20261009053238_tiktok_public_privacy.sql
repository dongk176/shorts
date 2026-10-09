-- Direct Post audit approved for EasyCut app 7687459606926346258 on 2026-10-09.
-- Existing private posts, ownership, RLS and table grants remain unchanged.
set local lock_timeout = '5s';
alter table shorts_mvp.tiktok_posts drop constraint tiktok_posts_privacy_check;
alter table shorts_mvp.tiktok_posts add constraint tiktok_posts_privacy_check
  check (privacy in ('SELF_ONLY','PUBLIC_TO_EVERYONE','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR'));
