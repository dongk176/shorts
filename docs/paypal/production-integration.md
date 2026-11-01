# PayPal international subscriptions

English and Japanese pricing keep the existing PricingPageShell/TossPricingClient new-customer UI, including its consent dialog.
Only customers without prior Paddle/Toss/ThePayOne payment history use the USD PayPal catalog
when PAYPAL_ENABLED=true. Canceled, expired and refunded historical payments still exclude them.
The same history guard runs inside the checkout transaction, including resumed checkouts.
PayPal customers keep PayPal after their own payments. Korean new customers retain the existing
Toss cohort assignment and runtime rollout controls. Guests are reclassified after login.
Japanese prices also use USD. Korean pricing and existing Paddle subscriptions keep their providers.
Production baseline for this release: 93bd096473bff545b39e8c8f7ad1da05f51d63e5.

Pro: USD 12/month, 60 source minutes/month, 1 concurrent job.
Starter: USD 87/3 months, 144/6 months, 228/12 months; 200 minutes/month, 2 jobs.
Expert: USD 207/3 months, 354/6 months, 588/12 months; 600 minutes/month, 3 jobs.
All packages renew at the selected interval. Each monthly allowance has its own expiry.

Only verified PayPal transaction history can grant allowance. Browser redirects and ACTIVE
subscription status alone do not grant access. custom_id binds a subscription to the authenticated
checkout owner. Plan IDs, live/sandbox environment, currency, amount and plan overrides are checked.
Webhook signatures are verified through PayPal's verification endpoint. Deliveries and sales are
idempotent. Refunds/reversals reduce or revoke linked grants; already consumed/reserved balances
remain valid. Cancellation stops renewal and preserves paid access to expiry.

Apply supabase/migrations/20261101070715_paypal_billing.sql to shorts_mvp before enabling.
All six PayPal tables deny public/anon/authenticated access, with RLS enabled. No public schema changes.
Configure existing merchant Live app with Subscriptions and https://www.easycut.co.kr/api/paypal/webhook.
Select BILLING.SUBSCRIPTION.* lifecycle/payment failure events and PAYMENT.SALE.COMPLETED,
PAYMENT.SALE.REFUNDED, PAYMENT.SALE.REVERSED, PAYMENT.SALE.DENIED.
Use production-only secret environment variables from .env.example. Never commit credential values.

The existing billing cron reconciles up to 10 nonterminal PayPal checkouts/subscriptions per run.
Uncertain provider responses fail closed and retain a checkout for support review; do not create
another payable subscription until the existing one is resolved. Pending and active PayPal records
block domestic checkout and account withdrawal to prevent duplicate payments/orphaned contracts.
Support should inspect PayPal's canonical subscription and sale history before resolving uncertainty.
Existing direct PayPal links without an EasyCut custom_id cannot automatically grant access.

Local verification: PGlite SQL integration tests plus existing withdrawal/renewal tests (21 tests),
TypeScript/ESLint and Next.js build. These use mocked provider responses and no real charge.
A live paid checkout and webhook delivery require a real buyer approval; a successful build or
plan lookup does not prove receipt of an actual payment. Preserve this distinction in release notes.
