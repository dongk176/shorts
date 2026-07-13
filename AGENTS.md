# Shorts Maker repository guide

## Layout

- `web/`: Next.js App Router, TypeScript, Tailwind CSS, server-only Supabase SQL,
  AWS Batch submission, and CloudFront Signed URLs. Keep the product single-page.
- `worker/`: AWS Batch CLI worker with yt-dlp, Pillow, OpenAI SDK, and FFmpeg.
- `supabase/`: schema-qualified `shorts_mvp` migrations; never alter `public`.
- `infra/aws/`: AWS CDK v2 stacks and maintenance Lambda code.

## Safety invariants

- Accept only the supported YouTube hostnames and never bypass authentication,
  age, DRM, or private-video restrictions. (Bot check download restrictions may be retried up to 10 times).
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
