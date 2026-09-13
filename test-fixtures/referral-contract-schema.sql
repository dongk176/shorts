drop schema if exists shorts_mvp cascade;
      create schema shorts_mvp;
      do $$ begin
        if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
        if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
        if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
      end $$;
      create function shorts_mvp.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
      create table shorts_mvp.app_users(id uuid primary key default gen_random_uuid(),email text,created_at timestamptz default now());
      create table shorts_mvp.admin_audit_logs(id uuid primary key default gen_random_uuid(),entity_id text,action text,metadata jsonb default '{}',created_at timestamptz default now());
      create table shorts_mvp.billing_toss_checkout_intents(id uuid primary key default gen_random_uuid(),subscription_id uuid,target_plan_code text,purpose text,status text,created_at timestamptz default now());
      create table shorts_mvp.plans(code text primary key,prepaid_months integer);
      insert into shorts_mvp.plans values('monthly',1),('package',3),('toss_starter_1m',1),('toss_starter_3m',3),('toss_starter_6m',6),('toss_starter_12m',12),('toss_easycut_pro_1m',1);
      create table shorts_mvp.billing_orders(id uuid primary key default gen_random_uuid(),user_id uuid references shorts_mvp.app_users(id),
        amount_krw integer not null,refunded_amount_krw integer not null default 0,status text not null,
        approved_at timestamptz,product_code text,billing_cycle text,provider text,kind text,subscription_id uuid,order_id text);
