# Approved overseas repricing — 2026-09-26

Source: `codex/paddle-integration-20260926`, base `d8eca7db93ddfd4eb06151f45840de96e48f433a` plus this change. No production deployment or production database mutation.

| Plan | Minutes/month | USD/month | JPY/month |
| --- | ---: | ---: | ---: |
| Lite | 60 | 3.99 | 590 |
| Creator | 200 | 11.99 | 1,790 |
| Pro | 600 | 34.99 | 4,990 |

Monthly billing, tax-inclusive, quantity one, no trial. Korean catalog, allowances, concurrency and retention are unchanged.

## Provider verification

- Live Vendor 427481: edited the six existing prices in the dashboard and read back each saved product row. Product IDs matched `live-catalog.json`. Observed dashboard active subscribers and paid transactions were zero before editing. No customer subscription or payment action was performed.
- Sandbox Vendor 123613: official price API PATCH followed by GET for all six existing IDs; verified product, currency, amount, active status, monthly interval, included tax, quantity one and no trial.
- Price IDs remain unchanged. Public IDs and amounts are recorded in the two catalog files; sanitized evidence is in `repricing-verification-20260926.json`.

## Local verification

- 33 tests passed across service, migration, signature, checkout/webhook routes and subscription routing. Fixture amounts now match the new Lite USD/JPY prices, including refund and tax cases.
- 12 localized first-render tests passed. Targeted ESLint passed.
- Optimized Next build passed, including type checking. The existing optional `canvas` dependency warning remains.
- Chrome verified `/en/pricing` displays $3.99/$11.99/$34.99 and 60/200/600 minutes; `/jp/pricing` displays ￥590/￥1,790/￥4,990 and the same minutes, with Japanese tax-inclusive monthly text.
- Port 3423 is a display-only local preview of the optimized build. It uses the existing isolated local database/auth configuration and sandbox price IDs. API key, client checkout token and webhook secret are removed from its process environment, so it is not a payment-test endpoint. The standard port 3422 preview retains `PADDLE_ENABLED=false`.

No new card checkout was completed during repricing. The prior actual sandbox checkout, signed webhook, allowance grant, cancellation and refund results in `fullapp-verification-20260926.md` used the old $9.90/¥1,480 prices and remain historical evidence, not a claim of a new-price end-to-end payment. The temporary public webhook destination remains inactive.
