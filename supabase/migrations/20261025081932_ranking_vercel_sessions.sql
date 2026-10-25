alter table shorts_mvp.ranking_operations add column executor text not null default 'ecs' check (executor in ('ecs','vercel'));
create table shorts_mvp.ranking_vercel_sessions (
 project_id uuid primary key references shorts_mvp.ranking_projects(id) on delete cascade,
 generation uuid not null, sandbox_name text, base_url text,
 status text not null check(status in ('starting','ready','stopped','failed')),
 expires_at timestamptz not null, created_at timestamptz not null default now()
);
alter table shorts_mvp.ranking_vercel_sessions enable row level security;
revoke all on shorts_mvp.ranking_vercel_sessions from public,anon,authenticated;
-- Old ECS workers cannot claim or expire Vercel work, including during rollback.
create or replace view shorts_ranking_runtime.ranking_operations with (security_barrier=true) as
 select id,project_id,source_id,action,status,payload,result,error,task_id,created_at,updated_at,finished_at,request_id
 from shorts_mvp.ranking_operations where executor='ecs' with local check option;
