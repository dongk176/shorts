# Shorts Maker repository guide

## Layout

- `web/`: Next.js App Router, TypeScript, Tailwind CSS, server-only Supabase SQL,
  AWS Batch submission, and CloudFront Signed URLs. Keep the product single-page.
- `worker/`: AWS Batch CLI worker with yt-dlp, Pillow, OpenAI SDK, and FFmpeg.
- `supabase/`: schema-qualified `shorts_mvp` migrations; never alter `public`.
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
- Treat the worker target values stored in the deployment platform as a
  release-critical interface. Repository files and a successful build are not
  proof that a candidate received the current production values.
- Before exercising a real job or promoting a production candidate, call the
  exact candidate's authenticated job-admission preflight endpoint and require
  all five worker targets to be ready. Its runtime fingerprint must exactly
  match the active production release registry in DB/AWS and the currently
  promoted deployment. A protection-page response or an unauthenticated 401 is
  not a successful check.
- If the candidate worker-target fingerprint is missing or different, stop the
  release. Do not enable an admin canary or change DB, AWS, or worker releases
  to accommodate stale web settings. With explicit authorization, reconcile
  only the deployment platform's saved target values from the active registry,
  create a new candidate, and repeat the runtime preflight. Never reuse a
  candidate built before the saved values were corrected.
- Run a real, rights-confirmed job-admission smoke test only after the runtime
  fingerprint check passes. Confirm that admission succeeds and that any
  fail-closed rejection occurs before usage is charged.
- After promotion, monitor job-admission responses as well as page health. Any
  unexpected `/api/jobs` 50x caused by release handoff requires immediate
  promotion of the last known-good deployment while the mismatch is diagnosed.
- Keep the unfinished YouTube publishing/content-calendar experiment out of
  production releases. Production candidates must not contain the
  `/content-calendar` route, publishing OAuth/publication APIs, publishing
  navigation or share UI, test publishing migrations, `EasyCutYoutubeTest-*`
  infrastructure, or the YouTube uploader worker.
