# Guest home showcase order — 2026-09-27

- Target: authorized production UI update; no lab, DB, worker or infrastructure changes.
- Worktree: `.tmp/showcase-geo-release-20260927`; branch `codex/showcase-geo-release-20260927`.
- Promoted baseline: `8e4e46bb740a970775f973e67243482ec841781b`; parent `950f0ee5` adds only the prior release record.
- Candidate source: `68a05611c74123ea7932517dbe8939de88e64b38`.
- Deployment: `dpl_6nSy3xb8MXvebHePrdXs4Xkg5Nuz`; `https://shorts-mdeyneonz-artiroom.vercel.app`.
- Guest home renders the category showroom before example projects for KO/EN/JA. Authenticated home retains projects before showroom. Exactly one showroom is mounted.
- Local scoped ESLint, 12 i18n first-render tests, production build and release guard passed. Route manifest unchanged.
- Candidate browser checks confirmed all three guest locales. Live browser authenticated KO confirmed the original projects-first order remains.
- Candidate and post-promotion unauthenticated HTTP checks confirmed all three locales render exactly one showroom before examples. Protected home, guidebook, pricing, admin and editor route checks passed, as did locale routing and registered worker admission fingerprint checks. No worker job was submitted.
- Rechecked unchanged production baseline immediately before promoting the tested candidate without rebuilding.
- Cost scope: one local build and one existing-service deployment; no new paid resources or subscriptions.
- Verification evidence: `/tmp/showcase-order-20260927/candidate-verification.json` and `production-verification.json`.
