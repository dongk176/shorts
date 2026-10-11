# Feedback result-view marker hydration fix — 2026-10-12

Baseline: current promoted source 7fc8242d80eaed41df044bb7237a748b9ebf456d,
deployment dpl_6bkj5Kdo3YCzAwiGuwfwLG1ockf3. Worktree:
.tmp/feedback-japan-collection-20261011, codex/feedback-japan-collection-20261011.
Production Vercel prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw,
Supabase mvcprswvfybudtopepuj / shorts_mvp. No remote DB changes required.

Observed in production: play a completed non-example result, then use the
project back button (location.assign to /#results). No feedback dialog appears.
RootLayout knows authentication but initially sets accountId=null; the feedback
overlay erased the session result-view marker before /api/mvp/usage resolved
accountId. This prevents even the eligibility GET. The previous queue-only tests
mocked account identity as already resolved and missed this independent blocker.

Keep the marker while an authenticated account ID is loading. Clear on signed-out
state, and validate ownership/expiry once account identity resolves. Existing
view requirement, deferral, rating rules, reward limits and protected flows remain.

Reproduction: real UsageProvider, all actual preceding welcome overlays, delayed
usage response and a session marker from a previous result view. Test fails on
baseline (marker immediately null), passes after fix and opens actual feedback.
Separate real API GET/POST + isolated PostgreSQL tests cover saved rating-only and
low-score details, idempotent rewards, already-submitted and unauthorized cases.
No synthetic production feedback or rewards are created by these tests.

Estimate: one local and one hosted build, bounded read-only checks and playback
of an existing result. No video generation or new recurring resource costs.
Candidate checks: typecheck/lint/tests/build, unchanged route manifest, all five
protected paths and existing admission/auth checks. Promote the exact clean
committed candidate without rebuilding; then replay production browser flow.
Results are stored in .local-review/hydration-release-receipt.json.
