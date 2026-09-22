# Compact popular discovery UI

Authorized desktop/mobile redesign based on the approved visual mockups.
Isolated worktree `.tmp/popular-ui-20260923`, branch `codex/popular-ui-20260923`.
Live Vercel API read confirmed production deployment `dpl_BWsWHmaFxtC8Ziu7k3eSkuAZA4DM`,
project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, source
`43622d2906a01de9e31867399090635cc3f5b518`. This is the release baseline.
Existing main worktree changes are untouched. No lab services are used.

Changes: compact title/search; two ranking tabs; one persistent reuse toggle;
shared desktop dialog/mobile bottom sheet for category, language, collection
period and length; individually removable applied conditions; one result count.
Search, cards, pagination, current entitlement and CC BY explanation remain.
The reuse condition survives ranking changes, searches and detailed-filter resets.
The API already supports `type=views&reusable=true`; its existing catalog path
provides the former reusable list without a third UI mode. No API/schema changes.

Test configuration: actual modified React component, local fixture responses,
no production credentials in the local UI preview. Mobile 390px and 320px English,
desktop 1280px; dialog apply/cancel/reset, applied chips, focus restoration.
Fixture images are placeholders, not production video evidence. Candidate checks
must separately verify the deployed app with its production configuration.

Mounted tests replace obsolete source-string assertions of the old three-tab UI.
They cover batch filter application, cancelled drafts, reset scope, reuse
persistence, chip removal without losing search, authorization, IME and request
cancellation. Existing full web suite, static checks/build and repository checks
run before release. Local test dependencies reuse existing installed packages.

Release uses existing Vercel production account and production DB configuration
(Supabase `mvcprswvfybudtopepuj`, `shorts_mvp`), but makes no DB/config/worker changes.
Bounded existing-service candidate build and read-only HTTP checks only; no new
fixed commitment. Estimate: one normal web build, no paid AI/video jobs.
Verify route parity, five protected paths and admission fingerprint on the
unaliased candidate, then promote that same deployment without rebuilding.
