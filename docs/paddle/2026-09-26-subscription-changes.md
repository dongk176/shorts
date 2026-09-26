# Paddle subscription changes — 2026-09-26

Production baseline: `84fa90bc7636ae9fc9c7234a1bf26e5c9d9a95fd`, deployment
`dpl_FLwBj2t8w6maRWeeodVtd1Ts3Sis` (`shorts-5756cos5k-artiroom.vercel.app`).
Worktree: `.tmp/paddle-production-20260926`, branch `codex/paddle-production-20260926`.
No lab service, worker or publishing changes are included.

## Behavior

- EN/JP pricing keeps all plans visible for subscribers, marks the current plan,
  and offers changes. Six-month Starter remains the first mobile card.
- Subscription portal access is secondary on pricing and available under settings;
  cancellation and payment-method management remain accessible.
- Confirmation names the target plan. Deferred changes show the effective date and
  no charge/refund today; immediate upgrades disclose the prorated charge.
- Same-term higher-tier changes charge the stored payment method immediately.
  Only a canonical completed Paddle transaction grants incremental minutes.
  Already-used minutes and the paid term remain unchanged.
- Downgrades and billing-frequency changes keep current entitlements until the
  paid term ends. The next paid renewal starts the new entitlement.
- Changing page language never changes an existing subscription's currency.

## Provider behavior verified in sandbox

Paddle preview responses do not contain a subscription `id`. Upgrade transaction
items contain quantity +1 for the new price and -1 for the credited old price.
Their `items[].proration.billing_period` gives the incremental period; the outer
transaction billing period remains the original full term.

Paddle rejects some combined item/date requests and resets the billing date when
frequency changes. Deferred changes therefore use two `do_not_bill` writes:
change items, then separately restore the already-paid boundary after a date-only
preview. No payment/refund is requested by either write. A durable ledger retains
uncertain operations, and the authenticated five-minute cron reconciles at most
five deferred operations per invocation. Immediate charge requests are never
blindly retried. Uncertain immediate responses require canonical webhook delivery
or support investigation before another change can be attempted.

Provider docs:
- https://developer.paddle.com/api-reference/subscriptions/preview-subscription-update/
- https://developer.paddle.com/build/subscriptions/change-billing-dates/
- https://developer.paddle.com/build/subscriptions/replace-products-prices-upgrade-downgrade/

## Verification

- 65 focused automated checks: checkout ownership/CSRF, webhook validation,
  historical refunds, monthly package allowances, quote expiry/staleness/price
  increases, no duplicate dispatch, two-step date restoration and interrupted
  restoration recovery, authenticated change endpoint.
- Isolated local Postgres `127.0.0.1:55449/paddle_fullapp_local`, local auth,
  Paddle sandbox only. No production user/payment/subscription mutation.
- Browser/test-card checkout: Starter six months USD 71.94. Browser upgrade:
  Expert six months, USD 138.00 prorated test charge. Canonical transaction replay
  into the local webhook service produced 23,997 extra seconds in the current
  month and 24,000 per later month, preserving all six base allowances.
- Japanese browser downgrade confirmation: Expert six months → monthly Lite,
  effective 2027-03-26, no payment/refund today. Provider next billing date remains
  exactly 2027-03-26T08:12:14.316Z; local entitlement stays Expert until renewal.
- 390px mobile: Starter precedes Expert and monthly Pro. Settings shows current
  plan, scheduled plan/date, portal access and comparison link.
- Sandbox webhooks were not externally routed to the local server. Canonical
  sandbox transactions were fetched and passed to the actual event processor;
  this is not a claim of end-to-end public webhook delivery or live-card testing.
- Opt-in fixture helper: `RUN_PADDLE_CHANGE_SANDBOX=sync` and
  `PADDLE_CHANGE_CLEANUP=1` for the named isolated sandbox fixture only.

## Release dependencies

Apply additive migration `202609260030_paddle_plan_changes.sql` to the verified
production database before deploying this candidate. It adds the change ledger,
immutable allowance snapshots and purchased plan snapshots, preserving old data.
The current production code remains compatible with these additions.

The existing LIVE `EasyCut billing server` API key needs only `Subscriptions: Write`
added to its current permissions. Browser policy requires confirmation immediately
before this security-sensitive permission expansion. No key rotation, price-write,
refund-write or customer-data permission expansion is needed.

Deploy a clean committed candidate without aliases, verify protected routes,
localization, unauthenticated change/cron rejection, webhook signatures and job
admission identity, then promote that exact deployment. Never test against a live
customer subscription. Rollback web code to the previous deployment; keep the
additive schema and review any already-pending changes before rollback.

## Released

- Source: `fdf863344b2a4e0e58fb26cf3d783206fe3c571f`.
- Deployment: `dpl_CSVczptRgPHCh3pS6DWfPiawwnFj`,
  `shorts-ihbm6stvj-artiroom.vercel.app`.
- User confirmed LIVE subscription-write access at action time. Only that checkbox
  changed; the existing key remained active, changing from 3 read / 2 write to
  3 read / 3 write permissions. No credentials were rotated.
- Additive production migration applied with the fixed database fingerprint and
  public-schema unchanged verification.
- Candidate and promoted production checks passed on 2026-09-26, including 401 for
  anonymous changes/cron, 403 for cross-origin changes, signed/unsigned/expired
  webhook probes, EN/JP prices, protected paths and candidate job admission.
- Authenticated production Japanese pricing displays the user's existing monthly
  plan and selectable packages; no real subscription change or payment was made.
- Sandbox fixture was canceled after verification. Local test server stopped.
