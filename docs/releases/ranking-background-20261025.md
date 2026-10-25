# Ranking background preparation and brisk transitions

Authorized production change; isolated worktree `.tmp/ranking-background-20261025`,
branch `codex/ranking-background-20261025`. Baseline: promoted commit
`eb1be8d67b2f59c78522aaa20b1726a4ad5c2ed5`, deployment
`dpl_EL7VtMUdyXKG1GbxdvfaP6Hzv8Mr`, verified via www.easycut.co.kr alias.

Target: existing artiroom/shorts Vercel project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`,
production Supabase `mvcprswvfybudtopepuj` / `shorts_mvp`. No lab, database migration,
AWS worker rollout, proxy routing change, or new recurring capacity is needed.
The existing Vercel sandbox dependency snapshot and source-bundle mechanism apply.
Admin/ownership/origin checks remain unchanged.

## Behavior

- Downloads use per-rank state instead of blocking the editor. One active source
  job and a client queue retain existing worker/IP admission bounds. Other ranks,
  labels and design remain editable. Duplicate per-rank submissions, count changes,
  resets and renders are blocked while sources are pending. Unmounted editors do
  not start queued jobs or apply downloaded results.
- Worker reports measured yt-dlp download percent; connection and conversion phases
  are indeterminate. Status is sanitized and returned during owner-authenticated
  polling without writing progress to the database. Failed ranks retain a retry.
- Completion toast links to the finished rank. Returning to a preparing rank keeps
  its progress visible. Leaving the page during preparation triggers the browser's
  unsaved-work warning; in-app navigation does not promise cross-page persistence.
- Desktop trims inline; mobile retains a native dialog bottom sheet with next-rank
  CTA. A page-scoped overflow fix restores sticky preview without changing other
  product pages. Preview has a bottom-centered circular play/pause control and
  Space support excluding form controls, native media and modal dialogs.
- Next scene/effect media is buffered. Versioned sound assets remove dead air and
  shorten lip-bass to 26/30s with 140ms fade. Existing browser submissions retain
  version 1 sound timing, protecting in-flight work during promotion.

## Verification plan and evidence

Local real-component fixture (mock operation responses, real H.264/AAC media):
background editing, queued second rank, returning to measured progress, inline
trim, sticky preview, Space pause/resume, buffered transition-to-next-source and
390px mobile bottom sheet verified through Chrome. This verifies UI behavior,
not cloud download reliability. Pure progress tests verify non-destructive reads
of subprocess output and sanitized public response. FFmpeg integration retains
sparse playback order, black-frame/color/BGM assertions; asset tests verify
browser/worker equality, sound onset under 20ms and trimmed/faded tail.

Run required local checks and compare candidate/production route manifests before
promoting the exact unaliased deployment. Candidate checks must include actual
social download/progress, preview/render, admin-only denial and the five protected
routes. Save exact deployment/commit and final results under local output evidence.
Bounded verification uses existing services, <=3 short source imports and a short
render per test, hard sandbox expiry/cleanup. Estimated ordinary metered usage
under $5; no fixed-cost resource changes.

Local gate results: script tests 215 passed; full worker suite completed successfully
(with its environment-gated skips). Latest ranking worker tests including FFmpeg:
48 passed. Web full suite: 3,888 passed / 170 skipped after limiting workers to 2;
unbounded run had six 5s timeouts under CPU contention. Infrastructure: 39 passed.
Production build and synth passed. All 285 app routes retained; none removed.
