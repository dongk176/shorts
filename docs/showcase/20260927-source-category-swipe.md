# Source video category swipes — 2026-09-27

- Authorized production UI change on `codex/showcase-geo-release-20260927`, worktree `.tmp/showcase-geo-release-20260927`. Promoted baseline `d546a62a4e69c18d9392de40e04f7d662673b27f`; intervening parent is release documentation only.
- Source horizontal swipes switch all six categories with wraparound and reset the center short/audio to the existing category defaults. Source, short set, copy and active tab update together. Shared gesture handlers preserve the child capture-loss fix, thresholds, vertical/pinch browser gestures and click suppression; ordinary source tap still opens preview. Short swipes still select styles only.
- Mirrored component/CSS changes to the local 4123 worktree, preserving other work there.
- 24 tests passed, including KO/EN/JA touch capture, six-category cycling and reverse wrap, no dialog after swipe, center reset, original video update, vertical gestures, cancel and tap-to-open. Scoped ESLint, local/remote production builds and release guard passed.
- Local/candidate 390x844 browser pointer checks: source left/right selects next/previous, dialog stays closed; scroll over source moves page while category stays unchanged. Candidate new source resumed playback. Physical phone was not available; touch event transfer covered by React DOM regression tests.
- Released source `b66d42eeea78a5f29f4d842ceeb9f4a7fa4b4458`, deployment `dpl_FDBp62FRwCaPbgCHXZUSbJ1FnGTC`, https://shorts-or38w7ghh-artiroom.vercel.app. Baseline rechecked immediately before same-candidate promotion.
- Candidate/live checks passed: three locales, guest section order, protected routes, locale routing, route parity and worker admission fingerprint. No jobs submitted or DB/infra configuration changed. Initial 5-minute deployment error scan: zero records.
- Evidence `/tmp/showcase-category-swipe-20260927/`. Existing-service build/deployment only; no fixed recurring cost.
