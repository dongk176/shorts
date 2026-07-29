-- These projects are no longer part of the curated public example set.
-- Keep this after the historical example seed migrations so full migration
-- replays cannot publish them again.
update shorts_mvp.video_jobs
set is_example = false
where (id, project_number, video_title) in (
  (
    'aa9f0409-4dfd-47fa-8014-a0091cb8d08d'::uuid,
    98,
    '3% 확률로 초전설 잡아버린 씩씩맨 [마크 코블몬 EP.03]'
  ),
  (
    'a8e6ea45-89e1-4a3e-a2b7-4b297ce439dc'::uuid,
    106,
    '🔞 13:1 극악의 성비 체대 MT란... (ft. b급)'
  ),
  (
    'cf3211c5-8cc2-45f4-af99-cab3c7b98d13'::uuid,
    108,
    '24시간 동안 한파 날씨의 야외에서 살면 생기는 일'
  ),
  (
    'ddf33f5f-03d1-43e6-abd4-50cf163445d0'::uuid,
    112,
    '[HOT] 무한도전 가요제 - "넌 가로수길 가" 핫플레이스 동묘 침범을 거부하는 정형돈과 데프콘 20131012'
  )
);
