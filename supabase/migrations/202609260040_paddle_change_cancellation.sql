-- Durable, no-charge cancellation of a deferred plan change. Existing statuses remain compatible.
alter table shorts_mvp.paddle_plan_changes add column if not exists cancel_requested_at timestamptz;
alter table shorts_mvp.paddle_plan_changes add column if not exists canceled_at timestamptz;
