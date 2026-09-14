# Scheduled Naver articles on the official blog

The user requested adding the Naver-reserved articles to the official site.
This imports the 99 verified new articles from series-04, alongside the existing
32 articles. The remaining 111 Naver drafts are outside this import. Existing
slugs and the Naver publication schedule are preserved.

Baseline verified through www.easycut.co.kr: deployment
`dpl_DRMxgGwryLmuG3REZN1R3SkXp6Rz`, source
`1587902925f27d2b6180a2056820c8ff5fdc0b5f`.
Worktree: `.tmp/blog-reserved-import-20260914`, branch
`codex/blog-reserved-import-20260914`.
Target: existing production Vercel project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`,
team `team_3pn55cGmUE8SRRKg0D3dRiPJ`, root `web`, Node 24.
Local checks use no cloud credentials. The unaliased production candidate uses
the existing production configuration (DB `mvcprswvfybudtopepuj` / `shorts_mvp`).
No new database, worker, queue, billing or infrastructure mutation is needed.

Each article has reviewed text, generated topic artwork with an AI caption,
source links where applicable, author attribution, unique URL and article
metadata. Article 29 also reuses the privacy-reviewed upload screen already
published on the site. Images are optimized for web delivery without changing
their content. Public assets contain no local paths or private account data.

Publication is evaluated on each server request. Future articles are excluded
from the catalog, JSON-LD, related links and sitemap, and direct article access
returns not-found. Server-only article data is not sent wholesale to a client
component. Scheduled articles open at their stored Korean-time instant without
a new deployment or a local computer task. Images alone are ordinary public
topic illustrations; they do not reveal future article bodies.

Before promotion, compare the exact candidate's route manifest against the
current production baseline, check all five protected pages, verify registered
job-target admission fingerprint, and promote the tested deployment unchanged.
No new navigation entry is part of this change.

Validation before candidate upload: web lint, optimized Next.js build, four
publication/route tests passed. All 131 local routes were checked: 35 public
articles had complete server-rendered text/metadata/images and 96 future articles
returned 404 with noindex and no body. Catalog/sitemap excluded future posts.
Original 32 article records are unchanged; all referenced assets exist and future
article bodies are absent from browser JavaScript chunks. The 197-route manifest
retains the production route set (the intervening baseline changes modify existing
API files only). Desktop article layout reviewed in Chrome.

Cost scope: one existing-project Vercel candidate build and bounded read-only
HTTP/image checks (about 15 MB new web assets, expected below USD 1 of ordinary
metered build/transfer usage). No fixed commitment or paid resource is created.
