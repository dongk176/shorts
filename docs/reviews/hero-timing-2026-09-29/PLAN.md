# Five-second, softer homepage headlines

User requested less frequent, less abrupt rotation, then explicitly chose five seconds. Existing production deployment authorization continues.

Code baseline is verified promoted source `30eaa179d634f0f5ee3e360416d8dacf034ce04a`, deployment `dpl_3TfwffDp6nhsFRJYEzwKLKm9sEy8`. Reuse the clean attached worktree at `/Users/gimdongmin/.codex/worktrees/site-copy-localization/shorts-clean`, branch `codex/home-hero-timing-20260929`. The previous documentation-only commit remains on its original branch.

Target configuration remains production Vercel project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, team `team_3pn55cGmUE8SRRKg0D3dRiPJ`, root `web`, Node 24; existing Supabase `mvcprswvfybudtopepuj` / `shorts_mvp`, AWS `181651591905`. This is timer/CSS-only work plus existing regression-test updates; no API, schema, worker, environment or lab changes. A local component harness tests the actual rotating component without account mutation; the production candidate uses existing production configuration. No lab verification is claimed.

Set rotation interval to 5000 ms. Fade outgoing text over 400 ms before hiding it, then fade the incoming text in over 600 ms. Preserve reserved layout, pause, reduced-motion behavior, anonymous fallback, occupations, copy and translations.

Validation: existing component timer, pause/resume and accessibility regression tests, actual browser animation/layout inspection, frontend lint/build, baseline route manifest comparison and release exclusion guard. Deploy a committed clean unaliased candidate, verify protected paths and admission fingerprint, confirm unchanged live baseline, and promote that exact candidate. Browser verification uses a fixture for personalized copy; anonymous live checks do not prove live authenticated occupation selection.

Cost estimate: one local build, one existing-service cloud build and bounded read-only checks, at most one correction build if necessary. No generation jobs or new recurring resources. Evidence: `/private/tmp/easycut-hero-timing-20260929/`.
