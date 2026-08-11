begin;

insert into shorts_mvp.runtime_feature_flags (
  flag_key,enabled,description
) values (
  'editor_subtitle_editing_public',
  false,
  '검증된 자막 편집 capability를 가진 stable 편집기 릴리스를 전체 사용자에게 공개하는 스위치'
)
on conflict (flag_key) do nothing;

insert into shorts_mvp.runtime_feature_flags (
  flag_key,enabled,description
) values (
  'elevenlabs_public_compliance_approved',
  false,
  'ElevenLabs 데이터 사용 설정, 미성년자 음성 정책, 개인정보·국외이전 고지를 확인한 뒤에만 켜는 공개 승인 스위치'
)
on conflict (flag_key) do nothing;

commit;
