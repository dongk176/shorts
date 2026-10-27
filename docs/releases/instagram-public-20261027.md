# Instagram public release — 2026-10-27

Scope: release approved Instagram connection and Reels publishing to active EasyCut members, with the same paid publishing entitlement as TikTok. Preserve Threads administrator/reviewer-only access and all YouTube maintenance behavior. The user will perform real social posting.

Production source baseline verified from promoted deployment `dpl_3qVUNPFq6omrkvwGxcRQTjX8uUzP`, commit `31c51a1bfec2c37a68ed639ae5a34a1aebc734cf`. Isolated worktree `.tmp/instagram-public-20261027`, branch `codex/instagram-public-20261027`. Target Vercel artiroom/shorts `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, production Supabase `mvcprswvfybudtopepuj` / `shorts_mvp`. No migrations, worker revisions, AWS capacity changes or lab resources.

Meta app `2307294366687280`: Instagram basic and content publishing approved October 25; Threads permissions rejected. Instagram Login product ID `1116489420856814` verified in the Meta portal October 27. Existing OAuth protocol remains supported in the portal; migrating to Unified Login is outside this release.

New server flags: `INSTAGRAM_PUBLISHING_MODE=public`, `INSTAGRAM_APP_REVIEW_APPROVED=true`. Existing `META_PUBLISHING_MODE=admin-review` remains required. Public access additionally requires the exact production Vercel/database identity and approved Instagram product ID. No new OAuth scopes. Store access, media capabilities, account ownership, video expiry/deletion, session binding, explicit consent and idempotent publishing remain enforced. Unpaid members cannot create new publications; account disconnection stays permitted. Threads SQL and service checks remain role-bound. Secrets stay server-side and encrypted; no browser Data API grants, user metadata permissions or RLS changes.

Local validation uses the candidate code with isolated PGlite, synthetic local media and a fake Meta protocol provider, without production secrets. It proves role/owner/paid access, consent, media revocation and duplicate prevention, not real provider publication. Production secrets are not pulled; the unaliased candidate is built by Vercel with existing project settings and two explicit nonsecret release flags. Production environment values marked sensitive cannot be read back; the candidate's config gate will enforce the approved app identity at runtime.

Expected incremental cost: one normal Vercel build (bounded retry on build failure); no new recurring resource. Meta app publication and exact candidate promotion follow verification. Real account publication remains for the user.

Validation: 125 social-publishing/UI tests passed across 17 files; TypeScript passed. React checklist: server-derived platform flags, parallel server reads, no new effects, unchanged dialog accessibility and explicit post consent. Supabase checklist: parameterized owner-qualified SQL, current active-user checks, no client credentials or grants. Changelog reviewed; no affected ltree/pgcrypto/btree_gist features are used by this change.

`make lint WORKER_RUFF=/Users/gimdongmin/shorts-clean/worker/.venv/bin/ruff` passed (worker/Lambda Ruff, full frontend ESLint and TypeScript). The initial default command lacked a local Ruff executable; reusing the existing installed checker resolved that tooling issue.
