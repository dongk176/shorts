begin;

alter table shorts_mvp.billing_card_verifications
  drop constraint if exists billing_card_verifications_credential_scope_check;
alter table shorts_mvp.billing_card_verifications
  add constraint billing_card_verifications_credential_scope_check
    check (
      provider_credential_scope is null
      or provider_credential_scope in ('default','package','manual')
    );

alter table shorts_mvp.payment_method_registrations
  drop constraint if exists payment_method_registrations_credential_scope_check;
alter table shorts_mvp.payment_method_registrations
  add constraint payment_method_registrations_credential_scope_check
    check (provider_credential_scope in ('default','package','manual'));

alter table shorts_mvp.payment_provider_installment_capabilities
  drop constraint if exists payment_provider_installment_capabilities_credential_scope_check;
alter table shorts_mvp.payment_provider_installment_capabilities
  add constraint payment_provider_installment_capabilities_credential_scope_check
    check (credential_scope in ('default','package','manual'));

insert into shorts_mvp.payment_provider_installment_capabilities (
  provider,credential_scope,installment_months,enabled,verified_at,note,updated_by_user_id
)
select
  provider,'manual',installment_months,enabled,verified_at,
  concat('[package scope 이관] ',note),updated_by_user_id
from shorts_mvp.payment_provider_installment_capabilities
where credential_scope='package'
on conflict (provider,credential_scope,installment_months) do nothing;

insert into shorts_mvp.runtime_feature_flags (
  flag_key,enabled,description
) values
  (
    'package_manual_billing',
    false,
    'arti02 패키지 수기결제 운영 스위치. 환경 모드가 manual일 때만 사용'
  ),
  (
    'addon_manual_billing',
    false,
    'arti02 추가시간 수기결제 운영 스위치. 환경 모드가 manual일 때만 사용'
  )
on conflict (flag_key) do nothing;

update shorts_mvp.billing_orders
set provider_card_id_hash=null,
  installment_terms_snapshot=installment_terms_snapshot-'providerResponseCardLast4'
where coalesce(installment_terms_snapshot->>'credentialScope','') in ('package','manual');

update shorts_mvp.billing_payment_events event
set card_id_hash=null,
  event_summary=event.event_summary-'last4'
where exists (
  select 1
  from shorts_mvp.billing_orders purchase
  where purchase.id=event.billing_order_id
    and coalesce(purchase.installment_terms_snapshot->>'credentialScope','')
      in ('package','manual')
);

comment on column shorts_mvp.payment_provider_installment_capabilities.credential_scope is
  'default=arti01 정기결제, manual=arti02 패키지·추가시간 수기결제, package=과거 기록 호환';

commit;
