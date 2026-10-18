# Template editor UI unification — local verification

## Scope and source

- Baseline: promoted production source `ae58d4f3b73976da1eb43a94c6197e0cf5585eb9`.
- Worktree: `/Users/gimdongmin/.codex/worktrees/editor-studio-release/shorts-clean`.
- Branch: `codex/editor-studio-production-20261018`.
- Target: isolated local preview only. No cloud, production DB, release pointer, worker image or publishing maintenance changes.
- Story: edit an SNS/community template in the common studio shell, send its existing document contract, render the edited composition, and preserve edits when saving fails.

## Implementation

General, SNS and community editors reuse the studio topbar/back/zoom components and studio design tokens. The SNS/community editor now includes undo/redo with grouped typing and drag history, external preview transport, a resizable timeline, responsive non-overlapping time markers, shared pinch/trackpad zoom handling, selectable title/body/channel rows and real contiguous-range trimming. The mobile inspector uses the same bottom-tool/sheet pattern.

Template copy and layout contracts remain separate and unchanged. SNS retains its body/hashtag limits; community retains its board name. Unsupported split, captions and free-position controls are absent. Save uses the existing timeline version, release assignment, render version, document builder and SNS render spec builder. Image preparation blocks saving until the image is ready. Duplicate submission is guarded; accepted requests are distinguished from refresh failures. New copy includes English and Japanese translations.

One existing worker-test line was wrapped to satisfy Ruff; renderer behavior was not changed.

## Evidence

- Frontend TypeScript and ESLint passed. Worker/infrastructure Ruff passed using the existing Python environment with caching disabled.
- 190 relevant tests passed across template contracts, render spec, five SNS ratios, API handling, timeline gestures/ruler, history and release localization. Expanded English/Japanese label checks also passed.
- Local preview optimized build passed, including all three editor routes. It emits the existing optional `linkedom`/`canvas` dependency warning through `budoux`.
- Browser: desktop 1440×900 and 1280×720; mobile 367×812 and 320×568.
- Title edit/undo/redo, community board/body editing, preview play/end handling, zoom buttons, slider keyboard control and direct range dragging passed.
- Actual timeline divider drag changed height 352→387px. At minimum 300px all three layer rows remained visible (last row bottom 703px, viewport bottom 720px).
- Mobile 367px document width remained 367px. Time markers 0:00, 0:03, 0:06, 0:09, 0:12 did not overlap. The small 320px view retains scroll access to lower layers.
- SNS save produced a 12.0s 1080×1920 H.264/AAC file with the edited title.
- Community save produced an 11.9s 1080×1920 H.264/AAC file, with source start 0.1s, edited board heading and body. Both output files passed full FFmpeg decode; generated frames were visually inspected.
- One intentional local 503 preserved the draft; retry reused request ID `12634439-a932-4893-9c73-287bd67cd71c` and succeeded.
- General editor title edit/undo still worked after shared chrome extraction; no browser console errors were observed there.

## Configuration and limits

The local Next.js harness at `/private/tmp/easycut-release-preview` imports this worktree's components and uses `NEXT_PUBLIC_EDITOR_RENDER_SPEC_V4_ENABLED=true`. Its local API validates the real document schema and writes test files before invoking `EditorDocumentRenderer` from this worktree. It does not use production authentication, queues, object storage or databases. These checks do not establish production deployment or cloud-worker verification. Gesture event behavior has automated coverage; no physical iPhone or two-finger hardware test was performed during this change.

Artifacts:
- `/Users/gimdongmin/shorts-clean/.tmp/editor-ui-20261018/unified-sns-desktop.png`
- `/Users/gimdongmin/shorts-clean/.tmp/editor-ui-20261018/unified-community-mobile.png`
- `/private/tmp/easycut-release-preview/verification-storage/unified-sns-report.json`
- `/private/tmp/easycut-release-preview/verification-storage/unified-community-report.json`
- Matching `unified-*-request.json` and `unified-*-frame.png` in that storage directory.

Before production promotion, compare against the then-current promoted baseline, deploy an unaliased candidate, retain protected-route/manifest and existing release checks, and verify that exact candidate. This change has not been deployed.
