# ThePayOne upgrade refund separation

The previous Pro replacement flow reversed an approved package charge when the
old Pro refund failed. The replacement now activates and grants quota after the
new payment is verified, regardless of whether the old full refund is confirmed.
An unconfirmed refund is recorded in the existing upgrade refund ledger with
its amount, original transaction and sanitized failure reason.

Previously reviewed refunds are not sent again automatically. Operators check
the original PG transaction before refunding the remaining amount. The billing
dashboard lists these obligations and requires a refund or transfer reference
before recording completion. Completion and delayed PG notifications update
the old payment only; the new entitlement is preserved.

The original recurring Pro schedule is still paused. Schedule failures retain
the existing review handling. New payment failures and mismatched approvals do
not grant quota. A repeated successful request returns its committed order
before evaluating the upgraded subscription.

Toss routes, provider code, checkout and success UI are unchanged. There are no
worker, infrastructure, environment or schema changes. The scoped data migration
only closes three legacy ThePayOne orders with confirmed full reversals, the
specific original reversal error and zero usage grants. It preserves transaction
evidence and never attempts payment, refund or entitlement restoration.

Validation:

- Production baseline: 8f724fe2606db0cfb251d2812dd0f95cb917412a.
- Web suite: 313 files, 2,404 passed, 25 skipped. The optional local DB case was
  separately enabled and passed with the targeted suite (27 tests).
- Local PostgreSQL integration verified the atomic Starter 12-month upgrade,
  12,000-second monthly quota, reservation transfer, old schedule disposition,
  9,900 KRW deferred obligation and idempotent replay.
- Refund rejection, timeout, mismatched response, already reviewed source,
  payment rejection, transaction failure, late refund notification, duplicate
  completion and successful automatic refund are covered.
- Type checking and lint passed. Repository script tests: 204 passed.
- Local production-style build passed. Promotion additionally requires exact
  candidate route and runtime target checks against production.

Already reversed customer payments remain canceled. Customers must explicitly
make a new purchase; this release does not recharge anyone automatically.
