# English-region trending collection

Authorized production change: keep Korean collection every two hours; add US
and GB every four hours, seven categories, at most two pages each. Use the
existing YouTube project and videos.list only; never consume search.list quota.

Baseline: `688ddcf6b53c99b27a7aa4201a893fd55e4e6ac0`, confirmed against
Vercel deployment `dpl_GcqgqAMj8eFEg9XqSeG37w47h3eq` using raw deployment
metadata. Project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, team
`team_3pn55cGmUE8SRRKg0D3dRiPJ`. Database: production Supabase
`mvcprswvfybudtopepuj`, schema `shorts_mvp`. No AWS or lab changes.

The additive migration starts collection and reads OFF. Existing project/key
verification is retained; both the environment flag and DB switch are required.
The atomic Pacific-day quota retains KR 9,000 general / 3,000 background and
90 search, JP 17 general / 10 search; US and GB get 84 general each and no search.
The overall general cap is 9,185, below the existing verified 10,000 allocation.
Metadata retention remains 30 days. Request timeout, whole-batch deadline,
latest-slot claims and no automatic retries bound costs and duplicate work.

Use `YOUTUBE_EN_COLLECTION_ENABLED=true` and `YOUTUBE_EN_DISCOVERY_ENABLED=true`
on the candidate, then enable the corresponding DB switches after verification.
The scheduled path is `/api/cron/youtube-english`, `25 */4 * * *` UTC, i.e.
01:25, 05:25, 09:25, 13:25, 17:25 and 21:25 KST. An authenticated Vercel Run
collects only the current elapsed slot; it cannot replay historical slots.

Validation: real isolated PostgreSQL tests cover the complete existing discovery
suite plus English concurrency, 28-request batch limit, deduplication, language
and calendar filters, OFF switches, quota errors, and the full original KR/JP
allocations after US/GB exhaustion. Local PostgreSQL is stopped after tests.
Candidate deployment uses the server's existing production configuration; no
production credentials are downloaded. Compare deployed routes, verify public
and protected paths, then promote the same deployment without rebuilding.

Estimated incremental API use: at most 168 general units/day for new charts.
Initial collection is one bounded slot (at most 28 units); other tests use local
fixtures. Existing metered build/function/storage resources only, no fixed
recurring resource. The prior promoted deployment remains the rollback target.
To stop new work, set english_collection_enabled=false in the verified project's
quota row. To hide English-only regional data, set english_discovery_enabled=false
on this release. A rollback to the old application requires leaving new regional
data intact; the old JP-enabled reader is broader and may show those public items.
