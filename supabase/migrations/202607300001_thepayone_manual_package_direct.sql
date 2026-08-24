begin;

alter table shorts_mvp.payment_test_package_orders
  alter column registration_id drop not null,
  add column if not exists payment_input_mode text,
  add column if not exists provider_response_issuer text,
  add column if not exists provider_response_card_last4 text;

update shorts_mvp.payment_test_package_orders
set payment_input_mode=case
  when registration_id is null then 'manual_direct'
  else 'registered_card'
end
where payment_input_mode is null;

alter table shorts_mvp.payment_test_package_orders
  alter column payment_input_mode set default 'manual_direct',
  alter column payment_input_mode set not null;

alter table shorts_mvp.payment_test_package_orders
  drop constraint if exists payment_test_package_orders_response_last4_check;

alter table shorts_mvp.payment_test_package_orders
  drop constraint if exists payment_test_package_orders_input_mode_check,
  drop constraint if exists payment_test_package_orders_registration_mode_check,
  add constraint payment_test_package_orders_input_mode_check
    check (payment_input_mode in ('registered_card','manual_direct')),
  add constraint payment_test_package_orders_registration_mode_check
    check (
      (
        payment_input_mode='registered_card'
        and registration_id is not null
      )
      or (
        payment_input_mode='manual_direct'
        and registration_id is null
      )
    ),
  add constraint payment_test_package_orders_response_last4_check
    check (
      provider_response_card_last4 is null
      or provider_response_card_last4 ~ '^[0-9]{4}$'
    );

comment on column shorts_mvp.payment_test_package_orders.payment_input_mode is
  'registered_card는 폐기된 초기 구현 보존용, manual_direct는 arti02 수기결제 직접 승인';
comment on column shorts_mvp.payment_test_package_orders.registration_id is
  '정기결제 카드등록 기반의 과거 테스트만 사용하며 수기결제 직접 승인에서는 null';

commit;
