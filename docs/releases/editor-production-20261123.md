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
- AWS `get-caller-identity`: the initial session expired. Renewed authentication
  subsequently confirmed production `181651591905`; see the live evidence below.
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

## Editing-only continuation after renewed production authentication

AWS STS confirmed account `181651591905`. The promoted web still resolves to
`2d1577892713631e98ac0a9f79519afe494bc501`. Live Batch definitions confirm the
old editor digest `sha256:38dd00e495cd2abde5dcd5692e14b4c3e2a0f9bfb033c0fb554a831f9028599d`
and the existing verified candidate digest
`sha256:b2391bed81ca493e2a99db8c1798aaae2400ce7fc4fd7e7475786a2c5300c4d2`.
The existing editor submitter accepts revisioned editor definitions from the
release catalog and dispatches internal renders to the separate canary queue.
Its IAM simulation permits the candidate definition and the required queues.

Use a separate, owner-bound **editing-only** successor instead of rotating
generation targets. The additive migration and web resolver:

- Leave global stable/candidate pointers, project registries, generation
  admission, all existing public flags and specialized editor bindings intact.
- Default to no successor; require explicit deployment opt-in and its exact
  source SHA. Only ordinary owned YouTube shorts on the stable v4 editor qualify.
- Reuse the finalized-artifact, exact predecessor and fifteen isolated-check
  attestation; freeze that proof and the baseline flags. Require identical UI,
  document and font capabilities. A changed baseline disables selection.
- Initially admit only enrolled administrator testers. Public activation
  requires the existing five production-canary checks from one exact web
  deployment and completed successful candidate renders, with no failed or
  pending renders. The database independently validates new request bindings.
- Preserve old open editors and already submitted requests. Turning the
  editing-only successor off returns new page loads to the current stable
  editor without changing generation or cancelling existing renders.

The candidate image was built from `43fd759084b49f1bbc13aff609332b646fb7f534`
on the same production baseline during the original recovery. Its editor and
caption renderer sources equal this candidate's renderer sources. Other worker
differences concern generation transcription errors; this release does not
route generation to that image. Preserve its existing finalized 69-frame and
15-check evidence and verify its actual editing flow again before activation.

Bounded production verification plan: one administrator-owned generation from
the already authorized four-minute source range, two sequential edit renders,
one comment regeneration, reopen/download and rollback checks. Use existing
queues and storage; no new recurring resources. Limit generation observation
to 15 minutes and each test render to 10 minutes; investigate a failure rather
than creating an unbounded retry loop. Only test-owned jobs may be cancelled.
Estimated metered work: one short source analysis plus under one hour of
4-vCPU rendering; no extra cost approval is needed under the standing scope.

The editing-only SQL tests execute the migration in isolated PostgreSQL and
exercise ownership, specialized-project exclusion, immutable identity, rollback,
privileges, and public activation evidence. All eight passed. The updated full
suite passed 243 script tests, 4,596 web tests (183 existing conditional skips),
and 43 infrastructure tests; worker tests completed successfully. Final build
and exact deployed-candidate verification are recorded separately.

Candidate configuration is explicit: `EDITOR_RENDER_SUCCESSOR_ENABLED=true`
and `EDITOR_RENDER_SUCCESSOR_SOURCE_SHA` equal to this release's committed web
source. Register the same SHA with `configure_editor_render_successor` only
after the final candidate is built. Preserve these two non-secret production
settings after successful verification so a later unrelated deployment does
not silently select the predecessor worker. The source setting identifies the
verified introduction of this editor binding; it is not a claim that future
web commits have been tested here.

Rollback uses `configure_editor_render_successor(...,'off')` and, if needed,
the previously promoted web deployment. It changes no generation flags and
does not cancel already-submitted renders. Public activation requires the five
checks from the exact deployed candidate plus its actual completed canary
render. No production-canary check may be recorded from the earlier lab run.
