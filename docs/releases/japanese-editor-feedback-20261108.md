# Japanese editor font and caption feedback — 2026-11-08

Production baseline: `162aa6612aa6103ea6b4384270d6ef3adfcc20f4`,
Vercel `dpl_Ew7PbJNtECmQJtmTF8cy1UQ9xpWH`.
Isolated branch/worktree: `codex/japanese-editor-feedback-20261108`,
`.tmp/japanese-editor-feedback-20261108`. User authorized fixing and deploying
these two feedback areas; billing and source-caption erasure are outside this change.

## Changes

- Retain a compatible Japanese title font choice through selection, draft
  restoration and render-spec compilation. The old function unconditionally
  returned Noto Sans JP for Japanese projects.
- Keep the Japanese title-font contract on legacy comment cards whose pinned
  worker uses it to select the comment font. No worker compatibility gate changes.
- Validate actual bundled font character coverage, not the Noto name. During
  browser-to-worker verification, `数` and `単` rendered as missing-glyph boxes
  with both Korean Noto faces, despite browser fallback displaying them.
  Selectors now exclude those faces for that text, and compatible workers
  normalize to Noto Sans JP. Server validation rejects unsupported glyphs in
  visible titles, channels, additional text and enabled subtitles, including
  characters absent from the Japanese face. Existing worker-manifest checks remain.
- Explain in Korean, English and Japanese that subtitle controls modify EasyCut
  captions and cannot remove text already burned into the source video. Also
  localize the unsupported-glyph error with a recovery action.
- Coverage data is reproducible with
  `worker/.venv/bin/python scripts/build-editor-cjk-font-coverage.py`.
  It is derived from identical bundled web/worker font bytes and hash-tested.

## Configuration and evidence

Production: Vercel `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, AWS
`181651591905` / `ap-northeast-2`, Supabase `mvcprswvfybudtopepuj` /
`shorts_mvp`. No lab or database changes. No worker or infrastructure deployment.
The actual AWS identity and exact registered stable and Japanese editor revisions
were verified read-only. Japanese worker source `8c1412a17187`, revision
`shorts-mvp-editor-release-language-test-8c1412a17187:1`, image digest
`3d9827a640b41061aaca7c4ba2c82a164eb88d467a088e953376dd764eae9ff7` remain unchanged.

Validation:
- `make lint`; full worker suite, 220 script tests and 42 infrastructure tests.
- Final web suite: 4,462 passed; 182 intentionally skipped. No failed tests.
- Actual browser font picker, exact font loading, draft save/restore and render
  compilation for Japanese Noto Sans JP, Noto Sans KR and Noto Serif KR.
- Browser output documents rendered locally with the exact registered Japanese
  worker source, including its font assets: 2-second, 1080×1920 H.264/AAC MP4s,
  glyph coverage and distinct title images checked. A sentence containing `数単`
  was normalized to Japanese Noto and rendered without missing glyphs.
- Existing synthetic FFmpeg editor integration retained and passed.
- Bounded local checks plus one production candidate build, estimated under
  KRW 5,000; no AI calls, new resources or customer render retries.

Local evidence: `/private/tmp/easycut-ja-font-verification` and
`/private/tmp/easycut-ja-feedback-*.log`. Browser validation uses real editor
components in an excluded local harness; it is not an authenticated customer save
on production. Customer videos and historical failed requests are not rewritten.

Release gate: finish final production build, compare protected paths with the
baseline manifest, verify unaliased candidate HTTP paths and all five dispatch
identities, then promote that same deployment without rebuilding. Preserve
publishing and maintenance gates; rollback is the baseline deployment above.
