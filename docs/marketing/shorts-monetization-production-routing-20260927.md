# Shorts monetization: production routing baseline

## Scope and source
- Local implementation only; no deployment, DB, worker, or environment changes.
- Vercel read-only domain lookup for `www.easycut.co.kr` returned production project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, deployment `dpl_AffDkcPun8BLd4YkVwygmtwFeUB2`, URL `shorts-po8g9povy-artiroom.vercel.app`.
- Matched this deployment to its release record `docs/showcase/20260927-first-swipe-guide.md`: source `add473bedd3b34140b204199e148e7eac3cafbc6`.
- Isolated worktree `.tmp/shorts-monetization-production-20260927`, branch `codex/shorts-monetization-production-20260927`, based on that exact commit.
- Imported only `web/app/shorts-monetization` and its `web/public/images/monetization` assets from the earlier local prototype. Older shared application files were not carried over.

## Changes
- Registered `/shorts-monetization` as a localized public page using the production `/en` and `/jp` prefixes.
- Added concrete language aliases using the same middleware treatment as production pricing, avoiding the observed double-rewrite that reset server-rendered language to Korean.
- Use production localized navigation and metadata helpers for internal links, canonical URLs, hreflang, localized social images, structured data, and copied plan URLs.
- Added all three public URLs to the sitemap.
- Existing three-language copy, six-question recommendation flow, images and layout retained.

## Local verification
- Clean process environment, no application `.env` loaded; existing dependencies reused. No DB/auth/worker services connected.
- Dev server: http://127.0.0.1:3018.
- 72 focused model, routing and middleware tests passed; scoped ESLint and TypeScript checks passed.
- Browser: direct entry to all three URLs overrides a conflicting cookie; page copy, HTML language, canonical, hreflang and article URL match.
- All three quiz flows completed and copied text used the matching language URL. No browser runtime errors.
- Language picker preserved query and anchor while moving through English, Japanese and Korean URLs.
- No horizontal overflow at widths 320, 390, 768, 1440; all four photo card heights matched at each width.
- Sitemap contains the three URLs; existing `/en/pricing` still renders in English.
- Browser evidence: `/tmp/monetization-production-verification.json`, `/tmp/monetization-production-{ko,en,ja}.png`.
- This is local page/routing verification, not a production deployment or verification of authenticated billing/editor flows.
