# English and Japanese public showcases

Source baseline: promoted production commit `81ff31b96fee7b55f33c011c0d806ec63e30f894`.
Candidate worktree: `.tmp/localized-showcase-20260920`, branch `codex/localized-showcase-20260920`.
Target: authorized production website media and four new curated examples, using existing production services.
AWS account `181651591905`, Vercel project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, Supabase project `mvcprswvfybudtopepuj`, schema `shorts_mvp`.

## Selection

The audience is teens and people in their twenties. Selection balances youth relevance,
recent uploads and views among videos already present in Easy Cut's reuse-allowed catalog.
This is editorial audience suitability, not a claim of verified private demographic analytics.

YouTube Data API video and channel metadata checked on 2026-09-20; all four videos reported
`creativeCommon`. Keep author, original title, source link, license and modification notice
visible through the localized Video credits disclosure. AI comment overlays are identified as generated.

| Locale | Creator | Video | Published | Views at check |
| --- | --- | --- | --- | --- |
| English | MMG | LOoynSCSLfI | 2026-08-31 | 1,055,167 |
| English | Kenny For Real | 4MQsBkiuI6Q | 2026-09-07 | 441,307 |
| Japanese | ありさか/Arisakaaa | hNZH25A3qYw | 2026-09-15 | 246,128 |
| Japanese | 須貝駿貴 (QuizKnock) | jigMrhZfuOs | 2026-08-02 | 63,413 |

Audience evidence: [Google's MMG sports fandom article](https://business.google.com/uk/think/search-and-video/youtube-creators-redefining-sports-fandom/),
[NBC Sports' Kenny Beecham announcement](https://www.nbcsports.com/pressbox/press-releases/enjoy-basketball-partners-with-nbc-sports-bringing-top-nba-creator-kenny-beecham-to-its-platforms-ahead-of-historic-return-of-nba),
[Crazy Raccoon](https://crazyraccoon.jp/),
[University Co-op's Sugai interview](https://www.univcoop.or.jp/growth/action/interview/sugai_01.html).

## Behavior

English and Japanese pages select their own OG image, showcase stills, transformation video pair
and public example projects. Existing Korean assets remain the Korean selection. User-owned
projects remain accessible regardless of page language. Legacy examples with no output language
are treated as Korean. Public project-list caching includes the locale.

Stills and synchronized muted 15-second demonstrations come from the actual generated output
and its corresponding clean clip. No full source video is retained in S3. Curated output retention
uses the existing lifecycle-exempt `examples/` convention, leaving ordinary retention unchanged.

## Verification

Verify localized first server renders, metadata, authenticated/public API responses and locale-bound
example queries, plus type checking, lint and production build. Check the actual unaliased production
candidate, protected routes and job-admission preflight before promoting the same deployment.

Verified locally: 2,814 web tests passed (132 skipped); after direct-ID access regression coverage, another 166 relevant tests passed. Type checking, ESLint and production build passed. Candidate and production source route manifests both contain 201 routes, with no removals and no publishing experiment routes. Production job-admission endpoint reports ready=true with five targets.

New project numbers: English 14459 / 14464; Japanese 14465 / 14470. Production public-example activation is deferred until the candidate is ready.

Browser verification found that an initial localized render could be replaced by the cookie's Korean
examples during polling. Home refresh and project pagination now send the current page locale explicitly;
API regression coverage verifies Japanese requests with a Korean cookie preference. Final checks:
2,816 web tests passed (132 skipped), type checking and ESLint passed. Both demo pairs are exactly
15 seconds at 30 fps, with no audio track. All 36 generated shorts completed; source cleanup recorded.
