begin;

alter table shorts_mvp.user_email_notification_preferences
  add column if not exists marketing_email_status text,
  add column if not exists marketing_decided_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname='user_email_notification_preferences_marketing_status_check'
      and conrelid='shorts_mvp.user_email_notification_preferences'::regclass
  ) then
    alter table shorts_mvp.user_email_notification_preferences
      add constraint user_email_notification_preferences_marketing_status_check
      check (
        marketing_email_status is null
        or marketing_email_status in ('enabled','declined')
      );
  end if;
end;
$$;

create index if not exists user_email_notification_preferences_marketing_idx
  on shorts_mvp.user_email_notification_preferences (marketing_decided_at,user_id)
  where marketing_email_status='enabled';

comment on column
  shorts_mvp.user_email_notification_preferences.marketing_email_status is
  'Explicit optional consent for advertising event and promotional emails. Null means not asked.';
comment on column
  shorts_mvp.user_email_notification_preferences.marketing_decided_at is
  'Audit timestamp for the latest advertising email consent or refusal decision.';

commit;
