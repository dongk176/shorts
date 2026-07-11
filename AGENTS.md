# Shorts Maker repository guide

## Layout

- `web/`: Next.js App Router, TypeScript, Tailwind CSS. Keep the product as a
  single-page flow and use React state only.
- `api/`: FastAPI, SQLite, yt-dlp, Pillow, OpenAI SDK, and FFmpeg pipeline.
- `storage/`: generated MP4 outputs and the local SQLite database. Do not commit
  runtime contents.

## Safety invariants

- Accept only the supported YouTube hostnames and never bypass authentication,
  age, DRM, private-video, or download restrictions.
- Never invoke user-derived commands with a shell. Pass argument arrays to
  subprocesses and keep timeouts enabled.
- Resolve served paths beneath `storage/`; never use user input as a filename.
- Never log secrets. Missing configured AI provider credentials must take the
  deterministic fallback path.
- Preserve the 60-minute input limit and one-job-at-a-time default.

## Verification

- `make lint` runs backend and frontend static checks.
- `make test` runs pytest, frontend type checking/linting, and a production build.
- Renderer changes must retain the synthetic FFmpeg/ffprobe integration test.
