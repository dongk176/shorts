# Midform pause and resume — 2026-11-03 KST

User explicitly requested stopping today and resuming tomorrow, and asked for a
read-only check of ordinary customer service before stopping. Do not resume builds,
tests, deployments or the maintenance window until the user resumes work.

## Saved source

- Main worktree: `/Users/gimdongmin/shorts-clean/.tmp/admin-midform-production-20261103`
  branch `codex/admin-midform-production-20261103`; implementation/verification tag
  `editor-v4-render-parity-20261103-2` points to
  `0c1b4bc8bf16561a4b19ba8d6ffab7634fc1536e`. Pushed; exact tag protected by
  ruleset `26388897`. This tag has NOT been dispatched or authorized in AWS yet.
- Bounded upload worktree: `../admin-midform-upload-20261103`, branch
  `codex/admin-midform-upload-20261103`, source
  `6d58195dedd6a095707eaf2593d13dc0608ea633`; pushed immutable tag
  `editor-v4-render-parity-20261103-1`, ruleset `26388002`.
- Root and existing lab worktrees contain unrelated work. Preserve them.
- Local source originally based on promoted production
  `a2893f37fa1b96cc3883a170aa1fdd915edc133e`. Recheck the live alias before resuming.

## Actual production changes retained

- Additive `202611030001_admin_midform_projects.sql` applied to production
  `mvcprswvfybudtopepuj/shorts_mvp`.
- Two submitters updated by revision CAS, preserving ordinary routes and env:
  `shorts-mvp-batch-submitter-production` at 2026-11-02 18:11:19 UTC;
  `shorts-mvp-editor-batch-submitter-production` at 18:11:34 UTC.
- Guarded verifier renewal completed for upload tag **20261103-1** only. Its live
  fingerprint is `ed72e407a7edb58a530584eb63ff8e58bde9138baae08326d6507c9c470ee640`.
  Main local infrastructure now prepares tag **20261103-2**: this is deliberately
  different from the currently deployed verifier. Finish upload attestation before
  another guarded renewal. Never blindly deploy all infrastructure.
- Feature-OFF unaliased web candidate:
  `https://shorts-oheb8kbv8-artiroom.vercel.app`,
  `dpl_8traqRYCjXkuussMTcCiwpxFvEkE`, source `518c4640...`.
  Subsequent commits only update release guards, workflow and handoff records.
- No midform runtime registry rows, actual midform jobs, public feature enablement,
  upload successor fence, receiver switch, or web promotion has occurred.

## Stop verification

- GitHub run `41499731949` was cancelled at the user's request during image build;
  both build and verify/register jobs reached terminal `cancelled`. Check ECR on
  resume for a partially completed immutable image before rebuilding.
- Earlier run `41497021140` passed the full repository gate but failed configuration
  before image publication because the new tag was not protected. Exact protection
  was then added. The new run passed configuration and entered image build.
- No running jobs on `shorts-mvp-editor-test` at stop check.
- Upload ECS service remains `shorts-mvp-file-upload-production:14`, desired/running/
  pending all 0 (its prior on-demand idle state). No customer service was stopped.
- Current production alias still `dpl_Bb8c7zYnsvghXUfDXpMwe1g2A6DT`.

## Customer-service observations (approximately 03:34–03:38 KST)

- Home, guidebook, pricing, projects and editor route returned 200; anonymous admin
  navigation redirected to login. Production `/api/midform` returns 404.
- Job admission preflight returned ready=true, five targets, unchanged fingerprint
  `c485ae2b45ae841824247ec70de875adf9b84942a6b8035c3c9464b779bb6ef5`.
- Initial rolling 2-hour DB observation: 22 completed YouTube jobs, zero failed,
  two active with fresh heartbeats. One subsequently completed (30675: four ready
  clips out of five planned); 30676 continued downloading with a fresh heartbeat.
- 27 editor requests in that window succeeded, zero pending. One successful editor
  request was created after the submitter update and completed at 18:17:27 UTC.
