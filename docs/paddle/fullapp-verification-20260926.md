# Actual local application checkout verification — 2026-09-26

## Scope and source

- Isolated worktree `.tmp/paddle-integration-20260926`, branch `codex/paddle-integration-20260926`.
- Initial tested production build: commit `083186cf88968b37d6823678d271d319589e2aff`.
- Follow-up Japanese browser test: same source plus the onboarding return-path fix and localized homepage copy correction in this commit, served by Next development mode. These changes have not yet been tested in a rebuilt production bundle.
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
- Both remain `ready` / unpaid. No minutes granted, no webhook events processed. Do not describe this run as successful payment or fulfillment.
- Anonymous state GET and checkout POST: 401. Cross-origin checkout POST: 403.
- A loopback forwarding proxy admits only POST `/api/paddle/webhook` with a Paddle signature, preserves raw bytes, limits payloads to 1 MiB and forwards to the actual Next webhook route. Public root returned 404; unsigned webhook returned 401. The app, DB and auth server are not exposed.
- The Codex in-app browser created the English checkout iframe but did not visibly render its contents. Chrome displayed the same transaction correctly. In-app rendering issue remains unresolved; do not claim cross-browser coverage.

## Changes and validation

- Keep `/pricing` and `/billing/paddle` (including existing query string) open after first-time onboarding; existing redirect behavior elsewhere is preserved.
- Remove misleading Korean-won starting-price copy from English/Japanese homepage CTA. Local pricing pages remain the authoritative country-currency prices; Korean copy unchanged.
- Targeted ESLint and TypeScript passed.
- 49 tests passed: localized first render, Paddle service integration/signatures/checkout/webhook handlers, and onboarding endpoint.

## Pending, explicit boundary

A new sandbox notification destination is fully prepared in the dashboard with 11 events: transaction completed/canceled; subscription created/updated/activated/canceled/paused/resumed/past_due; adjustment created/updated. URL is the task's ngrok HTTPS endpoint at `/api/paddle/webhook`. Saving creates a signing key and a new event delivery path, so a browser confirmation was requested. It has not been saved and no signing key exists locally yet. The unused public tunnel was stopped while awaiting approval; restart and verify the exact URL before saving. Local app/auth/DB and the loopback-only proxy remain available for review.

After approval: save destination, securely store its signing secret, restart local app with it, complete both test-card payments through the actual app, verify real signed delivery → 60 minutes exactly once → visible updated balance, then verify cancellation/refund and retries. Disable the temporary sandbox destination and close the tunnel after testing. Do not substitute synthesized events for real delivery evidence.

Production webhook registration, deployment configuration, database migration/promotion, real-money testing and release remain outside this local verification.
