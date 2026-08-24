begin;

insert into shorts_mvp.runtime_feature_flags (
  flag_key,enabled,description
) values (
  'unified_template_subtitles_canary',
  false,
  '지정된 관리자 카나리에서 통합 v5 템플릿 자막만 허용하는 독립 롤백 스위치'
)
on conflict (flag_key) do nothing;

commit;
