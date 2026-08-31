# Existing-public Worker successor rotation

This is the explicit, opt-in successor path for the five project targets. The
default Stage B `rotation` still requires the existing stopped rollout. No
command below was executed against production during implementation.

The later upload-lifecycle request explicitly keeps both video-upload flags
false. In that state only, the design ADMIN switch may validate the exact
project/editor runtime without attesting the stopped receiver. PUBLIC and
actual upload E2E remain blocked until separately authorized and verified.
This scoped exception supersedes the both-input ADMIN prerequisites below;
it does not change the Worker successor or upload reopening checks.

## Required inputs and boundaries

- Re-read the promoted Vercel SHA immediately before each phase. Work from a
  clean descendant of that SHA; keep the already-deployed web fixes. Record
  the old deployment ID for reference, not for automatic old-code rollback.
- Supply the real administrator UUID, current stable release UUID and new
  finalized candidate UUID. A tester row or supplied `admin=true` is not enough.
- Require the existing 15 isolated checks, one finalized probe, exact
  source/digest/font/render4+caption4, versioned manifest/matrix/artifact IDs,
  `customTemplateDesign` and registrar-recorded `compatibleSuccessor` evidence.
  Do not insert passed checks or finalize a probe by hand.
- The five new targets must use the same queues, image repository, scheduling,
  font and resource/environment/Secret-reference contracts. The current old
  target becomes `previous` **submitting as itself**, never as the new target.
- Record actual editor+five-project Job Definitions and resource contracts.
  The observed baseline editor is 4 CPU / 16 GiB / FFmpeg 4 threads; the five
  project targets are 8 CPU / 16 GiB. Re-read rather than assume these values.
  Preserve PO enabled, webshare ISP routing, Secret versions/route hashes,
  ingestion, queues, CPU/memory and download behavior.
- Apply additive migration `202608310003_project_target_successor.sql` separately
  before using the updated control tools. The null state is old-compatible.
  No new service or table is introduced. The optional
  `editor_release_state.render_v4_target_successor` field is the durable fence.
- The normal `public_enabled`, `render_v4_internal_enabled`, rollout percentage,
  kill switch and runtime flag are **not changed** by this path. Canary start
  and stable/candidate pointer transitions remain the existing administrator
  actions, with the narrowly verified successor branch.

## Actual build/probe prerequisites still requiring deployment work

1. Build only from each verified runtime baseline plus the reviewed feature diff:
   project/editor Worker baseline `4e19c114…`, receiver baseline `34f0d31…`.
   Do not build the whole Worker directory from the web worktree as a shortcut.
   Receiver and project images remain different immutable releases.
2. Use the existing `.github/workflows/editor-release.yml` flow: one Linux/amd64
   render image with `WORKER_SOURCE_GIT_SHA`, scan, font-manifest verification,
   registrar `startProbe`, actual isolated AWS run, versioned S3 manifest/matrix,
   Chromium parity and registrar `finalizeRelease`. A local synthetic run is
   necessary but is not AWS/finalized evidence.
3. **Confirmed setup blocker:** the workflow still names the previous exact tag
   `editor-v4-render-parity-20260830-4`, and the observed build role is locked to
   `refs/tags/__disabled_editor_release__`. Select a new protected exact tag for
   each actual source commit; align the workflow's tag/conditions, registrar and
   verifier exact-ref contracts and the scoped build/verifier trust using the
   existing reviewed Editor-only renewal procedure. Never move an existing tag,
   admit a wildcard branch, or bypass the workflow guard. No new tag was chosen
   or created by this implementation. After that preparation, dispatch the
   existing workflow with `gh workflow run editor-release.yml --ref <exact-tag>`.
4. The live registrar predates the new design/successor attestation. Deploy the
   reviewed registrar code in the narrow preparatory Editor control-plane
   change before running the new probe. Existing versioned S3
   `GetObject/GetObjectVersion` access to `editor-release-probes/*` already covers
   the new frame artifacts; do not broaden Secret, PassRole or bucket access.
   Background-image storage/read IAM is a separate prefix-only preparation
   described in the feature release plan.
5. Include the reviewed late-duplicate Batch-submitter compatibility patch in
   the control-plane source before making the registry-only commit. The change
   set guard permits the named Lambda code asset and exact target environment,
   not arbitrary resources. If the deployed preparatory state cannot satisfy
   that exact guard, stop and review a narrow compatibility-code preparation;
   do not deploy the full Compute/CDK stack or relax the guard.
