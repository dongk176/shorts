begin;

alter table shorts_mvp.app_users
  add column if not exists manual_service_access_until timestamptz;

create index if not exists app_users_manual_service_access_until_idx
  on shorts_mvp.app_users (manual_service_access_until)
  where manual_service_access_until is not null;

comment on column shorts_mvp.app_users.manual_service_access_until is
  'Optional direct service entitlement for complimentary processing grants and real-time popular filters.';

commit;
