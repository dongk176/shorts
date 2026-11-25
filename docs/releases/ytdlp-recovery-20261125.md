# YouTube extraction recovery — 2026-11-25

Target: explicitly authorized production worker update after verification.
Web release baseline: `0ac4a03e914109e8e7f853b6e66500ef9c6b979d`.
Worktree: `.tmp/ytdlp-update-20261125`, branch `codex/ytdlp-update-20261125`.
Production AWS: `181651591905`, Seoul. Existing production database and
customer project bindings remain unchanged during component tests.

## Evidence and scope

The production worker uses yt-dlp 2026.7.4. On the authorized source
`YxtZmF516EY`, it returns `Requested format is not available`, even though
the per-video PO provider registers and retrieves its attestation. The same
image, route and video with yt-dlp 2026.11.23 passes a 10-second 1080p
video/audio probe. These are component tests, not project E2E evidence.

- Old test: `3e6dd069-11af-44e3-a1e3-7718416fcb60`, exit 1.
- New test: `18e7ba39-e86c-440b-a46c-dffcf8757a9a`, exit 0.
- Four-minute download/transcription/render test:
  `b4da265f-752e-403e-ad2b-f9fe7f39cd0c`, passed: download 22.64 seconds,
  OpenAI transcription 39 segments, 1080x1920 audio/video render and full decode,
  temporary-file cleanup; total 35.23 seconds.

Verbose proxy configuration was also misclassified as a connection failure.
The classifier now requires actual connection-error markers; regression
tests distinguish format errors from proxy authentication/connection errors.
Previously reviewed sanitized error logging and terminal restriction priority
in the promoted web source's ingestion module are included.

## Exact runtime composition

The web source contains unrelated worker changes that are not deployed in the
generation runtime. Do not build that entire worker directory for this repair.
The normal successor also changes the stable editor. Retaining the old
generation renderer would undo the live editing-only recovery. Therefore
`Dockerfile.ytdlp-hotfix` derives from the currently used, verified production
editing image (release `f48a9a2b-17bc-4db7-af99-f49cfb14edb6`):

`shorts-mvp-editor-releases-production@sha256:b2391bed81ca493e2a99db8c1798aaae2400ce7fc4fd7e7475786a2c5300c4d2`

Its application baseline is `43fd759084b49f1bbc13aff609332b646fb7f534`.
Only yt-dlp/default dependencies, the reviewed ingestion module and the build
identity marker change. Renderers, fonts, entrypoint, model prompts and tools
are inherited. The new source marker identifies this explicit assembly recipe;
it does not assert that all files under the web worktree's worker directory
were copied. The normal Dockerfile/requirements are also pinned for future
builds, but the recovery workflow uses the hotfix Dockerfile explicitly.

This is a material configuration difference from the successful component
tests on the old generation image `38dd00e4...`. The exact final image must
pass the registrar and real generation/edit checks. Its existing generation
recovery changes have not yet been promoted; the source diff and canary must
be reviewed before promotion. The old component success alone cannot approve it.

Japanese/English generation has a separate image and registry. It must be
checked and upgraded separately; a Korean worker test cannot attest that image.

## Release gates

Keep the existing protected exact-tag build, security scan, runtime ingestion
tests, font checks, isolated registrar probe, browser parity and finalization.
Renew only the existing exact-ref controls to
`editor-v4-render-parity-20261125-1`; do not move an existing tag or relax trust.
The successor procedure must retain old target definitions for existing jobs.
The live editing-only successor must remain compatible and unchanged.

Ordinary generation is intentionally paused only at creation until 14:00 KST.
Do not rely on that pause as indefinite permission for a blocking successor
transition. Verify the actual admission state and finish or safely roll back
any transition before ordinary generation resumes.

The four-minute component test uses one 8-vCPU task, one attempt, a 20-minute
hard timeout and temporary files only. Estimated upper bound below USD 2;
no recurring resources are created. It explicitly uses the ordinary OpenAI
transcription policy, never the ElevenLabs fallback policy.

Status: source prepared; production worker promotion not yet performed.
