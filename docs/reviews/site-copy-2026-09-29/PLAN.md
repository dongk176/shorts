# Site copy and localization release

User authorized UI/copy changes and production deployment on 2026-09-29 after reviewing the 15-point site feedback document.

- Production baseline: live domain and Vercel project target both resolve to `dpl_273JQuHH7kfu3FSSUSfK1dcHNvok`, source `a2f9b90b18f3bbba5b4f88262c6fb39d50bf41f3`, READY/PROMOTED.
- Isolated checkout: `/Users/gimdongmin/.codex/worktrees/site-copy-localization/shorts-clean`, branch `codex/site-copy-localization-20260929`.
- Existing production Vercel project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, owner `team_3pn55cGmUE8SRRKg0D3dRiPJ`, root `web`, Node 24. Production service dependencies remain the existing Supabase `mvcprswvfybudtopepuj` / `shorts_mvp` and registered AWS `181651591905` workers. No DB/schema, worker, runtime configuration, billing computation or lab change is needed.
- Read-only production job-admission preflight matches all five registered targets, fingerprint `c485ae2b45ae841824247ec70de875adf9b84942a6b8035c3c9464b779bb6ef5`. Exact image digests and revisioned ARNs remain in unchanged `production-project-targets.json`.
- This is a production code candidate using the existing production project's configuration, not a lab build or test against lab. No lab resources or credentials are needed. Local checks prove frontend behavior/build and route preservation; remote candidate checks prove actual configured page delivery and admission configuration. They do not re-test paid generation or payment execution.

## Changes

Remove the duplicate transformation headline in all three languages and close the resulting whitespace, preserving an accessible section name. Make the primary hero explain the generated result, with visible description and a short three-step hint. Preserve the existing authenticated recent-project placement and ownership confirmation.

Use `リアルタイム急上昇` consistently for the Japanese navigation/feature name. Show the existing computed discount percentage on the package badge, with the existing comparison basis retained. Keep the full brand-color label on one line, moving controls beneath it on narrow screens. Refine the Japanese conversation copy and explain the comment overlay template and AI-written content explicitly.

Align range-guide processing allowance wording and distinguish charged video duration from waiting time. Localize Korean review names by phonetic Japanese/Latin transliteration, retaining original identity, ratings and testimonial claims, the Korean-original notice and original toggle. Improve selected English/Japanese review translations without fabricating local customers. A separately produced tutorial video is outside this copy release; the existing three-step section, real sample videos and improved inline hint provide the immediate explanation.

## Validation and release

102 relevant existing frontend tests and 8 release guard tests passed. Full frontend lint and local Next.js production build (including type checking) passed. Dependency lockfile is identical to the exact production source checkout used for the baseline route manifest. The local build retains the existing optional linkedom/canvas warning and requires verification on the actual remote candidate with production runtime configuration.

Compare the full route manifest with the exact production baseline, require clean committed source and no unfinished YouTube publishing/calendar artifacts, deploy with no domain assignment, verify protected routes and all locales plus browser/mobile appearance, recheck that the live production baseline has not advanced, then promote the identical deployment without rebuilding.

Estimated ordinary test cost: one local build, one bounded existing-project cloud build and a small number of read-only HTTP/browser checks; allow at most two correction builds if needed. No paid generation, new resources or recurring commitments. Evidence outside Git: `/private/tmp/easycut-site-copy-20260929/`.
