# Unfinished checkout plan switching — 2026-09-26

## Problem and fix

Closing Paddle's checkout overlay leaves its unpaid transaction open. Previously, selecting another plan returned CHECKOUT_PENDING and required a separate discard action. Now a different plan/currency selection checks the previous transaction and confirms cancellation before reserving and creating its replacement, under the existing per-user database lock. The same plan/currency still resumes its transaction.

Only draft/ready transactions may be canceled; an already canceled transaction may be released. Paid, billed, completed and past-due transactions remain blocked. Unknown creation outcomes, unavailable provider state, failed cancellation and identity mismatches never create a replacement. No subscription, refund or charge behavior was changed. Processing errors now have specific English/Japanese copy.

Official provider behavior: https://developer.paddle.com/api-reference/transactions/update-transaction/

## Scope and validation

- Actual promoted baseline confirmed: `0c15742ef14e70544e0b82234b386088f17799a0`, deployment `dpl_Ctns7j7f2gjt4bwkkfwj5sBrQ3Wc`, production project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`.
- Worktree `.tmp/paddle-production-20260926`, branch `codex/paddle-production-20260926`. Three source/test files changed; no DB migration, environment, lab or worker changes.
- 40 tests passed across service SQL integration, migration, API checkout/webhook and signature suites, including nine new cases for switching and payment safety. Targeted ESLint and optimized Next build/type checking passed.
- Actual browser regression against the optimized changed source: `http://127.0.0.1:3424/jp/pricing`, isolated local PostgreSQL `paddle_fullapp_local` / local GoTrue; real Paddle sandbox Vendor 123613. No production DB or live Paddle keys loaded into the test server.
- A new disposable local fixture user opened Creator (JPY 1,790), closed the overlay, selected Lite, and saw the Lite (JPY 590) Paddle Test Mode overlay without a discard step.
- Read-only sandbox API + local DB verification: previous Creator `txn_01m3e8av5fhvcf7agvrayyhybb` canceled in both systems; new Lite `txn_01m3e8bm74j9rceprywbwyqqhr` local ready / provider draft, amount 590 JPY. No usage grants and no payment attempts. Evidence captured at 2026-09-26T07:03:00Z.
- Live card approval/refund remains a user-performed check. This regression opens and switches unpaid checkout only.

## Production release

- Candidate source `a1dccbf43a6061bce6fcd208b84e3527e01123a3`, deployment `dpl_BiCXrJUEwEUtzE7hznczzG2wiBv3`, `shorts-867clf5rx-artiroom.vercel.app`; initially READY with no aliases. Existing deployment protection remained enabled.
- Current baseline was unchanged immediately before promotion. Release guard passed; no route source files changed and protected route definitions remain present.
- Candidate public pages/prices, authentication behavior, all five job-admission targets and webhook signature probes passed. The nonexistent editor fixture returned 404; authenticated editor editing was not tested.
- Promoted this exact deployment without rebuilding. At 2026-09-26T07:07:22Z (16:07 KST), the production domain resolved to the candidate/source above and repeated public page/signature checks passed.
- No production DB migration/configuration/worker changes or actual payment/refund were performed for this fix. Existing unfinished live orders are reconciled only when their owner selects another plan.
- Sandbox cleanup: both test transactions confirmed canceled; zero usage grants. Closed the test tab and stopped the dedicated port 3424 process. Prior local resources were retained.
- Deployment/read-only evidence: [checkout-switch-verification-20260926.json](checkout-switch-verification-20260926.json). This report commit occurs after deployment and does not replace the deployed source.
