# Verified file-upload receiver successor

This is an operator runbook, not evidence that a production handoff or the nine
production acceptance checks have run. Local synthetic tests do not pass those
checks automatically.

## Scope and invariant

The upload receiver runs `worker.project` directly and has its own immutable
source/image identity. Build its bounded rendering patch from its actual
deployed source, independently from the ordinary project Worker and web source.
Preserve receiver shutdown, concurrency, channel visibility, task resources,
secrets, token material, proxy policy and upload limits.

The existing `file_upload`, `file_upload_public`, and
`file_upload_emergency_stop` flags are never changed by the successor RPCs.
Published check rows retain their old identity, pass/fail values and observation
times until the final atomic promotion. No old upload session or job is rebound.
The nullable `file_upload_release_checks.successor` column is an operational
handoff fence, not another public feature flag.

## Sequence

1. Apply the additive schema and deploy a compatible web reader with the new
   design feature still off. Keep the current upload receiver identity in that
   deployment. Verify ordinary uploads and the protected web paths. A DB
   INSERT-only fence also stops old candidate web URLs from creating upload jobs
   after the handoff starts.
2. Register a separately verified successor receiver release using the existing
   release registrar. It must have the exact existing fifteen isolated checks,
   finalized versioned probe evidence, the attested `customTemplateDesign`
   result, render/caption versions **4/4**, and the **same font manifest** as the
   currently pinned receiver. Do not mark unfinished tests passed.
3. Call `begin_file_upload_successor(expectedReleaseId, expectedSourceGitSha,
   expectedImageDigest, successorReleaseId, adminUserId)`. Use a fresh read of
   the current published runtime check, not a remembered identity. The RPC
   compares all three expected values and returns a unique successor operation
   ID. New upload admissions now fail before a job or usage reservation commits.
   Link-created jobs and already-admitted uploads continue normally.
4. Drain existing work without cancelling or rewriting it. Check **waiting and
   granted capacity**, live `awaiting_upload` sessions, all `claimed` sessions,
   active upload jobs, DynamoDB claims, protected ECS tasks, and old/draining ALB
   targets. Completed capacity rows may retain `granted`; they are not live when
   their matching upload session is terminal. Do not use only “active jobs = 0”.
5. Replace the receiver service with the verified successor while the admission
   fence remains active. No old receiver task or target may remain. Warm and
   observe at least one ready task using the existing service/capacity mechanism.
   Do not mix old and new receiver images in one target group for testing. A
   standalone task outside that service cannot claim the existing capacity
   leases and is not an end-to-end test substitute.
6. Capture fresh, secret-free AWS task/target/capacity evidence and call
   `ready_file_upload_successor(operationId, expectedReleaseId,
   expectedSourceGitSha, expectedImageDigest, receiverEvidence, adminUserId)`.
   SQL independently requires no live upload jobs/sessions/capacity requests.
   Only a real administrator on a candidate web deployment whose receiver
   source, image and font match the readied successor can then create test jobs.
   Other new upload requests remain retryable and uncharged. Use that candidate
   to complete the actual upload acceptance tests.
7. Collect all nine new checks listed below. Wait for those test jobs and their
   protected tasks/capacity claims to finish, then capture receiver readiness
   again. Call `promote_file_upload_successor(operationId, expectedReleaseId,
   expectedSourceGitSha, expectedImageDigest, checks, receiverEvidence,
   adminUserId)`. This atomically replaces the nine check identities and removes
   the fence, without changing any public flag. It validates the probe again.
8. Promote the already-verified web deployment with the matching receiver
   identity without rebuilding it. Until the web/DB identity handoff is complete,
   a mismatched web deployment rejects new upload jobs without reserving usage;
   it never falls back to the old renderer. Check actual file upload and link
   creation, editing, downloads, 5xx and Batch errors for fifteen minutes.

