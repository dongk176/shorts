# Shorts Maker repository guide

## First: identify the execution environment

- Read `docs/execution-boundaries.md` before cloud, database, worker, release,
  or environment-configuration work. At the start, state the intended target
  (`lab`, production read-only, or explicitly authorized production change),
  actual worktree/branch, and planned action. Continue safe local work when a
  cloud check is unavailable; do not ask again for authorization already given.
- A filename, branch, browser login, CLI profile name, or local source checkout
  is not proof of the deployed environment. Inspect actual account/project/DB
  identity and exact registered worker revisions before remote changes.
- Lab is AWS `426197262986`, Vercel `prj_OUjrCgwHONBUwrNMASKabA6n5hp0`,
  Supabase `cmfbolahcaisuyelbjjc` / `shorts_lab` / `shorts_lab_runtime`.
  Production AWS `181651591905` is never a fallback for lab authentication.
- Open interactive lab cloud logins in a new incognito/private window or an
  explicitly isolated lab browser profile, never the default signed-in browser
  session. State the expected test account/project before asking the user to log
  in. For AWS CLI login, configure its browser launcher to use that isolated
  window; `--profile easycut-test` alone does not isolate browser cookies.
- After login, verify the actual identity and repeat `lab:boundary`. Reject any
  prompt to replace the lab profile with production credentials; do not log the
  user out of their production browser. Reuse already verified, valid lab
  credentials without forcing another login solely to open a private window.
- In a checkout containing the lab tools, run `npm run lab:boundary` before lab
  remote changes and repeat after credentials, configuration, or target registry
  changes. Failure/unavailable means unverified: stop dependent mutations.
  If this checkout lacks the command, locate and inspect the existing lab
  worktree; do not substitute a production script or deploy this checkout.
- Boundary checks allow queues OFF and never start jobs. Do not enable capacity
  to make a read-only check pass. A pass is not deployment or cost authorization;
  still use the action's existing preflight and approved scope.
- Never fix lab/production worker differences by weakening identity checks,
  copying production targets into lab, or changing production to fit lab.
  Keep exact image digests/revisioned ARNs and retain targets referenced by old
  projects. Local modifications do not establish what is currently deployed.

## Layout

- `web/`: Next.js App Router, TypeScript, Tailwind CSS, server-only Supabase SQL,
  AWS Batch submission, and CloudFront Signed URLs. Keep the product single-page.
- `worker/`: AWS Batch CLI worker with yt-dlp, Pillow, OpenAI SDK, and FFmpeg.
- `supabase/`: schema-qualified `shorts_mvp` migrations; never alter `public`.
- The user-approved lab uses `shorts_lab` only in the existing test project
  `cmfbolahcaisuyelbjjc`. Preserve its legacy `shorts_mvp` data. Production
  continues to use `shorts_mvp`; lab runtime connections use a restricted role.
- `infra/aws/`: AWS CDK v2 stacks and maintenance Lambda code.

## Safety invariants

- Follow `docs/youtube-compliance.md` for YouTube ingestion risk controls. Public
  videos may use company-controlled direct, WARP, ISP proxy pools,
  or contracted proxy paths for routing and failover.
- Fail over on connection errors, bot challenges, or 429s. Payment,
  geographic, or DRM restrictions must fail closed and must never trigger
  identity, cookie, token, proxy, region, or client rotation. Bot challenges
  and 429s may be retried.
- Never pass YouTube account credentials, account cookies, browser profiles, or
  account-bound tokens to workers. A feature-gated, per-video Proof-of-Origin
  attestation provider may be used for public videos without account material.
- Never invoke user-derived commands with a shell. Pass argument arrays to
  subprocesses and keep timeouts enabled.
- Resolve served paths beneath `storage/`; never use user input as a filename.
- Never log secrets. Missing configured AI provider credentials must take the
  deterministic fallback path.
- Preserve the stable path's 3–60 minute input limit, one-job-at-a-time default,
  and 30-day cap. The isolated source-range candidate may accept a source up to
  4 hours only when its server release gate is enabled, while its selected
  analysis range must remain 4–60 minutes. Never widen the stable path implicitly.