- Project/editor Lambda errors: 0/0 over two hours (30/27 invocations). Editor had
  five throttles at 17:26 UTC, BEFORE this change; no pending editor work remained.
- File upload and public upload flags true, emergency stop false. All nine prior
  receiver check rows retained their original release and successor=NULL; no live
  capacity waiters. No new upload in last two hours, so a fresh upload was NOT tested.
- Last 24h uploads: six completed, three duration mismatches, one expired. All four
  exceptions occurred before this task's remote changes; their source cleanup is
  recorded. Do not call the historical failures successful uploads.
- IMPORTANT separate existing billing issue: Vercel CLI returned 50 error records
  from the current promoted deployment, 16:48–18:30 UTC: 21 PayPal reconciliation
  HTTP 500 records (`RESOURCE_NOT_FOUND`/`INVALID_RESOURCE_ID`) and 29 Paddle webhook
  HTTP 503 records covering 13 distinct events. This is a bounded log sample, not a
  complete error count. It predates this task's remote changes. Billing impact is
  unverified; do not claim the entire service is healthy. No billing changes made.
- Scoped generation API error log query returned zero records. MCP error clustering
  failed; authenticated CLI request logs were used instead.

## Resume order

1. Re-read execution boundaries and verify actual production alias/account/runtime.
   User already authorized ordinary test costs and a short upload maintenance window.
2. Resume upload tag -1 verification (same immutable source; check ECR first), obtain
   real fifteen isolated checks and versioned probe/customTemplateDesign attestation.
3. Guardedly renew verifier for tag -2, then run its safe workflow. Both workflows
   now use disposable network-none PostgreSQL, never shared lab DB credentials.
4. Register exact midform-only lane definitions/registries and pinned editor runtime
   from actual attestations. Existing language queue is shared with public language
   work and was already ENABLED: never disable it blindly.
5. Resolve candidate login callback before the maintenance window: Google login on
   the OFF candidate redirected to production home rather than its requested callback.
   Do not assume the candidate is authenticated; inspect exact callback allow-list.
6. Build final feature-ON unaliased candidate with independent verified link/upload
   release IDs. Follow file-upload-successor-runbook, actual nine checks, drain,
   ready, real link/upload creation, edit/reopen/export/download, nonadmin rejection.
7. Verify latest baseline and protected manifest; promote the exact tested candidate.
   Restore temporary capacity, record outcomes. No unperformed check may be passed.

## Evidence and reusable inputs

- `/private/tmp/easycut-midform-production-evidence-20261103/admin-midform-20261103/`
  holds test logs, old/new submitter archives, font manifest and test-plan.json.
- `/private/tmp/midform-renewal-execute.log` and
  `/private/tmp/midform-isolated-schema-check.log`: renewal and 122 passing actual
  network-none PostgreSQL successor tests. Latest release guards: 26 passed.
- `/private/tmp/midform-pause-public-routes.json`, `midform-pause-submitters.json`,
  `midform-pause-vercel-errors.jsonl`, `midform-pause-generation-errors.jsonl`.
- `/private/tmp/midform-language-definition-templates.json` (mode 0600): read-only
  snapshot of existing five exact language definitions, not registered candidates.
- Previously user-authorized BMW and podcast files are listed in
  `../midform-lab-20261015/test-platform/midform/evidence/review-manifest.json`.
- Prepared 1 GiB / 5 GiB upload fixtures in external evidence directory reuse the
  authorized BMW source plus valid MP4 free-atom padding. They test transferred byte
  limits/cleanup, NOT high-bitrate decode load. They have NOT been uploaded.
- Old local main image `easycut-midform-candidate:06b4ab64` predates workflow-only
  changes. Do not mislabel it as the tag -2 image. Upload CI must attest its exact tag.
- Both source worktrees are committed; this handoff is a separate documentation
  commit after tag -2. On resume preserve exact tagged build identity.
