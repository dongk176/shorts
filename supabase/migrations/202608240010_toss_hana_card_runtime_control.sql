begin;

-- Hana Card (Toss issuer code 21) remains fail-closed until its card-company
-- review is approved. The audited admin switch can enable it without a deploy.
insert into shorts_mvp.runtime_feature_flags (
  flag_key,enabled,description
) values (
  'toss_billing_hana_card',
  false,
  '하나카드 토스 자동결제 허용. 카드사 심사 승인 후 관리자 스위치로 활성화'
)
on conflict (flag_key) do nothing;

commit;
