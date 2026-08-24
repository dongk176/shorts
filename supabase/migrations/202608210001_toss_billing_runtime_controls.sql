begin;

-- Environment variables remain the deployment-level hard ceiling. These
-- database switches let an administrator stop new exposure or provider
-- mutations immediately without rebuilding or changing existing cohorts.
insert into shorts_mvp.runtime_feature_flags (
  flag_key,enabled,description
) values
  (
    'toss_billing_new_assignments',
    false,
    '결제·구독·결제수단 흔적이 없는 회원을 신규 토스 결제군으로 배정'
  ),
  (
    'toss_billing_charges',
    true,
    '토스 결제군의 신규 승인 요청 허용. OFF여도 결제 조회와 환불은 계속 허용'
  ),
  (
    'toss_billing_renewals',
    false,
    '토스 구독 만료 시 자동갱신 승인 허용'
  )
on conflict (flag_key) do nothing;

commit;
