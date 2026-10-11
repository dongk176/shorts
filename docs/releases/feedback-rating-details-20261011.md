# Rating-dependent product feedback — 2026-10-11

Baseline: promoted production commit 6f7e38a6d3537744f85d4a7bc987b488e30f40fb,
deployment dpl_E8TtsBUnceVPFNigfJCQ5wXsovv7. Reuse the clean isolated
codex/feedback-japan-collection-20261011 worktree.

Ratings 1–3 reveal the reason and optional review with a 300ms collapse/expand
transition; reduced-motion preferences disable the transition. Ratings 4–5
submit only a rating. Switching to a high rating clears stale details; the API
also normalizes these details to null. Low ratings still require one reason.
Closing/deferring, eligibility and the once-per-account reward remain unchanged.

A backwards-compatible shorts_mvp migration allows a missing reason only at
ratings 4–5. Existing responses, privileges and RLS remain unchanged. Admin
shows rating-only responses explicitly and excludes unanswered reasons from
reason counts. No artificial positive reason is recorded.

Configuration: production Vercel prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw and
Supabase mvcprswvfybudtopepuj / shorts_mvp. No lab, worker or publishing changes.
Tests use mocked browser requests and isolated PGlite, with no real reward issued.
Estimated work: one local build, one hosted build and bounded read-only release
checks; no video/AI API jobs, new services, or recurring cost.

Verify feedback component/schema/Postgres tests, typecheck/lint/build, route
manifest parity and five protected paths plus existing admission/auth checks.
Deploy a clean committed unaliased production candidate, then promote that exact
verified deployment without rebuilding. Release results: .local-review/rating-release-receipt.json.
