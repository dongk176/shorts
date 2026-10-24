-- Additive, private administrator-only workflow; no existing job/billing tables change.
create table shorts_mvp.ranking_projects (
  id uuid primary key,
  user_id uuid not null references shorts_mvp.app_users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  deleted_at timestamptz,
  draft jsonb not null default '{}'::jsonb,
  check (jsonb_typeof(draft) = 'object')
);
create index ranking_projects_owner on shorts_mvp.ranking_projects(user_id, created_at desc) where deleted_at is null;
create table shorts_mvp.ranking_sources (
  id uuid primary key,
  project_id uuid not null references shorts_mvp.ranking_projects(id) on delete cascade,
  status text not null check (status in ('uploading','queued','ready','failed','expired')),
  remote_url text,
  size_bytes bigint check (size_bytes between 1 and 262144000),
  metadata jsonb,
  task_id text,
  error text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours'
);
create index ranking_sources_project on shorts_mvp.ranking_sources(project_id);
create table shorts_mvp.ranking_operations (
  id uuid primary key,
  project_id uuid not null references shorts_mvp.ranking_projects(id) on delete cascade,
  source_id uuid references shorts_mvp.ranking_sources(id),
  action text not null check (action in ('inspect','import','preview','render')),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed')),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  task_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  request_id uuid not null,
  unique(project_id, request_id)
);
create unique index ranking_one_active_operation on shorts_mvp.ranking_operations(project_id) where status in ('queued','running');
create index ranking_operation_queue on shorts_mvp.ranking_operations(created_at) where status='queued';
create index ranking_operation_history on shorts_mvp.ranking_operations(project_id, created_at desc);
create table shorts_mvp.ranking_completion_emails (
  operation_id uuid primary key references shorts_mvp.ranking_operations(id),
  status text not null default 'pending' check(status in ('pending','processing','sent','failed','skipped')),
  attempt_count integer not null default 0 check(attempt_count between 0 and 5),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text
);
create index ranking_email_pending on shorts_mvp.ranking_completion_emails(available_at) where status in ('pending','processing');
alter table shorts_mvp.ranking_projects enable row level security;
alter table shorts_mvp.ranking_sources enable row level security;
alter table shorts_mvp.ranking_operations enable row level security;
alter table shorts_mvp.ranking_completion_emails enable row level security;
revoke all on shorts_mvp.ranking_projects, shorts_mvp.ranking_sources, shorts_mvp.ranking_operations, shorts_mvp.ranking_completion_emails from public, anon, authenticated;

-- No password in migrations. Runtime login is enabled separately only after
-- production identity/privilege audit, with the password held in existing Secrets Manager.
create role shorts_ranking_runtime nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
-- Do not grant shorts_mvp USAGE: existing PUBLIC-executable SECURITY DEFINER
-- functions there control ordinary jobs. The worker sees only these narrow views.
create schema shorts_ranking_runtime authorization postgres;
revoke all on schema shorts_ranking_runtime from public,anon,authenticated;
grant usage on schema shorts_ranking_runtime to shorts_ranking_runtime;
create view shorts_ranking_runtime.app_users with (security_barrier=true) as
  select id,is_admin from shorts_mvp.app_users where is_admin=true;
create view shorts_ranking_runtime.ranking_projects with (security_barrier=true) as
  select id,user_id,created_at,expires_at,deleted_at,draft from shorts_mvp.ranking_projects;
create view shorts_ranking_runtime.ranking_sources with (security_barrier=true) as
  select id,project_id,status,remote_url,size_bytes,metadata,task_id,error,created_at,expires_at from shorts_mvp.ranking_sources;
create view shorts_ranking_runtime.ranking_operations with (security_barrier=true) as
  select id,project_id,source_id,action,status,payload,result,error,task_id,created_at,updated_at,finished_at,request_id from shorts_mvp.ranking_operations;
revoke all on all tables in schema shorts_ranking_runtime from public,anon,authenticated;
grant select on all tables in schema shorts_ranking_runtime to shorts_ranking_runtime;
grant update(status,metadata,task_id,error,expires_at) on shorts_ranking_runtime.ranking_sources to shorts_ranking_runtime;
grant update(status,result,error,task_id,updated_at,finished_at) on shorts_ranking_runtime.ranking_operations to shorts_ranking_runtime;
create function shorts_ranking_runtime.enqueue_completion(operation uuid) returns void
language sql security definer set search_path=pg_catalog as $$
  insert into shorts_mvp.ranking_completion_emails(operation_id)
  select o.id from shorts_mvp.ranking_operations o
  join shorts_mvp.ranking_projects p on p.id=o.project_id
  join shorts_mvp.app_users u on u.id=p.user_id
  where o.id=operation and o.action='render' and o.status='succeeded'
    and u.is_admin=true and p.deleted_at is null and p.expires_at>now()
  on conflict do nothing;
$$;
revoke all on function shorts_ranking_runtime.enqueue_completion(uuid) from public,anon,authenticated;
grant execute on function shorts_ranking_runtime.enqueue_completion(uuid) to shorts_ranking_runtime;
