# Caption find and replace — local implementation

- Source baseline: `8abf33d1dec1f8dfb3a057bafab8f9009b510eb0`, the production release verified earlier in this conversation.
- Worktree: `/Users/gimdongmin/shorts-clean/.tmp/caption-find-replace-20261018`.
- Branch: `codex/caption-find-replace-20261018`.
- Target: local isolated verification. No production/lab mutation, DB connection, environment deployment, or worker release change.

## Behavior

The existing editable-caption panel now offers literal text search, case sensitivity, occurrence count, highlighted matches and previous/next navigation with a timestamp and caption excerpt. Replacement applies to one occurrence or all matching editable source cues in the current short. Existing caption edit eligibility remains unchanged; templates without editable captions do not gain a nonfunctional control.

Replacement writes the existing `cueEdits` contract. Unrelated edits are preserved; restoring original text removes its override. Each replace action records one existing copy-history step, including multi-cue replace-all. In-progress caption drafts must be completed/cancelled first. Blank resulting captions and results over the existing 200-character limit reject the operation atomically. Literal replacement handles dollar signs and regex punctuation as ordinary text. UI copy is localized in Korean, English and Japanese.

## Configuration and verification

The local harness at `/private/tmp/easycut-caption-preview`, port 3022, imports this branch's actual editor and shared CSS. It uses synthetic caption text on an existing local sample video, V4 enabled, a local contract-validating endpoint, and the same source tree's Python renderer. It has no cloud credentials or database dependency. Bounded local rendering cost: no external service usage.

- `make lint`: worker/infrastructure Ruff, complete frontend ESLint, TypeScript passed.
- Targeted search, caption compiler/edit, history, document snapshot and save regression tests passed; see `/private/tmp/caption-find-tests.log` for exact totals.
- Local preview optimized build passed. Existing optional BudouX/linkedom canvas warning remains.
- Browser: desktop 1440×900, mobile 367×812 and 320×568. At 320px, document width remained 320px and both input fonts were 16px.
- Four matches across three source cues: replace-one left three; replace-all cleared remaining matches; Undo restored all three in one action; Redo reapplied them.
- Mobile next-result navigation and replace-all passed. Empty-caption and >200-character replacement buttons were disabled with an explanation.
- Reload restored the edited text through the existing local draft mechanism.
- English and Japanese search-panel labels verified in the browser; authored Korean caption text remained untouched by UI localization.
- Browser console error query returned no errors after the apply flow.
- Apply request passed the actual editor-document schema, contained the three intended cue overrides, and rendered a 12.0s 1080×1920 H.264/AAC video. Full FFmpeg decode passed. A rendered frame visibly contains `EasyCut으로 영상을 만들어` after replacement.

Artifacts: `/private/tmp/easycut-caption-preview/verification-storage/{apply-request.json,render-report.json,rendered-frame.png,output.mp4}`; desktop/mobile screenshots in `/Users/gimdongmin/shorts-clean/.tmp/caption-find-verification/`.

## Limits and existing failures

No deployment, cloud queue, production authentication/DB round-trip, or physical mobile keyboard test is claimed. Search operates within editable caption cues, not across cue boundaries. The release baseline must be checked again before future production promotion.

The broader `lib/i18n/first-render.test.tsx` suite has two pre-existing community-editor assertions expecting the board-name field on the initial title tab. Both fail identically on unchanged baseline `8abf33d1` (23 passed / 2 failed); this feature does not change those unrelated controls. Baseline evidence: `/private/tmp/caption-baseline-i18n.log`.

## Compact UI follow-up — 2026-10-19

Continues locally from `b1c4d1b0`, on the same feature branch. Search is now always visible, replacement opens as one optional row, and case sensitivity is under search options. Only matching caption rows remain, with clickable timestamps and direct caption editing. The search bar stays sticky within the existing inspector scroll container. A changed draft remains visible until commit/cancel.

The replacement status offers inline Undo only while that exact replacement history entry is still the latest editor action. The handler rechecks after finishing pending interactions, so it cannot undo a subsequent unrelated edit.

Verified with the actual editor: replace-all / inline Undo; timestamp seek to 7.8s; editable draft retained while filtering; replacements blocked during a draft; inline Undo disappears after changing subtitle visibility and becomes valid again after reverting that later action. At 367×812 and 320×568 the expanded search/replace area is approximately 132px tall; the 320px document stays 320px wide and text inputs stay 16px. Underlying replacement/compiler/save contracts are unchanged from the rendered test above.

Follow-up validation: frontend TypeScript and changed-file ESLint passed; 25 targeted tests passed. The optimized local harness build passed after correcting the harness-only locale imports to use `messagesByLocale`. English and Japanese compact labels/counts were verified in the browser. Screenshots: `compact-mobile.png` and `compact-desktop.png` in the artifact directory above. No deployment was performed.
