# Official blog release — 2026-09-13

Authorized scope: add and publish the official EasyCut blog with all prepared
EasyCut articles, using the existing home sidebar and no new navigation entry.

## Source and execution configuration

- Worktree: `.tmp/official-blog-20260913`.
- Branch: `codex/official-blog-20260913`.
- Actual promoted baseline: `533cc5b6864e245241e2119e17f5d2c2f5c8ba51`.
- Baseline deployment: `dpl_Gw4rkt3NeBsXejRgd7PFNWjfAVYD`, verified via the
  `www.easycut.co.kr` domain, deployment API and CLI.
- Target: existing production Vercel project
  `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, team `team_3pn55cGmUE8SRRKg0D3dRiPJ`,
  Next.js 15.5.20, project root `web`, Node 24 runtime.
- Local verification has no cloud service configuration; it proves anonymous
  blog rendering and navigation. The final unaliased candidate uses the existing
  production project's runtime configuration. No DB schema, worker, queue,
  subscription, or infrastructure changes are required. No lab deployment is
  used as a substitute for production-candidate verification.
- Existing production DB identity is `mvcprswvfybudtopepuj` / `shorts_mvp`.
  This change adds no database calls or writes. The authenticated layout is
  reused; article data and image assets are repository-owned static content.

## Change and checks

- 32 versioned posts, 70 optimized public images (about 4 MB total).
- Six historical price comparisons revised to distinguish public/account price
  differences. Twelve Naver reservations remain independent and unchanged.
- Server-rendered text, self-canonical URLs, article-specific metadata,
  BlogPosting and breadcrumbs, sources, author/editorial disclosure, and all
  33 blog URLs in the sitemap. No cloaking or ranking promises.
- Existing sidebar reused with no added menu item. Product announcements do
  not interrupt blog reading. Topic filters, related links, desktop article
  outline, mobile wrapping, keyboard focus and a skip link are provided.
- The release allowlist adds exactly `/blog/page` and `/blog/[slug]/page`.
  All existing protected routes and publishing-experiment exclusions remain.
- Local build/lint passed; 36 relevant existing web tests and 6 release-guard
  tests passed. Anonymous HTTP checks passed for all 32 complete bodies,
  metadata/source links/images, 404 handling and sitemap entries; Googlebot,
  OAI-SearchBot, Bingbot and ordinary requests receive visible article text.
- Images visually reviewed in contact sheets; all 70 scanned for email/account
  identifiers. No flagged account identifiers. Source assets were already
  cropped for publication; no mailbox or full-account screenshots were copied.

Local evidence and migration tooling are under `output/official-blog-20260913`
in the original workspace, not in public assets. Candidate and promotion checks
are recorded there after deployment. A bounded existing-project web build is
within the standing usage authorization; no new recurring resource is created.
