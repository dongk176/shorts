# Showroom swipes — 2026-09-27

- Authorized production UI change on `codex/showcase-geo-release-20260927`, worktree `.tmp/showcase-geo-release-20260927`, based on promoted `d59f0ec7c27d41d5566be83e68212e150a31fa1e`; parent-only difference is the preceding release record.
- Released `359a5a8983b9a88993183f922b43de8bed25db8f` as `dpl_6VoDUh59ozJzygG1xaJXSoMsgPQE`, https://shorts-js15pk0bg-artiroom.vercel.app. Existing production configuration; no worker/DB/infra changes.
- Horizontal pointer gestures select previous/next center short using existing animation and label positioning, wrapping all three. Direction lock after 10 px; change after 40 px with horizontal dominance. Capture/preventDefault only for horizontal gestures; CSS `pan-y pinch-zoom` preserves browser vertical scrolling and pinch zoom. Suppress trailing clicks from drags; retain normal taps and keyboard clicks.
- Mirrored gesture changes into `.tmp/category-showcase-review-20260926` served at 4123, preserving other local work.
- Local browser (390x844) checked left/right, wraparound, normal click, below-threshold drag, vertical drag keeping selection. Candidate/live browser checked pointer drag and effective touch-action. Candidate scrolling over the fan moved the page 422 px with selection unchanged. These are Chrome mobile-viewport pointer/wheel checks, not a physical-phone touch test.
- Scoped ESLint, 14 existing tests, local and remote builds, route parity/release guard passed. Candidate/live HTTP checks covered three locales, guest section order, protected routes, locale routing, worker admission fingerprint; no jobs submitted.
- Rechecked unchanged live baseline, promoted the identical candidate, then verified production. Initial 5-minute error query returned zero records.
- Evidence: `/tmp/showcase-swipe-20260927/`. One local build and one existing-service deployment; no fixed-cost commitments.
