begin;

create table if not exists shorts_mvp.customer_inquiries (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  mvp_session_id uuid references shorts_mvp.mvp_sessions(id) on delete set null,
  user_id uuid references shorts_mvp.app_users(id) on delete set null,
  category text not null check (category in (
    'service_usage',
    'billing_refund',
    'technical_issue',
    'other'
  )),
  status text not null default 'new' check (status in (
    'new',
    'in_progress',
    'waiting_on_customer',
    'resolved',
    'closed'
  )),
  contact_email text not null check (
    char_length(contact_email) between 3 and 320
  ),
  message text not null check (
    char_length(message) between 10 and 2000
  ),
  locale text not null default 'ko' check (locale in ('ko','en','ja')),
  page_path text check (
    page_path is null or (
      char_length(page_path) between 1 and 2048
      and page_path like '/%'
    )
  ),
  user_agent text check (
    user_agent is null or char_length(user_agent) between 1 and 512
  ),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status in ('resolved','closed') and resolved_at is not null)
    or (status not in ('resolved','closed') and resolved_at is null)
  )
);

create index if not exists customer_inquiries_queue_idx
  on shorts_mvp.customer_inquiries (status,created_at)
  where status in ('new','in_progress','waiting_on_customer');
create index if not exists customer_inquiries_category_created_idx
  on shorts_mvp.customer_inquiries (category,created_at desc);
create index if not exists customer_inquiries_user_created_idx
  on shorts_mvp.customer_inquiries (user_id,created_at desc)
  where user_id is not null;
create index if not exists customer_inquiries_session_created_idx
  on shorts_mvp.customer_inquiries (mvp_session_id,created_at desc)
  where mvp_session_id is not null;

drop trigger if exists customer_inquiries_set_updated_at
  on shorts_mvp.customer_inquiries;
create trigger customer_inquiries_set_updated_at
before update on shorts_mvp.customer_inquiries
for each row execute function shorts_mvp.set_updated_at();

alter table shorts_mvp.customer_inquiries enable row level security;
revoke all on table shorts_mvp.customer_inquiries from anon, authenticated;
grant all on table shorts_mvp.customer_inquiries to service_role;
grant usage, select on all sequences in schema shorts_mvp to service_role;

comment on table shorts_mvp.customer_inquiries is
  'Customer support inquiries submitted from the Easy Cut support widget. Intended for a future admin queue.';
comment on column shorts_mvp.customer_inquiries.category is
  'Stable admin filter: service usage, billing/refund, technical issue, or other.';
comment on column shorts_mvp.customer_inquiries.status is
  'Future admin workflow status. New submissions always start as new.';
comment on column shorts_mvp.customer_inquiries.request_id is
  'Client-generated idempotency key reused when a submission is retried.';

commit;
