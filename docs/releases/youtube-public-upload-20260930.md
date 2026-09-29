# YouTube upload availability and mobile publishing — 2026-09-30

Authorized: enable YouTube for eligible ordinary members, add progress/result dialog, show coming-soon notices for TikTok/Instagram/Threads, prefill project source attribution, and make mobile upload a bottom sheet without visible scrollbars. The owner will test actual YouTube publishing.

Baseline: f549d4da4af3e60b60d2ab818807db1908329d5b, promoted deployment dpl_8iSX8JntNREuWMAvLvbHsjC1MhXz. Worktree: youtube-public-upload/shorts-clean, branch codex/youtube-public-upload-20260930. Production Vercel prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw; existing Supabase mvcprswvfybudtopepuj / shorts_mvp and upload OAuth project 38531581302 remain guarded. No lab, schema or worker changes.

- Active ordinary users can manage their own channel connections. Publishing retains existing paid/managed download entitlement. Existing reviewer fixture restrictions and administrator entitlement exception remain. All output, channel, session and ownership checks remain server-side.
- Other platform tabs show the requested coming-soon notice and do not mount their publishing panels or initiate provider calls. Existing provider endpoints remain restricted as before.
- YouTube uses the shared sending/processing/complete/failed/unknown dialog, a synchronous duplicate-submit guard and bounded processing checks. Requested and actual visibility remain distinct. Default visibility remains private until the user chooses another value.
- Source title/author/original URL are prefilled as editable plain text. CC BY and its link are included only for verified CC sources. Fresh catalogue metadata is reused; missing metadata can use one quota-accounted provider lookup. Unverified/standard/file-upload sources never receive invented CC attribution. User draft edits, including intentionally empty descriptions, are preserved.
- At <=700px the upload dialog meets all three screen edges; scrolling remains enabled but its scrollbar is hidden. Desktop stays centered.

Validation: 108 targeted tests across 12 files passed, including embedded PostgreSQL ownership/retention tests, ordinary member entitlement, attribution fallback, immediate progress rendering, double-submit prevention and actual-visibility mismatch. Focused ESLint passed. Next production build passed, including its build typecheck. Standalone test-inclusive TypeScript checking still reports the two pre-existing implicit-any errors in components/home-hero.test.tsx (51,54), unrelated to this release; no unrelated edits were made.

Real-browser checks used the actual modified components with mocked provider responses and no actual uploads. At 390x844, bottom-sheet bounds were left=0, right=390, bottom=844 and computed scrollbar-width=none. All three other-platform notices, description/source/license links, sending modal, complete state and desktop centering were checked. No real public upload or Google propagation claim is made.

Cost scope: one bounded hosted build and read-only release checks (estimated below USD 2); no fixed commitment. Exact candidate deployment, path parity, preflight fingerprint and promotion evidence are recorded in the main checkout under .tmp/youtube-public-20260930-evidence.