Keep the fence interval explicit and short, but do not skip draining or attest
unperformed large-file checks merely to shorten it. Separate concurrent public
and admin receiver traffic would require a separately isolated service, target
group and capacity coordinator; that larger architecture is not introduced here.

## Receiver evidence contract

The operator must collect these values from the actual service, ready task
image identities, ALB targets and capacity coordinator. `inventorySha256` is a
hash of a canonical, non-secret inventory record retained as release evidence.
Do not include bearer tokens, proxy addresses/credentials or secret values.

```json
{
  "releaseId": "<exact receiver release UUID>",
  "sourceGitSha": "<40 lowercase hex>",
  "workerImageDigest": "sha256:<64 lowercase hex>",
  "fontManifestSha256": "<64 lowercase hex>",
  "renderSpecVersion": 4,
  "captionRenderSpecVersion": 4,
  "observedAt": "<actual ISO timestamp, within the past 5 minutes>",
  "evidenceId": "<retained observation identifier>",
  "inventorySha256": "<64 lowercase hex>",
  "readyReceiverCount": 1,
  "allReadyImagesMatch": true,
  "oldTaskCount": 0,
  "oldTargetCount": 0,
  "protectedTaskCount": 0,
  "capacityWaitingCount": 0,
  "capacityGrantedCount": 0,
  "capacityClaimedCount": 0
}
```

This is a required shape, **not a ready-to-submit success fixture**. Supply the
observed counts, including nonzero values; nonzero draining counts block the RPC.

## Nine actual checks

The promotion payload is an object containing exactly these keys:

- `admin_end_to_end`
- `render_parity`
- `upload_1gb`
- `upload_5gb`
- `source_cleanup`
- `usage_integrity`
- `runtime_identity`
- `no_proxy_environment`
- `no_stuck_sessions`

Each value is `{ passed, details }`. Every `details` object must contain the
exact new `releaseId`, `sourceGitSha`, `workerImageDigest`,
`fontManifestSha256`, `renderSpecVersion: 4`, `captionRenderSpecVersion: 4`, a
retained `evidenceId`, and its **actual** `observedAt` timestamp. Preserve
additional check-specific evidence, including tested upload/session/job IDs,
cleanup and usage results where relevant. All nine must have passed within the
past 24 hours. Missing, failed, stale, future-dated or mixed-identity observations
reject the entire transaction. Promotion stores the original observation time;
it does not refresh a stale test by copying it.

Do not replace the public rows one at a time using the old recording command.
They remain available for monitoring the old pinned release; its RPC cannot
erase the separate successor column.

## Expiry, interruption and cancellation

Admin readiness lasts at most 24 hours. Expiry blocks further admissions; it
**never** automatically reopens the old receiver. Already-admitted jobs retain
their identity and can finish. Refresh readiness only after draining and a new
actual observation.

To abandon an unpromoted successor, first drain any admitted candidate tests,
restore and verify the previously pinned receiver, then call
`cancel_file_upload_successor(operationId, expectedReleaseId,
expectedSourceGitSha, expectedImageDigest, restoredReceiverEvidence,
adminUserId)`. The same drain checks apply, with readiness bound to the old
identity. Cancellation changes no feature flag. Do not restore an old web that
cannot read already-saved background/text data.

After promotion, a design-specific problem should disable new use of that
feature while retaining compatible readers, existing data and active jobs.
A single unrelated timeout is not a reason to undo all web or Worker changes.

## Local verification

The web tests cover the old public pin, administrator-only exact successor
admission, malformed/expired fences, readiness identity and attestation failure.
`worker/tests/test_file_upload_successor_postgres.py` additionally runs the real
migration/RPCs against an opt-in **network-none disposable PostgreSQL** container,
including a concurrent old-web insert, exact-nine rollback, CAS, permissions,
drain checks and preservation of flags/jobs/sessions. These tests never use the
application `DATABASE_URL` and never publish release evidence.