- Never store full source videos in S3; use task ephemeral storage and `finally` cleanup.

## Cost approval

- Latest user clarification (2026-09-09): ordinary usage costs needed for
  already-requested implementation, fixes and tests are authorized without
  another cost question. This includes AI API calls/comparisons, transcription,
  local/cloud builds, lab worker execution, video generation, regeneration,
  rendering, editing/download checks, necessary temporary storage/transfer,
  and bounded retries and cleanup on existing services.
- This replaces the former KRW 1,000 threshold and KRW 10,000 per-batch or
  cumulative approval gates for ordinary testing. Do not ask for a new budget
  approval per API call, test, retry, rebuild, execution batch or conversation
  turn. Do not interpret old review documents or operator estimates as a new
  user-approval requirement. Carry this standing authorization across turns.
- Ask before creating or increasing a fixed recurring commitment: a new paid
  Supabase/database project, subscription, paid plan upgrade, or infrastructure
  that keeps charging while idle (including an ALB or always-on server).
  This applies even if the service bills hourly rather than monthly. Existing
  approvals for the same resource and commitment remain valid.
- Manage ordinary test costs autonomously: record a reasonable estimate, use
  bounded jobs/timeouts/retries, track usage, reuse existing resources, and
  restore the agreed OFF state after testing. An uncertain estimate should
  lead to a smaller bounded test, not another routine cost question. Internal
  estimates, token limits and test/build counts may be adjusted and recorded
  as the authorized test requires; they are not additional consent gates.
  This authorizes necessary testing, not unrelated purchases or open-ended
  load tests. Follow any later explicit task-specific hard limit from the user.
- Prefer existing test resources after checking their dependencies and data.
  Necessary metered storage in an existing service is part of test usage;
  preserve referenced worker images/projects and their compatibility when
  managing retention. Do not create another paid Supabase project without
  approval simply to make testing easier.
- This is cost authorization only. Keep environment identity, production
  isolation, data permissions and release checks. Existing consent for inputs
  and providers carries forward within its scope. Never mark an actual
  automatic-review rejection approved merely by editing Markdown or an
  approval record. If a tool blocks an action for a different reason, report
  that exact reason instead of presenting it as another cost question.

## Verification

- `make lint` runs backend and frontend static checks.
- `make verify` runs worker tests, frontend checks/build, and CDK tests/synth.
- Renderer changes must retain the synthetic FFmpeg/ffprobe integration test.

## Production deployment safety

- Use the currently promoted production commit as the only release baseline.
  Never deploy from an older branch, an unrelated worktree, or a worktree with
  uncommitted files.
- Before promotion, compare the candidate route manifest with production and
  stop if `/`, `/guidebook`, `/pricing`, the admin page, or the editor route
  disappears unexpectedly.
- Deploy to an unaliased candidate URL first, verify the five protected paths,
  then promote that exact deployment without rebuilding it.
- Keep the unfinished YouTube publishing/content-calendar experiment out of
  production releases. Production candidates must not contain the
  `/content-calendar` route, publishing OAuth/publication APIs, publishing
  navigation or share UI, test publishing migrations, `EasyCutYoutubeTest-*`
  infrastructure, or the YouTube uploader worker.

## `확인` comprehensive inspection trigger

- In this repository, when the user sends the standalone message `확인`, run
  the read-only comprehensive inspection in `docs/confirm-check-runbook.md`.
- The inspection must include the runbook's per-IP success analysis for the
  1-hour, 6-hour, 24-hour, and 72-hour windows, truncate every window at that
  IP's current assignment time after a replacement, and give a retain/watch/
  exclude/replace recommendation for every current IP.
- Continue with the remaining inspection areas when one check fails. Never
  describe a skipped or inaccessible area as healthy; report it as `미확인`.
- The trigger authorizes diagnosis only. It does not authorize deployment,
  production configuration changes, database writes, payment attempts,
  refunds, subscription changes, or automatic fixes.