6. The workflow serializes candidates, and there is one candidate pointer.
   Finish the project successor's verification/promotion before starting the
   receiver candidate sequence. Follow the separate
   [file-upload successor runbook](file-upload-successor-runbook.md); its public
   nine-check pin and in-flight sessions are never rewritten by this controller.

## Registry-only change and execution

Create a clean preparatory source commit containing the compatible control
tools. Create a child commit changing **only** `production-project-targets.json`
to the five registrar-verified successors. Keep both commits and the promoted
web base. All input hashes below come from the controller's own output.

The existing production DB identity guard and normal Vercel/AWS/GitHub identity
environment are still required. Set them through the established secure
operator environment, not a new environment-sync shortcut. For example, after
assigning the exact recorded values to the task-specific variables:

```bash
successor_args=(
  --phase rotation
  --base "$successor_promoted_web_sha"
  --prior-stage-head "$successor_preparation_sha"
  --head "$successor_registry_sha"
  --worker-image-tag "$successor_current_worker_image_tag"
  --legacy-rerender-image-tag "$successor_current_legacy_image_tag"
  --expected-stable-release-id "$successor_old_release_id"
  --successor-release-id "$successor_new_release_id"
  --successor-admin-user-id "$successor_admin_user_id"
)
node scripts/deploy-stage-b-release-control.mjs "${successor_args[@]}"
node scripts/deploy-stage-b-release-control.mjs "${successor_args[@]}" --prepare
```

Review both exact change sets. Only the designated registrar/submitter registry
assets and exact five-target environment may change; no Queue, Compute
Environment, Job Definition replacement or unrelated Lambda/IAM change.

```bash
node scripts/deploy-stage-b-release-control.mjs "${successor_args[@]}" \
  --execute-editor-change-set "$successor_editor_change_set_id" \
  --expected-registry-sha256 "$successor_registry_hash" \
  --expected-live-template-sha256 "$successor_editor_old_template_hash" \
  --expected-template-sha256 "$successor_editor_new_template_hash"
```

Before this first execution the controller records the actual old registry,
templates and Lambda code fingerprints and commits `phase=fenced`. **New
YouTube/project requests, including old web INSERTs, now fail transactionally
before usage commits.** It then requires zero unsubmitted jobs (including resume
attempts), pending project outbox, incomplete/mismatched project claims and
jobs from an older-than-current generation. If any remain, no AWS execution
starts. Let the original submitter drain them and rerun the same reviewed
execution; inspect stale claims without deleting or reassigning them.

Already-submitted current-generation work continues with its exact AWS ID,
definition, queue and digest. A late duplicate can only complete the existing
atomic binding after `DescribeJobs` proves that identity; it never submits a new
job. Existing resume behavior is retained.

```bash
node scripts/deploy-stage-b-release-control.mjs "${successor_args[@]}" \
  --execute-compute-change-set "$successor_compute_change_set_id" \
  --expected-registry-sha256 "$successor_registry_hash" \
  --expected-live-template-sha256 "$successor_compute_old_template_hash" \
  --expected-template-sha256 "$successor_compute_new_template_hash" \
  --expected-editor-live-template-sha256 "$successor_editor_new_template_hash"
node scripts/deploy-stage-b-release-control.mjs "${successor_args[@]}" --ready-successor
```

`ready` re-reads actual Job Definitions, queue scheduling, both Lambda code
checksums/source/registry/environment and stable CloudFormation templates. It
cannot accept a caller-supplied `passed` flag. It records `admin_ready` only
after the lease is gone, the frozen proof/flags still match and drains are zero.

## Administrator verification and activation

1. In a separate clean web continuation commit, update the production Worker
   manifest to the actual new immutable release; the registry-only rotation
   commit must remain unchanged. The existing project-target environment sync
   command requires manifest, registry and live Lambda agreement. Do not sync
   proxy/token Secrets or reuse stale web target values.
2. Deploy an unaliased, compatible web candidate from that continuation. Verify
   protected routes and only the approved route additions. Keep the controller
   worktree pinned to its original registry-only HEAD and the still-promoted
   web base during the next three steps.
