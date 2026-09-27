# Shorts guide production release

User authorized production deployment of the local guide, three-language pages, paid workbooks and anonymous survey collection on 2026-09-27.

## Source and environment

- Read the actual promoted domain using the Vercel API: project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, team `team_3pn55cGmUE8SRRKg0D3dRiPJ`, deployment `dpl_A1dcLi6cqWobJoLf5dHWXqHCybVK`, source `b5a8c2446939ca16644c313b749c3dd22d3d49ab`.
- Rebased only this guide's changes onto that source, preserving recent admin Paddle and homepage swipe changes. Worktree `.tmp/shorts-monetization-production-20260927`, branch `codex/shorts-monetization-production-20260927`.
- Existing production Vercel project uses root `web`, Next.js and Node 24. Candidate uses the existing production configuration with `--prod --skip-domain`; no lab environment or infrastructure changes.
- DB URL from existing local configuration matches the fixed production fingerprint and project `mvcprswvfybudtopepuj`. Read-only connection confirms `postgres` database/role, `shorts_mvp` schema and existing plans; analytics table was absent before this release.
- Only `202609270010_shorts_guide_analytics.sql` is approved for application. Existing `public`, plans, billing, jobs and worker data are unchanged. No worker submissions or payment transactions are part of the release.

## Checks and deployment plan

- Full local production build and web ESLint passed. 105 focused tests cover quiz, localized routes, storage, paid entitlement/download, analytics persistence and replay. Twelve baseline/release guard tests passed.
- Baseline route manifest copied from the exact promoted commit's build in `.tmp/admin-paddle-20260927`; candidate preserves every existing route. Only three guide pages and two APIs are added to the exact release allowlist.
- Verify private PDF tracing, all three localized pages and assets, denied anonymous downloads, malformed event rejection, five protected paths and job-admission fingerprint on an unaliased remote candidate.
- Apply additive migration, verify authenticated DB insertion/dedup with a bounded synthetic anonymous event, remove only that exact test attempt, and promote the same verified candidate after rechecking the live baseline.
- Existing-service usage estimate: one local build, one remote build and bounded HTTP/DB checks; no new subscriptions, idle infrastructure or other recurring resources.
- Immediate post-promotion verification will check domain identity, guide/locale responses, collection and runtime errors. Full editor rendering and real paid-account downloads are not claimed by public-route checks.

Release evidence is stored locally under `/tmp/shorts-guide-release-20260927/`. Final deployment identifiers and results will be appended after promotion.

## Candidate correction

- First unpromoted candidate `dpl_317LyTTJsDkJkBiQ1JLo1NPPj51o` built successfully. Public route, locale, cover asset, entitlement denial and worker-target checks reached the analytics check, which exposed postgres.js serializing a JSON string a second time for an inferred jsonb parameter.
- Corrected the bound parameter to `::text::jsonb`. Reproduced and verified the fix using the actual production postgres.js driver/transform and a transaction that was rolled back; insert plus replay yielded exactly one row. The first candidate was not promoted.
- Applied only the approved analytics migration to verified production DB; the migration runner confirmed public schema unchanged. No production configuration was modified.

## Final production result

- Deployed source: `90481f61ee6a58e2e6e977c116fc1d1f4f19c758` (clean at upload), deployment `dpl_AtsX5PPGp7CPNWnUuLjvM35ehjcV`, candidate `https://shorts-ad613o79g-artiroom.vercel.app`.
- Rechecked live baseline `b5a8c244` immediately before promotion. Promoted the identical verified deployment without rebuilding; live domain API confirms the same final deployment ID, SHA and READY state.
- Candidate and live domain each passed 29 checks: all three language pages, canonical/language text, existing protected paths, 15 cover assets, anonymous download denial, private file non-exposure, sitemap, five exact worker target fingerprints, remote analytics insertion and replay deduplication. Only exact synthetic test survey IDs were deleted afterward.
- Final local/remote builds and route manifest checks passed; all 15 paid PDFs are in the function trace. Analytics tests rerun after the correction: 13 passed. Prior 105 focused tests and 12 release guards passed.
- Browser inspected the final candidate at 390px with no horizontal overflow and the promoted desktop guide/sidebar. Existing logged-in paid account downloaded the Korean first-short PDF; downloaded file SHA-256 `b2135fe1f1d9423e3af7e0424df096cea037409d2659f19043acbd1789224f32` exactly matches the private source. The browser automation download event timed out, but the actual file arrived successfully and was verified on disk.
- Final deployment's immediate preceding ten-minute server error scan returned zero entries. This is a bounded check, not ongoing monitoring. Authenticated editor rendering and real payment transactions were not exercised.
- Initial promotion by URL hit a CLI team-selection error before changing the domain; explicit verified team ID plus deployment ID succeeded.
- Screenshot: `/tmp/shorts-guide-release-20260927/production-guide.png`. Subsequent documentation-only commits do not change the deployed source above.
