# Popular catalog text search

## Source and target

Authorized production search implementation, starting in isolated worktree
`.tmp/popular-search-20260923`, branch `codex/popular-search-20260923`.
The promoted baseline was read from Vercel, not inferred from a local branch:
`9baf6bec29465625ff09293b11b68a7a75da70ff`, deployment
`dpl_CWuWwXGXTYiVMPfYXUBZLBYBmrcp`. A second read on 2026-09-23 still returned that deployment.
Production Vercel project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, Supabase
`mvcprswvfybudtopepuj`, schema `shorts_mvp`. Lab is not used.
Existing-service local tests and one bounded candidate build; no new fixed-cost
service or DB plan upgrade. Database fingerprint and Vercel project link verified.

The live schema differs from the older plan: the current production code reads
`youtube_catalog`, which already deduplicates videos and enforces metadata expiry,
unavailability and region activation. Search and four GIN expression indexes use
that canonical table, instead of resurrecting the two retired snapshot read paths.
Read-only preflight: 68,114 rows, 65,530 public/non-expired metadata rows,
catalog including indexes 99,721,216 bytes, database 4,360,432,787 bytes.
`pg_trgm` was absent. These are used-byte measurements, not proof of the plan's
remaining disk/memory capacity; actual index size and latency must be checked at rollout.

## Behavior

One inline field, submit/Enter, clear, existing filters/cards/load more. Same
server and UI entitlement as detailed filters. Korean/English/Japanese copy;
composition Enter does not submit. No autocomplete, history, tag UI or new page.
Search ignores the hidden ranking's restrictions, carries an explicit CC filter,
and restores the prior ranking when cleared. Cancellation prevents stale fetches
and load-more responses from replacing the active search.

Title/channel NFKC, lowercase, whitespace and compact matching. All query groups
are required; the initial aliases are AI, ChatGPT and Elon Musk in Korean/English.
Word similarity >= 0.3 is allowed for 3+ letter/number words, within a transaction.
Punctuation is searched literally; fuzzy matching does not erase `%`, `_` or other
punctuation. Exact/phrase/all-group/fuzzy tiers precede score, views, published time
and video ID. Current canonical metadata determines title, license and availability.

Existing list-version storage freezes only matching IDs/order and collection
context for 15 minutes, keyed by normalized query and filters. No replicated video
metadata or new synchronization job. Result count is the frozen count and excludes
later additions. Every page rechecks current metadata/safety; removed videos may
reduce visible results. Search omits dynamic period counts and keeps the period
selector. Small ID slices prevent scanning the whole result set on every page.

## Verification

Isolated Docker PostgreSQL 16 (production is 17.6), local database
`youtube_search_test`, port 55587, no production credentials or copied video data.
Integration suite applies the actual migrations and covers spelling, aliases,
all-word matching, literal wildcards, CC/current title changes, visibility/expiry,
region and duration restrictions, pagination, changed/expired cursors, tie breaks,
removed-page batches and transaction setting isolation.

70,000 synthetic rows, GIN pending lists cleaned before measurement. The real
PostgreSQL plan used all four trigram indexes for the selective typo predicate.
Observed service-call milliseconds (one fresh + five repeated requests):

| Query | Fresh | Repeated range |
| --- | ---: | ---: |
| 축구 (2 chars) | 943 | 20–33 |
| 여행 (very common) | 1,633 | 30–69 |
| 손흥밍 (typo) | 329 | 23–40 |
| 테스트채널 (all rows) | 2,772 | 16–41 |
| 없는검색어 | 25 | 17–28 |

These are local DB/service measurements, not production HTTP p95. The first broad
search can take seconds. The target is repeated API p95 below one second; verify
candidate HTTP timing separately, including entitlement and network overhead.

Mounted React tests cover explicit submission, IME, entitlement, cancellation,
empty/error distinction, clearing and localized fields. Browser verification used
the actual component with fixture responses at desktop and 390px mobile: Enter,
ranking suppression, no rank badges, CC carry-over, empty results and clearing.
Fixture thumbnails were placeholders; this is not authenticated candidate evidence.

Full-check housekeeping: the historical editor CSS hash expected `51d911f` bytes.
The promoted baseline has only seven additional scoped full-frame showcase lines
from `bf137f86` (documented in `docs/localized-showcase-20260920.md`). The digest
assertion is pinned to the actual promoted bytes; neither CSS nor editor behavior
was changed by this work. The same stale assertion was already recorded in
`docs/reviews/editor-caption-repair-2026-09-21/RELEASE.md`.

## Rollout and rollback

1. Complete repository checks and commit the isolated source; recheck promoted baseline.
2. Apply only `202609230001_popular_text_search.sql` and
   `202609230002_popular_text_search_indexes.sql` with the production identity guard.
   Extension installation resolves its schema; existing `public` objects are untouched.
   Indexes build concurrently. Confirm all four indexes are valid and measure size.
3. Build an unaliased production candidate with `YOUTUBE_POPULAR_SEARCH_ENABLED=true`.
   Existing deployments remain unchanged until promotion. Verify actual candidate
   authentication/search, protected routes, route-manifest parity and admission probe.
4. Promote that exact deployment without rebuilding. Verify production search.

The flag defaults off in `.env.example`; catalog reads/discovery must also be enabled.
Rollback by restoring the previous deployment or deploying with the search flag off.
The additive indexes/functions can remain; do not remove them while requests use them.
No worker, provider, scheduler or publishing entitlement is changed.

Local final checks: `make verify` passed, including static checks, 209 repository
script tests, worker suite, 3,028 web tests (139 conditional skips), 36 CDK tests,
Next production build and production-context CDK synthesis. PostgreSQL-enabled
focused run: 58 passed, one opt-in benchmark skipped (benchmark passed separately).
Actual promoted deployment outputs reconstruct 230 application routes; local
candidate has the same 230 routes, including all protected paths.
