# Paddle admin ledger integration — 2026-09-27

Production baseline: 582189fbc4d3b0c1ab19fe006befaece8b511508, deployment dpl_3UT5dgYad9N8Dertkd4h6CTkEYzB (verified alias identity).
Branch: codex/admin-paddle-20260927. No schema, environment, payment, refund, or subscription mutations.

Completed live Paddle payments join the existing paginated admin order list. Native USD and JPY minor units stay separate from domestic KRW figures. Approved refunds and chargebacks reduce their respective currency totals; pending refunds are displayed separately. Historical plan/period snapshots are used. Recorded timestamps are webhook ingestion time, explicitly labelled. Sandbox is excluded, real test charges remain included.

Read-only summary is available in overview and billing; failed requests show unavailable/retry rather than zero. Require existing admin authentication. Payment transaction links lead to Paddle; no new refund execution surface.

Validation: PGlite integration (mixed ledgers, cursor microseconds, filtering/pagination, refund states, KST boundaries), existing admin regression tests, summary authorization tests, TypeScript, scoped ESLint, Next build, release guard tests, desktop visual check using actual components with isolated synthetic data. Production read-only ledger observed one JPY590 and one USD399-minor payment.

Release: unaliased candidate, protected-route and admin denial verification, unchanged production worker admission fingerprint, then promote exact candidate. Runtime verification artifacts retained outside source under /private/tmp/admin-paddle-20260927. Lab is not used as production-equivalence evidence.
