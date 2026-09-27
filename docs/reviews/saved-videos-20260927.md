# Account-owned saved videos — 2026-09-27

## Source and scope

- Read-only production API lookup: project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, deployment `dpl_27H1FYUwDWdUwkrvJrYGNZtqLzTs`, promoted source `e73249b0ff233bb3c6051a2851098684ee3857a4`.
- Reused clean worktree `.tmp/shorts-monetization-production-20260927`, branch `codex/shorts-monetization-production-20260927`, initial HEAD `f19a4ed2` (documentation only after the promoted source).
- User requested Save on trending videos and Saved videos in the desktop sidebar/mobile menu. Implemented account persistence, not browser-only storage. No paid-plan restriction.

## Implementation

- Card-right bookmark button with pressed/busy states, per-video duplicate-click protection and visible errors. Failed writes retain the previous state. List refreshes on focus and once per visible minute; bounded requests and account-change cleanup prevent stale asynchronous updates.
- `/saved-videos`, `/en/saved-videos`, `/jp/saved-videos`: newest-first saved list, title/channel search, 48-card display batches, empty/login/error states, removal and the existing YouTube/copy-link actions. URL-localized page title, links and login return destination; private page is noindex.
- Sidebar/mobile menu share navigation. Small-screen menu now scrolls within the viewport.
- Server-only API derives ownership from authenticated session; strict input schemas, same-origin JSON mutation guard, private no-store responses, idempotent save/remove, 500-bookmark account cap serialized with an account lock.
- New additive migration `202609270002_saved_videos.sql`: only `shorts_mvp.saved_videos`, its index, RLS and grants. Account/catalog FKs cascade. Browser anon/authenticated DB roles have no direct access.
- Stores only account/catalog references and saved time. Reads current catalog metadata, honoring the existing read kill switch, regional visibility, public availability and 30-day freshness. Unavailable videos become removable placeholders; no old metadata copies or source-video storage.

## Verification

- 89 focused tests passed (API authorization, ownership, validation, cross-origin rejection, idempotency, cap, catalog visibility, locale routing/middleware, existing popular UI and shell regressions).
- Local PostgreSQL 16 integration passed using a dedicated loopback-only Docker container with 256 MB memory / 1 CPU and ephemeral data. Exercised actual queries, repeat saves, account isolation, cross-account removal rejection, expired/unavailable metadata suppression, removal and RLS/browser-role grants. All fixtures/DDL rolled back, then the container was stopped and automatically removed.
- Browser fixture used the real client components/hooks with in-tab fake API responses: save → saved list, title search/no results/reset, failed removal preserving saved state, successful removal/empty state, two saves, desktop 1365px and mobile 390px without horizontal overflow, mobile menu link. This does not claim a real authenticated production browser write.
- Real local page checks: English/Japanese rendering and document titles, localized menu targets, login modal and `/en/saved-videos` return URL. The temporary fixture route was removed before the release build.
- Screenshots: `/Users/gimdongmin/shorts-clean/output/saved-videos-20260927/desktop.png` and `mobile.png` (local fixture views).
- Scoped lint passed; eight existing release-guard tests passed. Final production build and route comparison recorded below when complete.

## Production status / approval boundary

- No production DB changes or deployment were performed for this feature.
- Automatic approval review rejected a proposed production transaction test (DDL + synthetic fixtures + rollback), citing lock/partial-failure/service-impact risk and insufficient specific authorization for that production-write test. The command did not run. It was not retried indirectly; verification moved to an isolated local DB.
- Pending explicit approval: add the single saved-videos table in production and deploy the feature. Before applying it, recheck the promoted source, actual DB identity and relevant schema; inspect any existing same-named table instead of assuming its shape.
- Then use the exact selected migration with production identity guards, build an unaliased candidate, verify existing protected paths/new localized routes/API auth, and promote that exact candidate without rebuilding. Local test success is not production deployment verification.
- No recurring services added. Existing local infrastructure was used for bounded tests and shut down after testing.

## Final local release checks

- Full production build passed (Next.js 15.5.20), including lint/type validation. An initial build found a generated type file for the removed local fixture; only that generated file was removed and the final build passed.
- Compared the exact pre-change production-source app route manifest: no routes removed; exactly four additions (saved page, EN/JP aliases, saved-video API). No fixture route in the final output.

## Icon and centered toast follow-up

- Moved the Save control to the thumbnail's top-right corner. Icon-only 44px touch target, filled purple state for saved videos, spinner while pending, translated accessible labels/tooltips. Moved the reuse badge to bottom-left to avoid overlap.
- Save/remove confirmations now appear at the viewport center via a non-interactive body portal and disappear after 1.8 seconds. Consecutive successful actions restart the timer; messages are localized. Both popular and saved lists share this component.
- Browser fixture verified save/remove, empty button text, automatic toast dismissal, mobile center `(195,422)` at 390×844 and desktop center `(682.5,450)` at 1365×900; no horizontal overflow. Screenshots `icon-toast-mobile.png` and `icon-toast-desktop.png` are under the same output directory. Fixture removed after testing.
- This is a local UI follow-up. Production DB/deployment approval status remains unchanged.
