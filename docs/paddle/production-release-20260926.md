# Paddle production rollout — 2026-09-26

User authorized production rollout, excluding actual payments and refunds (user will perform those).

## Baseline and candidate

- Promoted baseline verified via Vercel: `dpl_8241YpSbQiNaFDcg5tbeAB6UXPJb`, source `3a60f90a6b70088485a49e2ca56dad0d339882cd`.
- Project: `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, team `team_3pn55cGmUE8SRRKg0D3dRiPJ`, root `web`, Node 24.x.
- Dedicated worktree `.tmp/paddle-production-20260926`, branch `codex/paddle-production-20260926`; fast-forward from the actual production baseline to tested Paddle source `4ca9da04`.
- No root checkout, lab, AWS worker, publishing feature or Korean catalog changes.
- Production source and candidate built independently. No baseline routes removed. The 11 additions are exactly Paddle APIs/pages and explicit English/Japanese pricing/subscription routes. Release guard permits only these additions and retains forbidden publishing routes and protected route checks.
- Candidate tests: 93 passed across 11 billing, account, locale and middleware test files; release guard 8 tests passed. Local optimized build/type check passed with the existing optional canvas warning.

## Production database

- Verified fixed production fingerprint and project-specific DB username before connecting. Preflight transaction was read-only, with 136 columns and 80 constraints observed. The 71 constraints represented in the existing local production fixture match exactly; its nine omitted external FKs are unchanged by this migration.
- Applied only `202609260010_paddle_billing.sql` through the guarded production migration runner. `public` objects unchanged.
- Verified five new tables enforce RLS and deny anon/authenticated SELECT; three Paddle plans retain 60/200/600 minutes, 1/2/3 jobs and 30-day retention. Their domestic catalog flag remains inactive.
- Existing NOT VALID boundaries retained their validation state. Three provider-overlap/withdrawal guards installed. No customer rows, charges or refunds were modified.

## Activation and release

- Registered the existing live environment, server API key, public checkout token and six price IDs (nine variables) as production-only Vercel sensitive values. No sandbox keys were used. `PADDLE_ENABLED` and `PADDLE_WEBHOOK_SECRET` have not been set.
- Saved and reloaded the Paddle default payment link `https://www.easycut.co.kr/billing/paddle`; dashboard displayed its success check.
- Prepared `EasyCut production billing` webhook form at `https://www.easycut.co.kr/api/paddle/webhook`, API version 1, Platform usage, exactly 11 events handled by the route. Saving creates a new verification secret, so the browser tool requires at-action confirmation. User confirmation was requested; destination remains unsaved pending that answer.
- Candidate deployment and promotion have NOT been performed. Existing production deployment remains current. No actual payment, refund or production subscription mutation was performed.
- Resume by saving the approved webhook, securely registering its secret and `PADDLE_ENABLED=true`, then deploy a clean source candidate using `--prod --skip-domain`. Verify protected paths, route/runtime identity, English/Japanese prices and signed/unsigned webhook validation without payment before promoting that exact candidate. Refresh the production baseline again before promotion.

Rollback: re-promote the verified baseline deployment if candidate checks fail. Do not drop the additive Paddle tables or overwrite historical payment data; disable new Paddle checkout if a problem is found after customers begin using it.
