# Country-aware home entry — local only

## Scope and isolation

- User requested local implementation while home UI is being edited elsewhere.
- Branch: `codex/geo-locale-local-20260927`.
- Worktree: `.tmp/geo-locale-local-20260927`.
- Source baseline: `4c5ef9a503a6770ed422c0ab6cc640d1dce3ff66` (previous Paddle
  release plus release notes). This is not a fresh claim about the currently
  promoted production source; the previous read-only deployment check returned 403.
- No home UI, CSS, billing, database, worker or deployment settings were changed.
  No remote credentials or production environment files were copied.

## Rules

Only GET/HEAD requests to `/` choose an entry language. Explicit `/en` and `/jp`
links and all deeper/shared routes keep their existing behavior.

1. Valid `easycut_locale` cookie from the existing language selector wins.
2. Vercel `x-vercel-ip-country`: KR -> Korean `/`, JP -> Japanese `/jp`, other
   countries -> English `/en`.
3. Missing/unknown country: highest-priority supported Accept-Language preference
   (ko/ja/en); unsupported languages -> English; no usable signals -> Korean.
4. Known search/social crawlers keep the requested root for stable indexing.

Redirects are temporary (307), retain the query string, and are private/no-store.
Korean root responses also disable shared caching and vary on selection inputs.
Automatic choices do not write a preference cookie; explicit selection uses the
existing one-year cookie. Language is never used as a tax/billing-country claim.

## Local verification

94 tests passed across middleware, entry-locale, routing and locale API tests.
Tests cover country mapping, three-language fallback/quality weights, explicit
cookie selection, manual Korean selection without a loop, direct links, crawler
requests, query retention, temporary/private redirects, POST exclusion and HEAD/
prefetch behavior. Supabase session refresh is mocked: no remote DB calls.
Changed-file ESLint, full frontend TypeScript and diff whitespace checks passed.
The initial TypeScript run lacked the existing local PGlite test-tools dependency;
linking the same installed test-tools used by the baseline resolved it. No packages
or remote services were provisioned.

Local machines do not receive Vercel geo headers automatically. Tests simulate
the country header using NextRequest; browser locale is the normal local fallback.
This does not establish live Vercel IP classification. No production deploy made.

For future integration, apply only this commit onto the then-current home/release
baseline; do not deploy this old baseline over ongoing home UI work.
