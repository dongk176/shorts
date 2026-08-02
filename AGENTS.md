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
- Before promotion, compare the candidate route manifest with production and
  stop if `/`, `/guidebook`, `/pricing`, the admin page, or the editor route
  disappears unexpectedly.
- Deploy to an unaliased candidate URL first, verify the five protected paths,
  then promote that exact deployment without rebuilding it.
