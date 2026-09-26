# Overseas pricing follow-up and scheduled-change cancellation

## Scope and baseline

User authorized the additional pricing inspection fixes and production deployment.
Source baseline: promoted `9748986fffc408658d7c6f270d53421f632f1f94`, deployment
`dpl_DTULS9X5rwDpyXdKVWa46CCvBYnq`; verified again through the Vercel API.
Worktree `.tmp/paddle-production-20260926`, branch `codex/paddle-production-20260926`.
The subsequent baseline commit f0ad3dbf adds release documentation only.
No worker, YouTube publication, or lab configuration changes.

## Changes

- Actual savings against the corresponding 3-month monthly-equivalent price,
  separately calculated for USD and JPY and rounded down to one decimal. No invented
  list price and no catalog price changes. The comparison basis is visible.
- Preserve active 3/6/12-month terms, default new/monthly customers to six months;
  retain Starter-first mobile order, show scheduled plan and visible busy labels.
- Put the mobile language selector inside the existing header menu. Close the menu
  on language changes; avoid obscuring pricing CTAs. Keep standalone-page fallback.
- Explain why an existing subscription retains its original currency after changing
  language. Localize billing-management metadata and clarify monthly equivalent.
- Show approximate clip count with an explicit estimate note and existing paid
  trending-filter access. Do not advertise the Korean PDF: overseas product codes
  have no corresponding guidebook entitlement.
- Replace native confirm with an accessible modal dialog. Preserve immediate charge
  disclosure and the next-renewal/no-payment-today message for deferred changes.
- Cancel a deferred plan change, then permit a different choice. Durable cancellation
  intent, ownership/environment checks, user advisory locking, canonical provider
  checks, do_not_bill preview/update, and restoration of the original paid boundary.
  Reconciliation handles interrupted item/date writes. Existing renewal-window guard
  remains. Paid minutes are never modified by this cancellation operation.
- Add two nullable timestamps only on shorts_mvp.paddle_plan_changes. Existing
  production code remains compatible during migration and rollback.

## Verification

Local test configuration: PostgreSQL paddle_fullapp_local at 127.0.0.1:55449,
existing local Supabase Auth gateway, Paddle sandbox credentials and products only.
No lab or production customer data was copied into the test.

- Billing/API/price/legacy-layout regression selection: 79 passed, 3 opt-in skipped.
- Additional cancellation/renewal race check: service integration suite 52 passed
  (one additional test beyond the 79-test selection; 80 distinct ordinary tests).
- Cancellation tests include ownership denial, repeat calls, item response lost,
  date-update timeout, near-renewal refusal, and unchanged paid allowances.
- Actual browser sandbox flow: official test card checkout completed; local canonical
  transaction processor credited 60 minutes; scheduled Starter 6-month switch;
  canceled it through the new dialog. Canonical API verified original price and
  renewal date, one initial completed transaction and zero change transactions.
  Fixture sub_01m3evk1ghqazyw5zwmfktwe26 was canceled after verification.
- Inspected English 320px, Japanese 320px/390px, Japanese desktop; no horizontal
  overflow at 320px, all term buttons one line, floating language control hidden,
  header language menu worked, current-currency notice appeared on language switch,
  six/twelve-month discounts and opaque recommendation badges displayed correctly.
- Screenshots inspected in browser, including new dialog and busy confirmation state.

Local sandbox UI does not prove live-card settlement. No live payment, refund, or
customer subscription mutation was performed. Candidate checks and final promotion
are recorded in the follow-up release evidence.
