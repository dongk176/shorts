begin;

alter table shorts_mvp.payment_test_package_orders
  add column if not exists provider_response_card_type text;

alter table shorts_mvp.payment_test_package_orders
  drop constraint if exists payment_test_package_orders_response_card_type_length;

alter table shorts_mvp.payment_test_package_orders
  add constraint payment_test_package_orders_response_card_type_length
    check (
      provider_response_card_type is null
      or char_length(provider_response_card_type) between 1 and 50
    );

comment on column shorts_mvp.payment_test_package_orders.provider_response_card_type is
  '더페이원 승인 응답의 신용|체크 구분. 카드번호나 인증값은 저장하지 않음';

commit;
