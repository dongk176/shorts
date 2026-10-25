# Ranking scene selection and Instagram portrait fix

Target: production read-only diagnosis and isolated local implementation/verification.
Worktree: `.tmp/ranking-workspace-20261025`; branch `codex/ranking-scene-dialog-20261025`.
Baseline: promoted web commit `8f67201c1af150c60190c9287312ea4417c331ac`, deployment `dpl_DHvr3ZGcE7nBWwRSKzFbLMTYR2zB`; www alias confirmed unchanged October 25.
AWS identity `181651591905`; ranking revision 7, image `sha256:f2e75efb48570583902007dccec16ee89dcc7df8fc2c517432bbaeaf843c0b15`. Service already running; no capacity, configuration, schema or production mutations. Supabase `mvcprswvfybudtopepuj`, `shorts_mvp` operation records read only. No lab dependency.

## Changes
- Cards: existing project collection breakpoints, 1088px collection width, compact title/status/date, overflow menu.
- Desktop scene dialog/mobile bottom sheet with fixed Done/Next-rank footer; inputs/trims remain draft state.
- Removed decorative TikTok iframe so blocked HTML cannot appear inside composition. Local media and YouTube covers retained; unavailable covers use neutral placeholder.
- Instagram queues one preview instead of metadata then preview, using existing worker contract and validation.
- Downloader permits bounded portrait 720x1280/1080x1920 formats. Instagram reuses validated metadata via temporary load-info-json, deleted in finally. Public-access validation, size/time bounds, original cleanup, YouTube routing and ordinary worker paths preserved.

## Verification
- User URL https://www.instagram.com/reel/DZJ9ag9SNRI/: production inspect 48.373505s success; preview 8.373291s failure, October 25 04:02 UTC.
- Reproduced old selector failure: Requested format is not available. Available known-resolution formats were 720x1280/1080x1920, excluded by old height<=1080 requirement.
- Modified actual RankingPipeline.import_source succeeded locally in 6.07s: 12.033333-second 720x1280 output with audio. Not an ECS latency guarantee.
- Worker pipeline/service tests passed (existing integration skips retained), including synthetic FFmpeg integration and real yt-dlp selector regression.
- Web targeted suite: 5 files, 49 tests passed; TypeScript passed.
- Browser fixture: uploaded file, 0.1–8 trim preserved after reopen and next-rank navigation; repaired Instagram media and timeline displayed; 390px sheet/CTA and compact card menu visually checked.
- Fixture project APIs are mocked, not cloud verification. Production rollout remains separate; no deployment performed for this revision.
