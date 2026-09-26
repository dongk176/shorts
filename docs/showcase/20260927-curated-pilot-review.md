# Curated showcase pilot — 2026-09-27

Local candidate only, not deployed. Worktree `.tmp/category-showcase-review-20260926`, branch `codex/category-showcase-review-20260926`, baseline `f9750acf607b8116f5a032bd0322d886d3eac258` plus current uncommitted showcase changes. No cloud, database or production configuration changes.

## Selection

Hard conditions: official source or official collaboration, individually verified reuse-allowed CC BY, long-form source, published 2026-03-27 through 2026-09-27. Rank eligible sources by substantial subscriber base and recognition in the language/category, then views and usable moments. Subscriber counts are rounded YouTube UI observations, not proof of audience age.

- Korean gaming: 침착맨 플러스, https://www.youtube.com/watch?v=sLPF_ibWhOg, 2026-09-16, 417,603 views. Main creator channel 3.27M subscribers, source secondary channel 884K. Verified CC BY in expanded description and independent metadata.
- Japanese talk: とある男が授業をしてみた × コムドット やまと, https://www.youtube.com/watch?v=vznu6pLMPXA, 2026-09-21, 206,378 views. Comdot 4.29M subscribers; uploader 2.24M. Official collaboration shown in YouTube UI; CC BY verified in expanded description and independent metadata.
- English MMG remains reserve only (3.24M subscribers; video 1,168,159 views). User explicitly requested broader recognition up to MrBeast's level. Downloaded reserve excerpts have not been rendered or promoted as a new main example. Existing English UI remains the earlier silent draft.

## Mega-creator search limits

Direct YouTube CC-filter searches covered MrBeast, Mark Rober, PewDiePie, IShowSpeed, Dude Perfect, MKBHD, Linus Tech Tips, Ludwig, Jacksepticeye and Veritasium. No recent official long-form source meeting all conditions was confirmed for a broadly recognizable English main example in this pass. This is a bounded search result, not a claim that no such video exists. Many matches were old interviews, reactions or unofficial reuploads.

The recent How To Make Everything video https://www.youtube.com/watch?v=hZbxuSLaPDw is by a 1.90M channel and describes recreating a device at Mark Rober's casino and the author's two-second cameo in Rober's video. It is not a Mark Rober upload; Rober's sustained on-screen role and individual license were not verified. Do not promote it as a verified Mark Rober example.

## Completed media

Six new native-template videos in `web/public/showcase-examples/curated-pilot-v1`: Korean gaming and Japanese talk, three each. Every output has original audio, native comment/basic layouts or word-timed highlighted captions. Comment text and reaction counts are explicitly AI examples, not real viewer endorsements. Per-output JSON files record exact source ranges, render specs and SHA-256.

Korean highlight composition enlarges the face camera while retaining full gameplay below. Japanese highlight composition preserves changing original two-person/close-up shots and removes only the original subtitle strip. A fixed left-person crop was rejected after visual inspection because the source cuts to centered close-ups.

Only bounded source excerpts were acquired into temporary local storage; no full source stored or uploaded. Accurate cuts use original-language audio. Transcription uses configured providers for highlight timing; local rendering uses unchanged product `VideoRenderer`. No renderer changes and no cloud jobs. Ordinary local download/transcription/render costs are within existing authorization; provider billing has not been reconciled here.

## Verification

- TypeScript and scoped ESLint passed
- First-render regression: 12/12 passed
- All six final shorts asserted 1080×1920 H.264/yuv420p, expected duration and an audio stream; output posters inspected
- Korean highlight also decoded fully through FFmpeg without errors
- Browser: Korean and Japanese source plus three shorts load; selected short moves to the center without opening a dialog
- Sound button makes only the centered short audible; changing selection moves the audio to that short
- Opening original preview pauses/mutes all background videos
- Japanese mobile at 390×844: no horizontal document overflow, source/arrow/fan/buttons and credits visible, central selection and audio verified
- One stale Korean media load during asset replacement cleared on reload; all four Korean media then readyState 4 without errors
- Production build passed for this local candidate; existing optional linkedom/canvas warning remains. Log: `/tmp/easycut-curated-20260927/build.log`. No deployment

Scope remains partial: 2 newly selected originals / 6 completed new shorts, not the full 18 originals / 54 shorts. Other existing videos are older silent drafts or categories awaiting source selection. Preview footer discloses this.
