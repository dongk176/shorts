# Ranking selected-scene preview — 2026-10-26

## Target and baseline

- Authorized ongoing production ranking UI changes. No lab changes.
- Baseline: currently promoted production commit `237b145dd6ccd9acfc13c0e584278da9c3e761c1`, deployment `dpl_23DrdEgmudq8VjgLUFd8Cubatfgg`.
- Isolated worktree `.tmp/ranking-live-preview-20261026`, branch `codex/ranking-live-preview-20261026`.
- Production project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, team `team_3pn55cGmUE8SRRKg0D3dRiPJ`; existing production account and configuration. Supabase remains `mvcprswvfybudtopepuj` / `shorts_mvp`. No schema, environment, worker, infrastructure, or download-path changes.
- Frontend-only candidate uses the production configuration, not lab. Ordinary bounded builds/tests only; no media jobs or fixed recurring resources.

## Behavior

YouTube selected scenes now use a second official privacy-enhanced iframe in the composition preview. A muted seek decodes the requested frame; the custom play control plays the selected interval and pauses at its end. Timeline start/end and cursor edits update the existing iframe without recreating it. Playing either source or composition pauses the other. The Space shortcut respects text fields and modal dialogs. Suspended/changed scenes destroy their players and timers. Failure is explicit with a reconnect action; it never silently substitutes a thumbnail.

Geometry follows the renderer's scale-to-cover and central crop below the header. Known source dimensions are preferred; the public original-aspect cover supplies geometry only for unresolved YouTube sources. Missing geometry defaults to Shorts 9:16. YouTube API seek/pause timing is approximate, not frame exact, and custom/nonrepresentative covers can make inferred geometry imperfect. No canvas extraction or cross-origin iframe inspection is used by the app. No prepare, media, or download API is called by this preview; final source acquisition still happens on Make Video. This is selected-scene playback, not a claim of full mixed-source/music/transition playback.

Removed original-open link, download/status/source-duration text, and selected-duration heading from the source editor. Source removal stays available as a labeled trash button. Desktop composition width reduced from the previous 90% multiplier to 80%; mobile preview is capped at 300px.

Source iframe timeouts now stay local with an explicit reconnect control instead of claiming YouTube forbids playback through a second global alert. Actual source and composition failures remain visible; reconnect recreates only that player and preserves the editor input.

Production smoke check of the initial candidate `dpl_YPF9DWw6M9jVfjUBBbkcExriqVU1` found that browser-blocked muted frame preparation incorrectly disabled the explicit play control. It was reverted to baseline deployment `dpl_23DrdEgmudq8VjgLUFd8Cubatfgg` while correcting this. The successor distinguishes ready API / decoded frame / blocked automatic seek: the play button stays available after automatic seeking is blocked, and an explicit user gesture issues seek+play together. A loading cover conceals undecoded YouTube covers until a decoded frame is reported. No source download fallback is introduced. Regression coverage includes this observed blocked-autoplay case.

The corrected version was tested in actual local Chrome after waiting nine seconds beyond API reconnection: the blocked-seek prompt appeared while the explicit play button remained enabled. Clicking it decoded the selected 3–6 second scene, removed the loading cover, played the actual video and stopped at 3.0 / 3.0. Corrected full frontend suite: 3,922 passed, 182 skipped, with two workers and bounded 15s tests / 30s hooks to avoid the observed host-load timeouts. Focused preview/embed/crop suite: 34 passed. Local production build including lint/type validation passed before adding the temporary harness; the harness and generated development route types were removed again after this verification.

## Verification and release method

- Crop geometry unit tests compare portrait, landscape, square and missing metadata against renderer scale-to-cover geometry.
- Real component/YouTube API contract tests cover muted initial seek, no source download or thumbnail fallback, selected end/restart, changing range without player recreation, cross-rank seek isolation, source-pause signal, Space/input handling, suspension/reconnection and timer disposal.
- Local Chrome: exact reported video `w-g1AInuLe8`, actual right-side moving frames and captions; 3–6 second selection playback returns to stopped at 3.0 / 3.0. Cover-only behavior is gone. DOM showed 307.34x420.89 composition media region and 307.34x546.83 centered iframe; no horizontal overflow at 1920px. Removed text absent. Local server logs contain no source acquisition requests. Initial background iframe load required the reconnect control; playback then succeeded.
- A temporary development-only `/ranking-design` harness used the same studio and CSS with a separate local draft owner. It was removed and its generated route types deleted before production build. No auth bypass is included in the candidate.
- Physical mobile and mobile browser emulation were not run; CSS mobile size cap inspected. No renderer changes, so no new rendered output is claimed.
- Before promotion: clean committed source, source-byte identity checks for actual candidate, unchanged route-manifest gate, five protected-path checks plus ranking authentication checks. Promote that exact staged production deployment without rebuild.
- No temporary login callback or upload-origin entries are needed for this frontend-only method. Final smoke check uses a new tab in the existing authorized DongK production session, preserving the user's existing tab and draft.

Final test counts, deployment identity and production screenshot are recorded under `outputs/ranking-live-preview-20261026` outside the source worktree.
