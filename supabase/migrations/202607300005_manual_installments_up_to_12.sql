begin;

-- arti02 수기결제는 더페이원 API가 받는 할부개월 중 고객 결제창에서
-- 최대 12개월까지만 사용한다. capability가 일반 할부 선택 가능 범위를 정하고,
-- 게시 중인 카드사 캠페인은 같은 카드사·개월의 무이자/부분 무이자 표시만 꾸민다.
insert into shorts_mvp.payment_provider_installment_capabilities (
  provider,
  credential_scope,
  installment_months,
  enabled,
  verified_at,
  note
)
select
  'thepayone',
  'manual',
  months,
  true,
  clock_timestamp(),
  'arti02 수기결제 API 지원 범위. 2~12개월 일반 할부를 노출하고 캠페인 일치 개월에는 혜택을 표시'
from generate_series(2,12) as months
on conflict (provider,credential_scope,installment_months) do update
set
  enabled=true,
  verified_at=coalesce(
    shorts_mvp.payment_provider_installment_capabilities.verified_at,
    excluded.verified_at
  ),
  note=case
    when trim(coalesce(shorts_mvp.payment_provider_installment_capabilities.note,''))=''
      then excluded.note
    else shorts_mvp.payment_provider_installment_capabilities.note
  end;

commit;
