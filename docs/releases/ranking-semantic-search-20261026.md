# Ranking semantic search release

Target: authorized production change, not lab. Baseline 80959293b51bb59082fd856270d3ce1592d5a97a,
confirmed promoted deployment dpl_95HU2CW8BKtEK6m147TusBanwAmr at task start.
Worktree .tmp/ranking-semantic-search-20261026, branch codex/ranking-semantic-search-20261026.
Includes previously verified popular-card selection UI commit b0a1a9bc.

Account configuration: production Vercel prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw,
Supabase mvcprswvfybudtopepuj / shorts_mvp. Existing AWS and ranking sandbox runtime unchanged.
No lab resources, new subscriptions, always-on resources or paid plan upgrades.

Scope: currently available public catalog entries with 1–180 second duration,
verified within 30 days. This is a **short-video candidate** filter, not a verified
YouTube Shorts/aspect-ratio classification. Initial count 68,761; data may change.
Only public title, channel and category are sent for embeddings; no videos,
account data, cookies, credentials or user-linked metadata.

Bounded usage plan: first 500 entries, then up to 75,000 entries with two batches
in flight, max 100 inputs per batch, 15s API timeout and 2h wall deadline. Expected
embedding API cost below USD 1 for short metadata; reserve an internal USD 3 estimate
for indexing, query checks, limited retries. Not a new user cost-approval gate.
768-dimensional vectors, brief fenced DB claims; no network calls inside DB transactions.
Record actual tokens/storage/latency and adjust bounds only as necessary.

Search API is administrator-only and same-origin POST. Existing public popular
search remains unchanged. Missing/failed AI credentials use deterministic keyword
fallback. Metadata invalidation removes derived vectors; search also enforces
availability and retention at query time. Secret keys stay server-only.

Verification plan: local disposable PostgreSQL with actual pgvector; concurrent
index claims and stale-response fencing; hybrid search, language/category/period
filters, cursor binding; denied ordinary users before DB/API work; actual candidate
browser search -> card actions -> selected rank -> range editing. Then bounded
simultaneous downloads/renders, YouTube failure/retry and draft retention. Physical
iOS Safari/Android Chrome tests require actual accessible devices and must not be
claimed from desktop emulation.

## Pre-candidate evidence

- Production migration applied once; pgvector 0.8.0 and existing public vector
  type reused. No public-schema DDL. RLS enabled and anon/authenticated denied.
- Backfill: 500 pilot + 68,292 remaining = 68,792 ready/current candidates,
  zero active leases at completion. 3,346,039 total indexing tokens; estimated
  embedding charge USD 0.066921. Remaining backfill completed in 559 seconds
  with two bounded concurrent batches. Total table/index storage 566 MB.
- Four live searches (funny dogs, goalkeeper mistakes, surprise endings,
  exact channel) returned related mode in 688–1,030 ms after limiting vector
  candidates before metadata joins. Title-only relevance remains approximate.
- Full frontend: 499 files / 3,910 tests passed, 181 skipped. Local pgvector:
  eight integration scenarios, plus API/provider/picker checks: 29 passed.
- Disposable PostgreSQL render preparation: ten-attempt success/failure,
  successful-source reuse: two passed. Route concurrency and capacity: 15 passed.
- Operator script suite: 215 passed. Infrastructure: 39 passed and production
  synth succeeded without deploying infrastructure.
- User explicitly approved production-only RANKING_EMBEDDING_API_KEY copied
  from existing local OpenAI key and RANKING_SEMANTIC_SEARCH_ENABLED=1.
  Existing general OpenAI variables were not overwritten.
- Search limits: 1,000 ANN candidates, 160 semantic matches, 100 lexical matches,
  48 results/page, 240 maximum, 2.5s semantic DB deadline, 6s provider deadline.
  Narrow filters can return fewer approximate matches; keyword fallback stays
  available when embeddings/index/provider are unavailable.
