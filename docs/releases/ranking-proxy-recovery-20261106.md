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
  The full worker suite completed without failure markers and with an empty failed-test cache.

## First verified promotion and saved-project recovery

Candidate `dpl_ARuNxfqX58yF2yn18r8ksUortWte` / source `b900c067` passed authenticated
home/guidebook/pricing/admin/existing-editor checks. The previously authorized DongK test
identity used a temporary API authentication session without email or callback configuration
changes; it was signed out locally afterward. Instagram and TikTok preparation succeeded.
Two YouTube children started together, used the current registry version, and succeeded after
one eligible bot-check failover. Four-rank rendering with lip-bass completed in 60 seconds.
The downloaded final MP4 is 720x1280 H.264/AAC, 10.621333 seconds. Contact-sheet inspection
confirms order, fixed rank colors, dimming and a full black transition. All leases were released
and the sandbox stopped. Current production's existing 180-second credit reservation was
consumed once; this recovery does not change the current billing policy.

That exact deployment was promoted to both production domains. Anonymous ranking APIs remain
401, the ranking page redirects to sign-in, and public pages respond normally. The obsolete
project-level `RANKING_PROXY_ROUTES_JSON` variable was removed; deployed code does not read it.

A follow-up preserves retryability of saved remote sources with failed acquisition status.
Only supported, registered remote URLs may be reacquired. Ownership, range limits, audio/file
validation and the worker's restriction gate remain intact. Failed uploaded files still require
re-upload. Focused saved-source/retry/registry/monitor tests: 61 passed. A controlled fixture
under the same test owner's newly created project is used for actual retry verification;
no customer jobs are automatically resubmitted.
