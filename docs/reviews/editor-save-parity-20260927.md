# Editor save and preview parity fixes — 2026-09-27

## Target and baseline

- Scope: five editor defects, web code only. Isolated worktree `editor-save-parity`, branch `codex/editor-save-parity-20260927`.
- Starting promoted production: `e73249b0ff233bb3c6051a2851098684ee3857a4`, Vercel `dpl_27H1FYUwDWdUwkrvJrYGNZtqLzTs`, project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`. Verified again at 2026-09-27T13:18:02Z.
- Existing worker compatibility reference: exact reporter release `8bec82d8-1654-4bd9-8ec3-e129e96cb97c`, worker source `98eee661bb14a4f9bb334c22442d4d5ca4bc0931`, image `sha256:8a2580c0ff9c2196f501451a737458acd089f8604be08110217870927bf4faca`.
- No worker, schema, account, cloud capacity or database changes. Local browser uses synthetic video and local API responses. This is not a production customer rerender or a lab deployment.
- The independently developed saved-videos feature must finish its release before this change is rebased onto the newly promoted commit. Recheck production immediately before candidate creation and promotion.

## Changes

1. Deleting an edge video clip updates the selected source boundaries with the remaining clips, keeping autosave and apply payloads valid.
2. Caption style is serialized even when captions are off and no cue text is edited. `document.subtitles.enabled` remains the existing worker visibility switch.
3. Added comments in a custom template use its configured/docked comment Y and size, including templates whose original comment is hidden.
4. Added text uses the worker's 86 px line height, 22/11 px padding and boundary positioning. Growing one line to three at the top preserves all three lines in the output canvas; old saved documents receive the same preview correction.
5. Apply errors have an accessible alert in the visible preview pane, independent of the settings sidebar, including mobile.

## Validation

- `make lint WORKER_RUFF=/Users/gimdongmin/shorts-clean/worker/.venv/bin/ruff`: passed (Python/static checks, web lint and TypeScript). The isolated checkout reuses the installed lint executable.
- Local production build passed, including Next.js lint/type validation and all pages. Existing optional `linkedom/canvas` resolution warning does not prevent the build.
- Editor web suite: 424 passed. Full web suite: initially 3,243 passed, one existing style-string expectation failed, 142 skipped. The expectation was updated for the intentional worker-aligned line height; affected 17 tests then passed. Skipped tests are not claimed verified.
- Exact existing worker: three retained synthetic FFmpeg/ffprobe integration cases passed: playable cut video, captions-off composition, v5 custom-template video/caption/comment geometry.
- Actual editor UI callback + document schema: first/middle/last clip deletion on timeline 100–130 is saveable and retains 20 seconds.
- Browser-generated apply payloads: all five validate in the exact existing worker. Captions remain off despite retained style data.
- Browser save flow: first clip deletion autosaves and submits valid selection 10–30; three-line text saves center Y=140, exactly matching worker center without a downstream shift.
- Comment regression: worker base Y=1392, resulting top Y=1655; browser top=1654.9887 on the same 1080 px coordinate system (<0.02 px rounding difference).
- Desktop and 390×844 mobile forced apply failure: alert remains visible with sidebar closed (mobile alert bounds x63–327, y70–113).
- Scope of geometry result: verified reported comment placement and multiline text boundaries. This is not a claim of complete font rasterization identity for all fonts, glyphs and widths.

## Evidence and resources

Local evidence: `/Users/gimdongmin/shorts-clean/output/editor-fixes-20260927/` (regression logs, build, synthetic browser screenshots, worker geometry and apply payloads). Payloads contain only synthetic editor content. Temporary browser server binds only localhost and must be stopped after checks.

Bounded verification uses local tests, synthetic rendering with existing 120-second per-process timeouts, and one production-configured unaliased web candidate when the current release baseline is settled. Expected incremental cloud build/transfer usage is under USD 2; no fixed recurring resource is added. No production video jobs or DB mutations are part of this fix. Record the actual candidate/promotion separately after release checks.
