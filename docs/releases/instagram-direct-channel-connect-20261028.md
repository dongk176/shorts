# Instagram direct channel connection — 2026-10-28

Scope: user-authorized production fix and release. Allow Instagram connection from channel management without an existing project or finished short.

Baseline: promoted deployment dpl_6pqDAMPqXsHmt83sg4jTugpHWomV, source a69351888547d236d4c3d5602f2c6afc6fc1fb42, Vercel artiroom/shorts prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw. Isolated branch codex/instagram-direct-connect-20261028. Production configuration remains production Supabase mvcprswvfybudtopepuj / shorts_mvp; this is not a lab release. No migration or worker change is needed: existing meta_oauth.short_id is nullable and MetaStore already supports channel return paths.

Changes: reuse the existing Instagram panel for account management, list account connections without a short, allow OAuth from exactly the localized channel pages, and return there after callback. Existing project source validation remains mandatory for preview and posting. Threads still requires its existing short context. State expiry, session binding, account ownership, token encryption, disconnect cooldown and publication consent remain in place.

Validation: 39 focused component, HTTP and isolated PostgreSQL/provider-protocol tests passed, including a user with no projects, localized callbacks, unrelated-user isolation, invalid return paths, direct connect request and existing upload regressions. React checklist reviewed: unconditional hooks, primitive dependencies, existing fetch lifecycle and semantic account controls.

Release plan: one unaliased production build, compare actual baseline/candidate route inventories and required routes, verify HTTP responses, then promote the exact candidate. Existing services only, bounded builds and reads; expected ordinary testing cost is a small number of Vercel build minutes. No real social post is needed for this change.
