begin;

-- End the 10k thank-you campaign without revoking grants that were already
-- issued. Application code also defaults the deployment kill switch to off.
insert into shorts_mvp.runtime_feature_flags (
  flag_key,enabled,description
) values (
  'shorts_10k_thank_you_event',
  false,
  '종료된 쇼츠 1만 개 감사 이벤트: 신규 안내 및 50분 지급 중단'
)
on conflict (flag_key) do update
set enabled=false,
  description=excluded.description,
  updated_by_user_id=null;

commit;
