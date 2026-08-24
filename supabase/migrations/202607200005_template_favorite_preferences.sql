begin;

create table if not exists shorts_mvp.template_favorite_preferences (
  user_id uuid primary key references shorts_mvp.app_users(id) on delete cascade,
  template_keys jsonb not null default '["preset:comment-capture", "preset:dark-minimal", "preset:paper"]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint template_favorite_preferences_keys_array_check check (
    jsonb_typeof(template_keys) = 'array'
    and jsonb_array_length(template_keys) <= 4
  )
);

alter table shorts_mvp.template_favorite_preferences enable row level security;
revoke all on table shorts_mvp.template_favorite_preferences from anon, authenticated;
grant all on table shorts_mvp.template_favorite_preferences to service_role;

drop trigger if exists template_favorite_preferences_set_updated_at
  on shorts_mvp.template_favorite_preferences;
create trigger template_favorite_preferences_set_updated_at
before update on shorts_mvp.template_favorite_preferences
for each row execute function shorts_mvp.set_updated_at();

commit;
