begin;

set local lock_timeout = '3s';
set local statement_timeout = '30s';

insert into shorts_mvp.runtime_feature_flags (
  flag_key,enabled,description
) values (
  'unified_template_subtitles_public',
  false,
  '통합 v5 자막 템플릿의 미리보기·저장·링크 생성·재편집 렌더를 일반 유료 사용자에게 공개하는 독립 스위치'
)
on conflict (flag_key) do nothing;

commit;
