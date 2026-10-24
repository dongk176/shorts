create role anon; create role authenticated;
create schema shorts_mvp;
create table shorts_mvp.app_users(id uuid primary key,is_admin boolean,email text);
create table shorts_mvp.video_jobs (
 id uuid primary key, ingestion_route_id text, ingestion_route_leased_at timestamptz,
 status text, deadline_at timestamptz,queue_expires_at timestamptz,attempt_count integer default 0,
 source_duration_seconds numeric default 30,dispatch_batch_id uuid,pipeline_version integer default 2,
 source_range_selection_enabled boolean default false,range_end_seconds numeric,range_start_seconds numeric,
 project_dispatch_generation integer default 0, dispatch_priority_class text, created_at timestamptz default now(),
 user_id uuid,mvp_session_id uuid,ingestion_route_wait_started_at timestamptz,heartbeat_at timestamptz
);
create table shorts_mvp.ingestion_route_slots(
 route_id text primary key,egress_class text default 'webshare_isp',enabled boolean default true,
 leased_job_id uuid references shorts_mvp.video_jobs(id),lease_expires_at timestamptz,
 cooldown_until timestamptz,last_job_id uuid,last_result text,last_leased_at timestamptz,
 last_released_at timestamptz,updated_at timestamptz,quality_reset_at timestamptz
);
create table shorts_mvp.runtime_feature_flags(flag_key text primary key,enabled boolean);
create function shorts_mvp.ingestion_route_quality(text) returns table(quality_tier integer) language sql as 'select 0';
create table shorts_mvp.project_job_outbox(id uuid primary key,job_id uuid,status text,available_at timestamptz default now(),created_at timestamptz default now(),dispatched_at timestamptz,last_error text);
create table shorts_mvp.job_outbox(id uuid primary key,job_id uuid,status text,available_at timestamptz default now(),created_at timestamptz default now(),dispatch_batch_id uuid,dispatched_at timestamptz);
create table shorts_mvp.dispatch_batches(id uuid primary key,kind text,item_count integer);
create table shorts_mvp.dispatch_batch_items(dispatch_batch_id uuid,array_index integer,job_id uuid);
create table shorts_mvp.user_subscriptions(user_id uuid,status text,billing_cycle text,current_period_start timestamptz,current_period_end timestamptz);
