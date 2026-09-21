-- Dedicated YouTube reviewer release. Apply only after the fixed production
-- database fingerprint, explicit release setting and zero prior tables are checked.
do $$ begin
  if current_setting('app.youtube_review_release',true) is distinct from '20260922' then
    raise exception 'YouTube review release setting is required';
  end if;
end $$;


create table shorts_mvp.youtube_account_owners (
  user_id uuid primary key references shorts_mvp.app_users(id) on delete cascade,
  epoch integer not null default 0
);
create table shorts_mvp.youtube_account_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  channel_id varchar(64) not null,
  channel_title varchar(255) not null,
  token_ciphertext text,
  scopes text[] not null default '{}',
  status text not null check (status in ('active','disconnected','reconnect_required')),
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  unique(user_id,channel_id),
  check ((status='disconnected' and token_ciphertext is null) or (status<>'disconnected' and token_ciphertext is not null))
);
create table shorts_mvp.youtube_account_oauth (
  state_hash char(64) primary key,
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  session_hash char(64) not null,
  verifier_ciphertext text not null,
  return_path text not null check (return_path ~ '^/(settings|projects/[1-9][0-9]*)$'),
  short_id uuid references shorts_mvp.generated_shorts(id) on delete cascade,
  connection_id uuid references shorts_mvp.youtube_account_links(id) on delete cascade,
  epoch integer not null,
  expires_at timestamptz not null default now()+interval '10 minutes',
  unique(user_id)
);
create index youtube_account_oauth_expiry on shorts_mvp.youtube_account_oauth(expires_at);
create index youtube_account_links_user on shorts_mvp.youtube_account_links(user_id,updated_at desc);

alter table shorts_mvp.youtube_account_owners enable row level security;
alter table shorts_mvp.youtube_account_links enable row level security;
alter table shorts_mvp.youtube_account_oauth enable row level security;
revoke all on shorts_mvp.youtube_account_owners,shorts_mvp.youtube_account_links,shorts_mvp.youtube_account_oauth from public,anon,authenticated;
-- Server database role only. No browser/PostgREST read policies, including for ciphertext.
grant select,insert,update,delete on shorts_mvp.youtube_account_owners,shorts_mvp.youtube_account_links,shorts_mvp.youtube_account_oauth to service_role;


create table shorts_mvp.youtube_account_uploads (
 id uuid primary key,
 user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
 connection_id uuid not null references shorts_mvp.youtube_account_links(id),
 short_id uuid not null references shorts_mvp.generated_shorts(id),
 render_version integer not null,
 connection_version integer not null,
 title text not null,
 state_ciphertext text not null,
 status text not null check(status in ('queued','uploading','processing','complete','interrupted')),
 progress bigint not null default 0,
 video_id text,
 error_message text,
 lease_id uuid,
 lease_until timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,short_id,render_version,connection_id)
);
alter table shorts_mvp.youtube_account_uploads enable row level security;
revoke all on shorts_mvp.youtube_account_uploads from public,anon,authenticated;
grant select,insert,update,delete on shorts_mvp.youtube_account_uploads to service_role;


alter table shorts_mvp.youtube_account_oauth
  drop constraint youtube_account_oauth_return_path_check,
  add constraint youtube_account_oauth_return_path_check
    check (return_path ~ '^/(settings|publish/channels|projects/[1-9][0-9]*)$');


alter table shorts_mvp.youtube_account_owners
  add column disconnect_status text not null default 'none'
    check (disconnect_status in ('none','pending','revoked','manual_required')),
  add column disconnect_until timestamptz;


alter table shorts_mvp.youtube_account_uploads
  add column requested_privacy text not null default 'private' check (requested_privacy in ('private','unlisted','public')),
  add column actual_privacy text check (actual_privacy in ('private','unlisted','public')),
  add column privacy_checked_at timestamptz;
-- Historical records are deliberately left unverified until videos.list runs.



alter table shorts_mvp.youtube_account_links
  add column verified_at timestamptz,
  add column last_used_at timestamptz,
  add column next_check_at timestamptz;
-- Preserve the original observation time; migration is not a new API check.
update shorts_mvp.youtube_account_links set verified_at=updated_at,last_used_at=updated_at,next_check_at=updated_at+interval '1 day';
alter table shorts_mvp.youtube_account_links
  alter column verified_at set default now(), alter column verified_at set not null,
  alter column last_used_at set default now(), alter column last_used_at set not null,
  alter column next_check_at set default now()+interval '1 day', alter column next_check_at set not null;
create index youtube_account_links_check_due on shorts_mvp.youtube_account_links(next_check_at);

alter table shorts_mvp.youtube_account_uploads drop constraint youtube_account_uploads_status_check;
alter table shorts_mvp.youtube_account_uploads add constraint youtube_account_uploads_status_check
  check(status in ('queued','uploading','processing','complete','interrupted','expired'));
alter table shorts_mvp.youtube_account_uploads alter column requested_privacy drop not null;
create index youtube_account_uploads_retention on shorts_mvp.youtube_account_uploads(created_at) where status<>'expired';

-- Withdrawal retains app_users for separate legal records, so FK cascades alone
-- are insufficient. Also fence callbacks already exchanging a token.
create function shorts_mvp.youtube_purge_on_withdrawal() returns trigger
language plpgsql set search_path=pg_catalog,shorts_mvp as $$
begin
  if new.withdrawn_at is not null and old.withdrawn_at is null then
    update shorts_mvp.youtube_account_owners set epoch=epoch+1,disconnect_status='manual_required',disconnect_until=now()+interval '1 minute' where user_id=new.id;
    delete from shorts_mvp.youtube_account_oauth where user_id=new.id;
    delete from shorts_mvp.youtube_account_uploads where user_id=new.id;
    delete from shorts_mvp.youtube_account_links where user_id=new.id;
  end if;
  return new;
end $$;
create trigger youtube_account_withdrawal_cleanup after update of withdrawn_at on shorts_mvp.app_users
for each row execute function shorts_mvp.youtube_purge_on_withdrawal();
revoke all on function shorts_mvp.youtube_purge_on_withdrawal() from public,anon,authenticated;
