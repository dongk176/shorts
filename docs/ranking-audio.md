# Ranking sound transitions and optional background music

Implemented locally on `codex/ranking-sfx-20261024`, from the observed promoted
production commit `70537d24601d9ef462a2ae8cd3c52bca8dcdeb17` (deployment
`dpl_7oYkEAsnHMtr81HAunnwP4ixujf8`). No remote mutations in this change.

- Optional single `transitionSound` per render: kick, lip-bass, whoosh, scratch.
  Both audio controls default off. There are N−1 transitions for N populated
  ranks, respecting custom playback order, with no intro/outro transition.
- User-supplied four MP3 files are preserved in `web/public/audio/ranking`.
  Black 720×1280 H.264/AAC segments are bundled in both web and worker assets.
  They use the decoded audio length rounded up to one 30fps frame; the shared
  manifest supplies the exact timeline duration. No title/rank overlay on black.
- Optional background music: one uploaded file, 30MB maximum, 0.5–1200 seconds.
  Existing signed receiver and administrator/project ownership checks are reused.
  `kind: audio` metadata selects bounded audio probing/normalization; only the
  first 180 seconds are kept in task-local storage. It is never uploaded to S3.
  Short music loops; volume defaults to 15%, with a short end fade and output
  limiter. Original clip sound and transition effects remain audible.
- Music and effects are independent. No database migration or ordinary-user
  job change. Render validation includes transitions in the 180-second limit.
- Production rollout must coordinate the ranking worker and web candidate:
  deploy the compatible worker first, verify idle/in-flight work before changing
  its service revision, then test/promote the exact web candidate. An old worker
  cannot import audio sources and does not implement these new render settings.
  This local implementation is not a production deployment.

## Verification

Local PostgreSQL 16 disposable `ranking_test` (not Supabase/production), existing
restricted ranking DB role; API admission tests validate size/kind/ownership and
persist one sound and music settings. Restricted worker tests cover audio import,
render, output-only S3 adapter and completion email outbox. No actual cloud email
was sent in these tests.

Real FFmpeg synthetic tests verify all four sounds, custom sparse rank order,
full-frame black intervals, total duration, no extra gaps when off, and original
and background frequencies in the output. Existing renderer integration tests
remain intact. Browser fixture uses real UI/preview components with stubbed APIs;
verified collapsed controls, custom single-select, switches, seek into black
transition, and full playback completion. Web build/lint/typecheck pass.

## 2026-10-25 brisk transitions (version 2)

New editor submissions include `transitionVersion: 2`. Version 2 uses immutable
`*-v2.mp4` assets, identical in browser and bundled worker: kick 23 frames,
lip-bass 26 frames, whoosh 6 frames, scratch 22 frames (30fps). Leading and trailing
silence is removed; lip-bass fades over its last 140ms. The original MP3/MP4 files
are retained. Jobs from already-open older editors omit the version and retain
original audio assets and durations, including when a newer sandbox renders them.
Preview keeps the next effect/scene buffered so switching sources does not wait
for another initial media request. Actual output uses the same versioned segments.
