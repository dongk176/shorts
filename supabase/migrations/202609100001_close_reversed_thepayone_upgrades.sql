-- These legacy Pro replacements were automatically reversed before any quota
-- was granted. A later webhook left them in manual_review, blocking repurchase.
-- Preserve all payment/refund evidence; change only the terminal order state.
-- No payment, refund, subscription, payment method or usage mutation occurs.
update shorts_mvp.billing_orders o
set status='canceled',
    failure_message=concat_ws(' ',o.failure_message,
      '전액 취소 및 사용량 미지급 확인: 재구매 차단 해제 (2026-09-10).')
where o.id in (
  'e7616344-e336-4bee-81f9-cc330181e285'::uuid,
  '8d9aeda7-ef70-405e-ad8d-7519a523503b'::uuid,
  '255922fb-c793-4566-87cb-81b4bbf46eb3'::uuid
)
  and o.provider='thepayone'
  and o.status in ('failed','manual_review')
  and o.amount_krw>0
  and o.refunded_amount_krw=o.amount_krw
  and o.refund_status='full'
  and o.proration_refund_status='succeeded'
  and o.proration_refund_transaction_id is not null
  and exists (
    select 1 from shorts_mvp.billing_attempts a
    where a.order_id=o.id and a.provider_code='PRO_REFUND_FAILED_PACKAGE_REVERSED'
  )
  and not exists (
    select 1 from shorts_mvp.usage_grants g where g.billing_order_id=o.id
  );
