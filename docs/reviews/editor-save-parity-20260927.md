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

## Integrated release baseline

At 2026-09-27T13:26:23Z, saved videos was verified promoted as `03c030e6cb3a9ea2040304926af125570267285c`, deployment `dpl_2DXVKBaNTgxUY28PZvMyiV2s5G6y`. Rebased only the editor commit onto that exact source. The 11 editor files and 26 saved-feature files have no overlap. Baseline route manifest was copied from that source's successful build and contains all localized saved pages and its API.

Reopened the local editor: the three-line draft restored its full text and top bound exactly at the canvas top (84 CSS px). Temporary localhost servers and browser tabs were stopped. Existing transient pre-compilation draft validation warning converged to the correctly saved/restored draft; no persistent autosave failure reproduced.

## Final integrated checks

- Production build passed on the integrated saved-videos + editor source.
- Full web run: 3,260 passed, seven failures in the pre-existing popular-search UI test, 143 skipped. The test queued the new `/api/saved-videos` fetch as if it were a search fetch, shifting all indexed responses. Added an empty saved-state response to that test only; all 13 search tests then passed. The 3,267 executed web tests have passing results across the full run plus the corrected-file rerun. No production search or saved-video code was modified.
- Release guard tests: 11 passed. Saved feature code, worker code, DB migrations and target registry are identical to the promoted baseline.
- The final test-only correction and this review record are excluded from the deployed runtime. Local build source and release candidate runtime source are identical.
