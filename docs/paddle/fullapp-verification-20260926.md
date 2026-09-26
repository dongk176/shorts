# Actual local application checkout verification — 2026-09-26

## Scope and source

- Isolated worktree `.tmp/paddle-integration-20260926`, branch `codex/paddle-integration-20260926`.
- Initial tested production build: commit `083186cf88968b37d6823678d271d319589e2aff`.
- Successful full-app payments: `62fef9ba` plus the usage-balance refresh fix in this commit, served in Next development mode.
- The same final source passed `npm run build`. The optimized local bundle on port 3422 was checked in Chrome for English/Japanese subscription state, scheduled cancellation and the balance. The payment/card-entry flow ran against development mode, not the optimized bundle.
- No production deployment, cloud DB mutation, live charge, refund, or new paid resource.
- The earlier production baseline record is historical; refresh the promoted commit and release configuration before any release. This is local verification, not verification of the current production deployment.

## Real local services

- Actual Next application: `http://127.0.0.1:3420/en/pricing` and `http://localhost:3420/jp/pricing`.
- Dedicated PostgreSQL 16: container `easycut-paddle-fullapp-db-20260926`, loopback `55449`, database `paddle_fullapp_local`, application schema `shorts_mvp`.
- Dedicated Supabase GoTrue `v2.196.0`: container `easycut-paddle-fullapp-auth-20260926`, loopback `55450`, Auth path gateway `localhost:55451`.
- No fake auth/session bypass. Two synthetic managed personal users sign in through the existing password form and real GoTrue. Social Google/Kakao OAuth is not covered.
- 185 repository migrations through `202609170010_admin_expenses.sql`, plus `202609260010_paddle_billing.sql`, applied locally (186 total). Historical fresh-seed sort-order collision repaired only in the disposable catalog fixture. Later unrelated TikTok/Meta/reviewer/search/YouTube migrations were not applied; no rollout guard was weakened. This fixture does not establish production schema parity.
- Sandbox vendor `123613` / artiroom only. Sandbox credentials loaded from the protected local file; live credentials not used.
- Runtime scripts, passwords, DB data, auth keys and logs are ignored in `.tmp/paddle-fullapp/`. Never commit or print them.

## Verified browser and HTTP behavior

- English real pricing → login form → actual local authentication → onboarding → real Paddle checkout. Existing onboarding navigated away to home; this was found in the actual flow and fixed.
- Japanese fresh-user login and three-step onboarding verified after the fix: `/jp/pricing` stays open and the user can proceed directly to checkout.
- Chrome English checkout: `test mode`, English, Lite, tax-inclusive total USD 9.90; United States ZIP 10001 selected, card-entry page reached.
- Chrome Japanese checkout: `test mode`, Japanese, Lite, total JPY 1,480, Japanese product description.
- Both transactions were created by the actual app's authenticated checkout API, not the earlier standalone harness:
  - USD: `txn_01m3e1nr3zcyyxx5mxwyz9m8ve`
  - JPY: `txn_01m3e22bmycxaysjz09bjqt571`
- Both completed through the actual app in Chrome with sandbox cards. USD used the normal success card; JPY completed the simulated 3D Secure challenge. No real-money charge.
- Paddle delivered real signed `subscription.created`, `subscription.activated`, and `transaction.completed` notifications through the approved temporary endpoint. All returned HTTP 200. Each local user received exactly one active 3,600-second grant.
- USD initially showed a stale navigation balance after fulfillment. The pricing component now refreshes the shared usage state before displaying the ready message. JPY then displayed `残り60分` and `処理時間が反映されました。` without reload.
- Both app management buttons opened the real sandbox customer portal in the correct language and currency. Both subscriptions were canceled through the portal for their current period end (2026-10-26). Actual `subscription.updated` deliveries set local `cancel_at_period_end=true` while keeping 60 minutes available.
- Replayed JPY notification `ntf_01m3e363p31fh4vgzhk7ea8vpe` through the Paddle dashboard: the same event `evt_01m3e363d0h1y0strw4pp308cr` arrived twice with HTTP 200, was stored once, and still produced only one grant.
- Anonymous state GET and checkout POST: 401. Cross-origin checkout POST: 403.
- A loopback forwarding proxy admits only POST `/api/paddle/webhook` with a Paddle signature, preserves raw bytes, limits payloads to 1 MiB and forwards to the actual Next webhook route. Public root returned 404; unsigned webhook returned 401. The app, DB and auth server are not exposed.
- The Codex in-app browser created the English checkout iframe but did not visibly render its contents. Chrome displayed the same transaction correctly. In-app rendering issue remains unresolved; do not claim cross-browser coverage.

## Changes and validation

- Keep `/pricing` and `/billing/paddle` (including existing query string) open after first-time onboarding; existing redirect behavior elsewhere is preserved.
- Remove misleading Korean-won starting-price copy from English/Japanese homepage CTA. Local pricing pages remain the authoritative country-currency prices; Korean copy unchanged.
- Targeted ESLint and TypeScript passed.
- 52 tests passed across 8 files: localized first render, Paddle migration/service/signature/checkout/webhook, subscription routing and onboarding endpoint.
- Optimized Next production build passed; no deployment took place. Protected main/guidebook/pricing/admin/editor route entries remain in its manifest; no content-calendar or publishing API route was found. Anonymous HTTP main/guidebook/pricing/en/jp returned 200, admin returned its protected 404. Authenticated admin/editor workflow was not tested.
- Renewal allowance, failed-payment, stale-event and partial/tax-only refund behavior are covered by automated service tests. An actual future monthly automatic charge was not observed.

## Refund verification and cleanup

- Full sandbox refunds requested only for the two transactions above: `adj_01m3e3cdna6w2raey48tmrg5rp` (USD) and `adj_01m3e3ceh986kvh8ye4r0jxaat` (JPY).
- Actual `adjustment.created` notifications returned 200. While refunds were `pending_approval`, both 3,600-second grants remained active. Both refunds became `approved` and actual `adjustment.updated` deliveries returned HTTP 200 at 05:40 UTC. Both grants became `revoked`; the existing positive-total ledger constraint retains 1 bookkeeping second, but spendable balance is zero. The optimized English/Japanese UI confirmed `0 min remaining` / `残り0分` after reload.
- This uses Paddle's real sandbox adjustment workflow, not synthetic webhook envelopes. Sandbox approval is periodic: https://developer.paddle.com/api-reference/adjustments/create-adjustment/.

- Cleanup: the temporary sandbox notification destination was deactivated and the dashboard showed `Inactive`. Its ngrok tunnel and loopback webhook proxy were stopped. The optimized local preview on port 3422/auth/DB remain available for review. The development server was stopped and preview restarted with `PADDLE_ENABLED=false`; new test payments require explicitly re-establishing the test webhook before enabling checkout.

## Remaining release boundaries

- No production webhook, environment variables, migration, deployment, actual charge/refund or payout was performed.
- Refresh the currently promoted production baseline and verify production schema compatibility before preparing the release candidate. Local test configuration is not proof of production readiness.
- Production still needs its own valid HTTPS default payment link, live signing secret/destination and deployment configuration. Sandbox's earlier default link was normalized to `https://127.0.0.1:3419/`; that direct payment-link/resumption path is not validated. The verified flow opens the overlay with an authenticated transaction ID.
- Google/Kakao social login, actual future automatic monthly renewal, real card/settlement behavior and the Codex in-app browser checkout remain outside this verification.
