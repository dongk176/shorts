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
  identity, cookie, token, proxy, IP, region, or client rotation. Bot challenges
  and 429s may be retried up to 10 times.
- Never pass YouTube account credentials, account cookies, or browser profiles to workers.
- Never invoke user-derived commands with a shell. Pass argument arrays to
  subprocesses and keep timeouts enabled.
- Resolve served paths beneath `storage/`; never use user input as a filename.
- Never log secrets. Missing configured AI provider credentials must take the
  deterministic fallback path.
- Preserve the 60-minute input limit, one-job-at-a-time default, and 30-day cap.
- Never store full source videos in S3; use task ephemeral storage and `finally` cleanup.

## Verification

- `make lint` runs backend and frontend static checks.
- `make verify` runs worker tests, frontend checks/build, and CDK tests/synth.
- Renderer changes must retain the synthetic FFmpeg/ffprobe integration test.

## Production deployment safety

- Use the currently promoted production commit as the only release baseline.
  Never deploy from an older branch, an unrelated worktree, or a worktree with
  uncommitted files.
- Production web releases must run through `pnpm release:production`. Do not
  invoke `vercel deploy`, `vercel --prod`, or `vercel promote` directly.
- A release candidate must be exactly one committed and pushed release commit
  ahead of the currently promoted production commit. Finish the intended edit,
  tests, commit, and push before running the release command.
- Preserve every production file, page, API, feature, and UI that is outside the
  release commit. Never restore an older implementation or silently omit a
  production change while preparing a focused fix.
- Treat any source change after candidate verification as a new candidate. The
  prior build and its verification are invalid once the Git SHA changes.
- Before promotion, compare the candidate route manifest with production and
  stop if any existing page or API disappears. Smoke-test the home, guidebook,
  pricing, projects, admin, editor, billing pages, and representative APIs.
- Deploy to an unaliased candidate URL first, verify it, then promote that exact
  Vercel deployment ID without rebuilding it. Stop if production changes while
  the candidate is being verified or if the promoted deployment ID differs.
- Keep database migrations, AWS infrastructure, and worker images out of the web
  release command. Apply each through its dedicated, separately reviewed
  procedure.
- Keep the unfinished YouTube publishing/content-calendar experiment out of
  production releases. Production candidates must not contain the
  `/content-calendar` route, publishing OAuth/publication APIs, publishing
  navigation or share UI, test publishing migrations, `EasyCutYoutubeTest-*`
  infrastructure, or the YouTube uploader worker.