3. Use the existing administrator **preserved canary start** action. It sets
   canary state transactionally and verifies
   `editor_target_successor_admin_release(actual_user_uuid)`. The usual
   `internal=false` remains unchanged. Only actual administrators with the
   exact new binding can create/edit in `admin_ready`; general users receive
   a no-charge retry response during this brief handoff.
4. Keep the combined design feature OFF at this first Worker handoff. Perform
   the real existing canary checks: ordinary VOD, download, edit/reopen, no-op
   edit and old paths. The new background/text renderer must already have its
   finalized isolated proof. Its actual product-flow tests follow the receiver
   handoff: the ADMIN switch intentionally requires both runtime families to
   support the new format, so an old receiver cannot be bypassed here. Do not
   manufacture success evidence. The receiver has its own sequence and nine-check
   pin.
5. Use the existing **preserve-public promotion** action. It re-verifies the
   actual administrator, finalized proof, recorded predecessor, current
   candidate and preserved public values. Then run, while the old web alias is
   still the recorded `--base`:

   ```bash
   node scripts/deploy-stage-b-release-control.mjs "${successor_args[@]}" --complete-successor
   ```

   The DB records `active` with the new exact release/registry after observing
   live AWS again. Old web target pins remain blocked. Even a new target with
   missing v4 environment cannot create a legacy job for a DB-selected public
   v4 user; deliberate kill/runtime/public OFF or nonselected rollout users
   retain the existing legacy policy.
6. Promote the already-tested exact Vercel deployment without rebuilding, with
   the combined design feature still OFF. Complete the receiver handoff next.
   Once both runtime families are verified, enable ADMIN and perform the real
   new-background/text save → generate → download → re-edit → reopen flow on
   both YouTube and file upload. Only then use the design PUBLIC switch.
   Monitor each handoff and the design release for 15 minutes.

## Failure and recovery

### Restarting after an explicitly cancelled attempt

- Keep the executed change sets and the cancellation audit intact. A completed
  change set cannot be executed again, and its deterministic name must not be
  reused by deleting the historical record or relaxing the provenance guard.
- Re-read the current promoted web baseline, actual predecessor runtime and
  `active / outcome=cancel` pin before preparing a fresh attempt. Record the
  new authorization in the preparation history, then make a new registry-only
  child commit containing the same reviewed target transition when its actual
  finalized evidence still matches. The new exact HEAD provides independent
  change-set provenance; it does not authorize different images or settings.
- The existing guarded begin operation must create a new operation UUID and
  re-observe the predecessor. Do not reuse an old fence or edit its JSON.
  Build the web continuation from this new registry-only commit, retain all
  previously verified fixes, and keep both video-upload flags false when the
  user has requested uploads remain stopped.

The 2026-09-01 continuation was authorized for the exact 40 project-target
identity/version settings in the existing `artiroom/shorts` Vercel project.
Its predecessor remains the promoted web `845738f3598ed2dee414be30542853a25189627d`
and stable Worker `4e19c114f79e74a73a4798f3fd898fa412967cc2`. No payment secret,
proxy/IP/token setting, queue or resource change is part of that authorization.

- A failed execution, process crash, DB disconnection or two-hour lease expiry
  **never clears the durable fence**. Lease release only clears lease fields.
  A legacy lease cannot acquire/renew through `fenced`/`admin_ready` to reopen
  old targets. Retry the same verified operation after reconciling real AWS
  terminal state; do not update the state JSON manually.
- To close administrator admission during a retry, use
  `--fence-successor`. This closing-only action is allowed even when an
  emergency stop changed public runtime flags. It does not resume anything.
  Frozen-flag/proof mismatches block all reopening actions.
- Prefer finishing the approved forward rotation. `--cancel-successor` is
  available only before stable promotion and only after the predecessor's
  exact registry, both original Lambda code hashes and both original
  CloudFormation templates are actually restored, with candidate DB jobs and
  observed AWS candidate jobs at zero. The tool does **not** restore AWS for
  you. It records an `active` predecessor pin, not a null/unfenced state.
- Once new stable promotion is complete, cancellation to old stable is not an
  allowed shortcut. Disable new design usage if needed, retain compatible web
  reads/new assets/documents/in-flight jobs, and investigate the specific error.
  One unrelated transient 504 does not trigger whole-system or Worker rollback.
- Keep measured old/new snapshot fingerprints, exact change-set IDs/hashes,
  probe artifact versions, audit entries, real test results and the promoted
  deployment ID together. Credentials and Secret values must never appear in
  those records.
