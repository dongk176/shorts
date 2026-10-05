# Mobile template library and account activity

## Target and baseline

- Authorized production UI follow-up for the two selected audit findings.
- Worktree `.tmp/public-sidebar-20261005`, branch `codex/mobile-library-activity-20261005`.
- Production domain and Vercel project read-back both identify deployment `dpl_FnaDs4Fr6yq6beC2hnxFRcT8iY8a`. The previous release record maps that deployment to `a2ea4aaebfdb97411eb2beee0f2f37dc9c6cb2b1`, the clean starting commit of this branch.
- Project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, team `team_3pn55cGmUE8SRRKg0D3dRiPJ`, root `web`. The candidate uses the existing production project configuration (Supabase `mvcprswvfybudtopepuj`, `shorts_mvp`). No schema, API, credentials, workers, publishing gates or runtime configuration changes.
- Lab is an independent environment and is not the target of this layout change. Local visual verification uses synthetic records with no DB connection or account mutations. Candidate route checks use the actual production project configuration.
- Bounded cost estimate: one existing-project candidate build, read-only page checks, at most one corrective rebuild if needed, under USD 5 expected incremental usage. No new subscriptions or infrastructure.

## Change

- Under 640px, replace the 456px new-template tile with a 48px action below search. Keep the full tile on larger screens. Both presentations share the same login/plan entitlement routing. Keep the compact action available during search.
- Stack template title and search until 1280px, keep Korean words together, and retain the desktop layout at wider sizes.
- Below 1024px, show payment and usage records as cards. Payment cards expose product, amount, status, refund/due-date information and eligible receipt links; a native details disclosure contains order, payment method and transaction identifiers. Preserve enterprise contract fields and receipt eligibility.
- Keep existing desktop tables and API/pagination behavior. Allow mobile tabs and pagination to wrap without page overflow; keep controls at least 44px tall.

## Verification

- Local fixture imports the actual changed components, uses synthetic standard/enterprise/refund payments and usage grants/consumption, and intercepts local API requests. It is removed from application source before the release build; its source and screenshots are retained only in `.tmp/mobile-ui-evidence-20261005`.
- Browser checks: template layout at 390/768/1024/1440px; English/Japanese payment cards at 360px; disclosure with long identifiers; successful receipt eligibility; usage tab and pagination; paid/free/guest template routing and search. No page horizontal overflow in checked states. No browser error overlay or console errors in the initial template check.
- Existing template entitlement/favorite, enterprise billing security and sidebar isolation tests: 29 passed. Existing production release guard tests: 8 passed.
- Full lint/typecheck, local production build, route comparison, unaliased candidate route checks and production read-back must finish before reporting deployment complete.
- Scope is layout and navigation. No charge, refund, video generation, rendering or publication is submitted during verification.
