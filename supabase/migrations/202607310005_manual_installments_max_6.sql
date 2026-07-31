begin;

-- arti02 운영 수기결제 응답에서 할부 상한이 6개월로 확인되었다.
-- 애플리케이션도 같은 상한을 강제하며, DB capability 역시 그 범위를 넘겨
-- 다시 노출되지 않도록 비활성화한다.
update shorts_mvp.payment_provider_installment_capabilities
set
  enabled=false,
  verified_at=clock_timestamp(),
  note='arti02 운영 승인 응답 기준 수기결제 최대 6개월. 7개월 이상 비활성화'
where provider='thepayone'
  and credential_scope='manual'
  and installment_months>6
  and enabled=true;

commit;
