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

## Activation and release — completed

- The user approved the at-action webhook confirmation with “ㄱㄱ”. Saved `EasyCut production billing`, API version 1, Platform usage, Active, at `https://www.easycut.co.kr/api/paddle/webhook`, with exactly the 11 handled transaction/subscription/adjustment events.
- Stored the signing secret locally in the release worktree's Git-ignored `.secrets/paddle-webhook-secret.txt` (0600; parent 0700), then registered it as a Vercel production sensitive value. The one-use loopback receiver was stopped. No secret was printed or committed.
- All 11 Paddle production variables are present: live environment, API key, checkout token, six price IDs, webhook secret and `PADDLE_ENABLED=true`. No sandbox credentials were used.
- Saved and reloaded the Paddle default payment link `https://www.easycut.co.kr/billing/paddle`; dashboard displayed its success check.
- Clean source **`0c15742ef14e70544e0b82234b386088f17799a0`** was deployed with `--prod --skip-domain` to **`dpl_Ctns7j7f2gjt4bwkkfwj5sBrQ3Wc`**, `https://shorts-b27fmnleh-artiroom.vercel.app`. Vercel build reached READY, initially with no aliases.
- Existing candidate deployment protection remained enabled. HTTP checks used the existing project automation-bypass credential without exposing it or changing access settings. Browser checks used the existing signed-in Vercel session.
- Immediately before promotion, the actual production baseline was still `dpl_8241YpSbQiNaFDcg5tbeAB6UXPJb` / `3a60f90a6b70088485a49e2ca56dad0d339882cd`.
- Promoted that exact deployment without rebuilding, explicitly scoped to the verified `artiroom` team. The first CLI attempt without an explicit team failed before promotion; selected team and candidate identity were verified and no other project was changed.
- At **2026-09-26 06:50 UTC (15:50 KST)**, the production domain resolved to the same READY candidate ID/source. Final HTTP evidence is in [production-verification-20260926.json](production-verification-20260926.json).

## Verification and limits

- Candidate and production: `/`, `/guidebook`, `/pricing`, `/en/pricing`, `/jp/pricing` returned 200. Admin returned its authentication redirect (307). The deliberately nonexistent editor project returned 404; this is not an authenticated editor workflow test. Independently compared route manifests prove both protected route definitions remain present and no baseline route disappeared.
- Candidate job-admission preflight returned ready, all five registered targets and the expected registry fingerprint. No worker job was started and AWS was not modified.
- English prices: $3.99/$11.99/$34.99; Japanese prices: ¥590/¥1,790/¥4,990. Actual candidate browser screens showed correct languages, monthly terms and source-minute allocations. Korean browser screen retained ₩9,900 monthly and existing package terms/prices.
- Candidate and production webhook probes: unsigned 401, expired signature 401, valid signature with unsupported `verification.probe` event 200/ignored. The ignored event is rejected from business processing before database writes. These are signature/configuration probes, **not a Paddle-delivered payment event**.
- Anonymous checkout creation returned 401 before transaction creation.
- Production browser confirmed the existing DongK domestic plan remains on domestic pricing even on `/en/pricing`; foreign checkout testing requires an account without a pending/active/past-due domestic plan (and not an enterprise account). No existing plan was changed.
- **No live payment, refund, paid subscription mutation or payout was performed.** The user will perform the live card/refund check. Production payment approval, production time grants, actual live event delivery and refunds remain unverified until that check.
- Earlier sandbox lifecycle evidence is historical and used the previous Lite prices. The new approved prices were checked against the catalog and rendered pages; no new-price live card transaction was performed.
- This report update is documentation-only after promotion; the deployed source remains `0c15742e`, not the later documentation commit. Server key expiry remains 2026-12-25.

Rollback: re-promote the verified baseline deployment if candidate checks fail. Do not drop the additive Paddle tables or overwrite historical payment data; disable new Paddle checkout if a problem is found after customers begin using it.
