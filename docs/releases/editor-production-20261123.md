# Editor recovery release candidate — 2026-11-23

## Target and source

- Target: explicitly authorized production release, after verification.
- Baseline observed at `www.easycut.co.kr`: deployment
  `dpl_C4zob5U1kADUV2BWAVZyNEvnzRGm`, commit
  `2d1577892713631e98ac0a9f79519afe494bc501`.
- Working branch: `codex/editor-production-release-20261123`.
- AWS: `181651591905`, `ap-northeast-2`.
- Vercel: `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`.
- Database: `mvcprswvfybudtopepuj`, `shorts_mvp`.

The recovery worktree at `54a5148b5801523bc7a209e91497870fceb6ae94`
is preserved. Only editor-related fixes are selected here. Its unpublished
project-target registry and unrelated billing, ranking, upload, discovery and
transcription changes are not copied.

## Included fixes

- Accept the two exact, attested prompt-only Japanese template releases in
  the background/template preparation guard, retaining immutable source,
  image, font, document and renderer checks.
- Include `editor_incident_identity.py` in both Batch submitter packages;
  exercise the actual synthesized assets in tests.
- Preserve the renderer fixes already present in the production web source;
  include the observed timeline-deficit regression cases. The web source
  commit does not prove those fixes are in the currently selected worker.
- Require a database-backed public-admission check before a web candidate
  can pass the release preflight. Configuration fingerprints alone do not
  prove that ordinary customers can create projects.

## Deployment blocker: successor admission

The September dual-admission function allows the exact predecessor stable
target during `admin_ready`. The later migration
`20261115145728_project_successor_all_routes_admission_fence.sql` installs an
additional trigger that rejects ordinary users during the same phase.
Its existing executable SQL test reproduces the rejection. The original
successor procedure must not be repeated under the assumption that the
September function keeps public requests available.

The production function body was also read back on November 23 and matches
that all-routes behavior. The observed production state remains `active`,
with public access enabled and canary access disabled. This preparation has
not entered the blocking transition.

No trigger, release-state flag or production target was changed in this
worktree preparation. Do not relax identity checks or simply remove the
all-routes fence. Before any successor transition, prove an availability-
preserving release path against the actual live schema and registered
targets, including specialized routes.

## Verification record

- Focused web tests, run from `web/`: 3 files, 68 tests passed.
- Executable admission SQL and candidate-admission script tests: 12 passed.
- The first `make verify` attempt identified two pre-existing Python
  line-length errors, repaired by the preserved formatting-only fix.
- The lint and type-check stages then passed. Three stale script-test
  expectations were aligned with the preserved production baseline and
  existing attested predecessor/successor font checks; no runtime guard or
  target registry was weakened. The remaining `make test build` completed
  with exit code 0. All required local stages therefore passed:
  - Script tests: 235 passed.
  - Worker tests: 2,172 passed, 199 skipped by their existing conditions.
  - Web tests: 4,587 passed, 183 skipped by their existing conditions.
  - Infrastructure tests: 43 passed.
  - Web production build and production CDK synth: passed.
  - Local build manifest retains `/`, `/guidebook`, `/pricing`, the actual
    administrator route and `/projects/[projectNumber]/edit/[shortId]`.
  - The build reports the existing optional `linkedom`/`canvas` dependency
    warning through `budoux`; it still completes successfully. This local
    build uses the existing dependency installation and is not a deployed
    candidate or a fresh Linux build.
- AWS `get-caller-identity`: session expired; live worker verification and
  dependent deployment actions are blocked pending renewed authentication.
- Previous lab save/re-edit/direct-download evidence remains useful, but
  used different source and configuration. It is not production-candidate
  verification and did not prove the browser download button completes.

## Remaining release gates

1. Commit the locally verified source; keep the current production baseline.
2. Verify refreshed AWS identity, live schema, worker definitions, Lambda
   packages and the unchanged currently promoted web baseline.
3. Prove the transition keeps customer generation available before using it.
4. Verify the exact unaliased production candidate, all five protected
   routes, save/reopen/re-edit/render and the browser download flow.
5. Promote that tested candidate without rebuilding; record actual worker
   identity, web deployment and rollback targets. Preserve referenced older
   targets and images.

Operational status: **not deployed**.
