begin;
set local lock_timeout='3s';
alter table shorts_mvp.paypal_checkouts
  add column if not exists last_lookup_at timestamptz,
  add column if not exists last_lookup_error_code text,
  add column if not exists last_lookup_debug_id text;
comment on column shorts_mvp.paypal_checkouts.last_lookup_at is 'Last attempted reconciliation, including provider lookup failures; not proof of payment status.';
commit;
