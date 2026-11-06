# Ranking proxy registry recovery

Production baseline: `aa83f99e4b31bb75e85ec616a369a150a75b76db`, promoted deployment
`dpl_Enwp7t8K2uZj8CVEsP4eJPyLHkdw`. Isolated branch
`codex/ranking-proxy-recovery-20261106`; production Vercel `artiroom/shorts`,
Supabase `mvcprswvfybudtopepuj` / `shorts_mvp`, AWS `181651591905` / Seoul.
This change uses no lab services and introduces no schema migration or recurring capacity.

## Cause and evidence

The October 25 provisioning copied AWS `INGESTION_PROXY_ROUTES_JSON` to Vercel
`RANKING_PROXY_ROUTES_JSON`. Provider replacement history confirms all twenty routes changed
after provisioning, but the Vercel variable was never updated. The final ranking route success
was November 1 04:36 UTC, immediately before remaining original endpoints were replaced.
The same production dependency snapshot with two current AWS routes successfully retrieved
public-video metadata and 4096-byte media ranges (HTTP 206). Those diagnostic sandboxes stopped.
The Vercel Secret cannot be read back; endpoint drift is established through the provisioning
script, unchanged environment metadata, and provider replacement chains rather than secret readback.

## Change

The existing ranking capacity Lambda adds an IAM-only `proxy_registry` read action. It reads
AWSCURRENT from the existing canonical production runtime secret and returns only validated
ISP route fields and version. This branch never instantiates ECS/ELB/DynamoDB clients or changes
capacity. Its role receives GetSecretValue on that exact existing secret only. Existing capacity
actions, configuration, concurrency and sweeper behavior remain unchanged.

Every ranking lease and retry resolves current routes through that action. There is no stale
environment fallback or cache. The existing DB admission, maximum three ranking leases,
per-IP exclusion, and longform capacity reservation remain intact. Each child operation records
route ID, registry version and a short endpoint fingerprint, never credentials or raw addresses.

Download diagnostics separate proxy authentication, DNS, TLS, refusal/reset and timeout. Proxy
authentication configuration failures stop without ten retries; eligible transient failures retain
the ten-attempt ceiling and restriction failures never rotate. The existing administrator monitor
adds a deduplicated incident when at least three operations make ten unsuccessful routing attempts
in fifteen minutes with no success. Inactivity alone never announces recovery.

YouTube remains an embedded player before render submission. Sources and full originals remain
ephemeral; no source is copied to S3. Existing successful-input reuse and fixed-credit settlement
are preserved. No automatic customer resubmission or customer email is added.

## Release procedure

1. Run focused registry/lease/monitor tests, Python Lambda tests and worker restriction/FFmpeg
   integration tests, then existing lint, type/build, script and infrastructure checks.
2. Verify canonical and actual longform runtime proxy maps agree, deployed Lambda index matches
   baseline, and account/role/function identity is exact. Commit a clean candidate tree.
3. Apply only the Lambda's additive read policy, merged environment key and reviewed code archive;
   preserve the registered configuration and code for rollback. No ECS wake or full stack deploy.
4. Stage the committed web candidate without aliases using production configuration. Verify
   protected route manifests, authentication boundaries and real YouTube render/download from
   this candidate, plus Instagram/TikTok regressions and fixed-credit handling where feasible.
5. Recheck promoted production baseline before promotion; incorporate intervening releases if
   necessary and verify again. Promote that exact verified deployment without rebuilding it.
6. Remove temporary authentication callbacks and diagnostic resources. The old Vercel copied
   variable is ignored by new code; do not restore it as a runtime fallback.

Rollback: restore the prior web deployment while leaving the compatible Lambda read action in
place, or restore its recorded code/config and remove only the added IAM policy if necessary.
Do not replace the canonical registry or roll back any independent IP replacements.

Bounded ordinary test estimate: under USD 5 for a few ephemeral workspaces and short renders,
each at most 12 minutes with explicit stop/cleanup. No new fixed commitment.

## Local verification before release

- Focused web registry/lease/retry/monitor suite: 37 passed.
- Lambda registry tests: 7 passed; ranking CDK tests: 3 passed.
- Full web suite: 4289 passed, 182 skipped, one existing pricing expectation failure.
  `seo-followup.test.ts` still expects USD 12 after the promoted price rollback to USD 3.99.
  The same failure was reproduced directly in the unchanged `aa83f99e` worktree. No pricing
  implementation or expectation is altered by this recovery.
- Whole `make verify` encounters three existing UP017 lint warnings in the baseline silence
  submitter and its test; byte-identical baseline files reproduce them. Changed Python files
  and the entire worker pass lint from the worker's configured directory. Web lint/typecheck pass.
- Script tests: 215 passed. Infrastructure tests: 39 passed; production synth passes.
- Production web build passes. All 312 app route entries match baseline, including home,
  guidebook, pricing, `/admin/easycutcutcutcutcutcut` and the project editor route.
- Focused ranking worker tests retain real synthetic FFmpeg/ffprobe rendering checks.
  Full worker regression results and actual candidate verification are recorded after completion.
