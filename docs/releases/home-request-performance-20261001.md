# Home request performance — 2026-10-01

User authorized all six proposed improvements. Target: production web changes from the currently promoted commit `96333ef92b2b24692313d75d45c77f1b801eee9e`, deployment `dpl_J3bBgco3RwuxkpnertT3j15euK7r`. Isolated worktree: `home-request-performance`, branch `codex/home-request-performance-20261001`. Existing dirty source and lab work are preserved.

Production configuration is inherited from Vercel project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, team `team_3pn55cGmUE8SRRKg0D3dRiPJ`, root `web`. Production Supabase identity is `mvcprswvfybudtopepuj` / `shorts_mvp`; no schema, worker, billing or environment configuration changes. Lab is a separate code/configuration environment and is not used as production verification. CLI-pulled sensitive environment values are unavailable locally, so local builds validate compilation and route parity; actual runtime checks use the production-configured unaliased candidate.

Changes:

1. Reuse server home state for the same locale when less than 30 seconds old. Missing/expired state retains client retry; account/locale changes get a separate component instance. Explicit mutations and job-completion refreshes remain.
2. Wait until the first one-minute refresh when valid public metrics were server-rendered. Missing data and visible-tab recovery still fetch immediately; animation keeps the server clock.
3. Disable menu/brand/footer prefetch for database-backed pages while preserving normal navigation and static guide prefetch.
4. Skip session refresh for allowlisted public images and font directories, after canonical-host and locale validation. Arbitrary dotted application paths still authenticate.
5. Share pending template reads and apply a 30-second cooldown to passive events. Writes/library-change events bypass the cooldown and queue a fresh read if necessary. Disposed account requests cannot apply results.
6. Cache only public recent-update dates for 60 seconds, coalescing concurrent database reads. Successful publish/hide invalidates the tag; draft saves and failed transactions do not. HTTP responses remain no-store.

Validation before candidate deployment: web lint and typecheck; full web suite 3,481 passed / 145 intentionally skipped (opt-in integration suites); four additional publication invalidation tests passed; eight existing route-release guard tests passed; production build successful. Existing optional canvas warnings originate from the Budoux/linkedom dependency. No package versions changed. Production baseline route manifest was copied from the clean worktree at the exact promoted commit. Worker/target manifests are unchanged; live canonical admission reports ready with five targets and matching fingerprint.

Release procedure: commit clean source, run existing route parity/release guard, deploy without assigning domains, verify home/guidebook/pricing/admin/editor plus metrics, updates, assets and admission identity. Verify the live production commit again before promoting that exact candidate without rebuilding. Private editor/admin content requires application authentication; anonymous redirects only establish route/auth boundaries. No actual generation, payment or publication mutation is part of this check.

Bounded estimate: one hosted build and a few dozen read-only requests, under USD 2 on existing services; no new recurring infrastructure. Runtime evidence is stored in the worktree's ignored `.local-review/performance` directory. Request reduction is verified separately from real-user latency; no specific LCP/INP improvement is claimed without measurements.
