# Popular list performance change — 2026-10-10

- Authorized scope: remove displayed totals and per-request total/period aggregates; speed up existing popular browsing. Preserve filters, paid access, frozen pagination, availability checks and publishing maintenance gates.
- Verified production baseline: b4be19600dd2a936237527e5bce473c7001dba60 / dpl_BrTteHf9mfm3GJSEktdbLsEEr6Ve (shorts-9ork334ad-artiroom.vercel.app), resolved from www.easycut.co.kr.
- Workspace: popular-fast-list/shorts-clean; branch codex/popular-fast-list-20261010.
- Target: existing production Vercel prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw / Artiroom. Supabase mvcprswvfybudtopepuj / shorts_mvp verified by connector; catalog reads confirmed by live API. No schema, worker or environment changes. Lab is not used or treated as production-equivalent.
- Bounded ordinary test estimate: one local DB container, one local build, one candidate cloud build, fewer than 30 public read requests and cleanup; expected incremental cloud cost below US$2. No new recurring resources.

## Implementation

Remove count UI in all locales and count aggregates in catalog and fallback readers. Catalog pages slice 192 frozen IDs before live eligibility checks, then fill up to 49 visible records across additional batches when needed. Return 48 records and derive next cursor from the original ordinal. Array cardinality is a cheap internal scan bound only; no live catalog count is computed. Frozen list construction and safety checks are retained.

The legacy all-period fallback now uses its existing snapshot-only query on the first page as well as later pages, avoiding history solely for period counts.

## Verification

- Existing production exact UI query (periodBasis=collected): 48 cards, total 22,582; 3.648 / 2.217 / 3.509 seconds across three requests.
- Isolated PostgreSQL 16 container on localhost:55439, synthetic data only. Production is PostgreSQL 17; candidate will additionally be checked on its actual runtime.
- Discovery/search integration: 78 passed, 1 optional large search benchmark skipped. Includes 50,000-row catalog test, private/expired metadata filtering, period/language scopes, old cursors and new cross-batch pagination regressions for views/trending/reusable.
- Targeted API, UI, fallback and visibility tests: 96 passed; new no-count React pagination test added and UI suite 30 passed.
- Production release guard suite: 8 passed.
- Web lint and typecheck passed; production build passed (pre-existing optional canvas resolution warning).
- 268 built app routes each mapped to an actual current-production deployment output. Candidate deployment output comparison and protected path checks remain required before promotion.

## Remaining runtime checks

Deploy a clean committed candidate without assigning domains. Compare deployed output paths, verify /, /guidebook, /pricing, administrator page, editor route and popular page, check no-count API and access gates, then promote that exact deployment after successful checks. Capture runtime results separately without changing the tested source.
