# Public page desktop sidebar repair

## Baseline and environment

- Authorized production UI change. Worktree `.tmp/public-sidebar-20261005`, branch `codex/public-sidebar-20261005`.
- Vercel project API confirms current promoted deployment `dpl_HAcqfBW8gSSKB6QSa15UQYaA81RK`, source `a9761f9746a7cc9520e59db5cf721c5725fd8de8`, project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, team `team_3pn55cGmUE8SRRKg0D3dRiPJ`, root directory `web`.
- Candidate uses that exact source baseline and the existing production project configuration. No environment variables, DB/schema, AWS resources, workers, publishing code or maintenance gates change. Lab is independent and is not the verification target.
- Bounded verification: local static checks/build and existing focused tests, one Linux Vercel candidate build (a corrective rebuild only if necessary), read-only page checks. Estimated incremental metered usage below USD 5; no jobs, payments or infrastructure purchases.

## Findings and scope

- The live guidebook reproduced broken desktop navigation labels because the dense legacy horizontal navigation is still selected.
- Convert all five remaining `SiteHeader` callers without desktop sidebar: AI Shorts guide, guidebook, tool comparison, FAQ, and the currently hidden team page. Keep the team visibility gate.
- Convert the shared LegalDocument shell: terms, privacy, purchase/refund documents including versioned and enterprise documents, partner terms, and customer support. Keep document text, copying protections, localized links and home action.
- Existing home/projects/templates/pricing/popular/saved videos/channels/shorts guide/updates/blog/settings/activity/private pages already use the sidebar.
- Editor and template editor topbars are editing controls. Checkout, enterprise payment, creator share and partner portal/application headers are dedicated workflows with short contextual controls, not the overflowing global navigation. Keep those controls and access boundaries.
- Locale-prefixed rewrites share these page implementations, so Korean, English and Japanese receive the same fix.

## Verification

- `make lint` includes Python static checks, web ESLint and TypeScript.
- Existing legal/footer/SEO/sidebar-announcement tests: 34 passed across 6 files.
- Existing release guard tests: 8 passed.
- Candidate route manifest must preserve all baseline routes and the existing release guard. Compare actual Vercel lambda paths as well.
- Check the actual unaliased candidate before promotion: home, guidebook, pricing, administrator login boundary, editor route, affected footer pages and desktop/mobile sidebar interactions. Promote that exact deployment without rebuilding.
- This is navigation/layout verification, not video generation, billing or worker execution verification.
