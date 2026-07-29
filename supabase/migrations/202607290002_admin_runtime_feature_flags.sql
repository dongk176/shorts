begin;

-- Runtime switches that administrators can change without a web deployment.
-- The seed is intentionally insert-only so replaying migrations never
-- overwrites a value chosen in the administrator console.
create table if not exists shorts_mvp.runtime_feature_flags (
  flag_key text primary key
    check (char_length(flag_key) between 2 and 100),
  enabled boolean not null,
  description text not null default ''
    check (char_length(description) <= 500),
  updated_by_user_id uuid
    references shorts_mvp.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into shorts_mvp.runtime_feature_flags (
  flag_key,enabled,description
) values (
  'login_welcome_grant',
  true,
  '결제 이력이 없는 비유료 회원의 로그인 시 계정당 1회 20분 무료 사용량 지급'
)
on conflict (flag_key) do nothing;

alter table shorts_mvp.runtime_feature_flags enable row level security;
revoke all on shorts_mvp.runtime_feature_flags from anon, authenticated;
grant all on shorts_mvp.runtime_feature_flags to service_role;

drop trigger if exists runtime_feature_flags_set_updated_at
  on shorts_mvp.runtime_feature_flags;
create trigger runtime_feature_flags_set_updated_at
before update on shorts_mvp.runtime_feature_flags
for each row execute function shorts_mvp.set_updated_at();

comment on table shorts_mvp.runtime_feature_flags is
  'Administrator-controlled runtime switches. Changes are also written to admin_audit_logs.';

commit;
