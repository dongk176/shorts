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

## Final verification and release

Full web suite: 3,028 passed, 139 conditional skips. All 209 repository script
tests, worker tests/static checks, 36 CDK tests and production-context CDK synthesis
passed. Frontend lint, type checking and production build passed. Initial local
integration tests could not find the existing PGlite dependency; linking the
existing test runtime fixed this, after which the complete suite passed.

Initial UI source `524f4ba17a179c600fa4ddd54161063859d1cc77` was promoted as
`dpl_HjEgq8PmAuKiUFASY8zHByAXebHM`. Actual app-shell visual inspection found the
global `main > section` style adding an unwanted panel and 22px padding. Final
source changes only that wrapper to a named region div; no global styles change.
The local visual check was repeated with the real app-shell classes, and final
lint/type checks, all 10 mounted search/filter cases and production build passed.
Unchanged worker/CDK/backend tests were not repeated for this wrapper-only fix.

Final application source `f0dfa82cc1b8862fa5d91dc061bc23fa5ba96285`, deployment
`dpl_7VjqumyfPYZNQLwXW3ZoqN3Ammn9`, candidate
`https://shorts-jz1josowc-artiroom.vercel.app`. Actual output manifest matches all
462 production outputs / 230 routes. Both candidates started with no aliases;
each baseline was rechecked immediately before promoting that exact deployment.
Production domain now resolves to the final ID. No rebuild during promotion.

Final candidate and production both passed protected-path checks (anonymous admin
login entry and owned reviewer editor), five-target admission fingerprint, search
and next page, literal wildcard/length validation, unauthenticated rejection, and
CC-only items in both ranking modes. Existing reviewer access was reused.
The final typo query returned 239 results; both reuse modes returned 12,451.
The candidate browser required Vercel SSO; verification used the existing CLI
access without changing deployment protection. Final public production UI was
visually checked in the signed-in browser at desktop and 390px mobile. First card
starts around 246px desktop / 355px mobile, versus about 579px / 479px before.
The real mobile filter dialog and applied category/language chips also worked.

Two bounded Vercel builds used existing resources; no fixed-cost resource or plan
change. Temporary local servers stopped, test login cookie files removed, browser
viewport overrides reset and task-created tabs closed. Evidence JSON contains
only sanitized check outcomes, not credentials or private fixture identifiers.
