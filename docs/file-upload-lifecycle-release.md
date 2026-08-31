# Upload receiver lifecycle correction — upload remains stopped

## Scope and baseline

This correction must preserve `file_upload=false` and `file_upload_public=false`,
including for administrators. It does not authorize charges, upload reopening,
old-job data rewrites, YouTube ingestion changes, or editor changes.

The observed production web baseline is
`845738f3598ed2dee414be30542853a25189627d`. Receiver task definition
`shorts-mvp-file-upload-production:12` uses source
`34f0d31abc1d26f6e2887cc233ce96348f1b1382` and image
`sha256:11b3283f57af52fda7e3f960c5befb83f9f3fe9201a216a4c245a77dd5140bd3`.
The actual capacity coordinator's source SHA-256 is
`3c8b4def86ae5b9deba813128532838c183a6f55c0896bbedb56cc014ff95b4d`;
it matches the promoted web baseline, not the older receiver checkout's copy.
Each component is patched from its own actual source.

## Required lifecycle invariants

- ALB health checks use `/livez`. `/readyz` is admission readiness, not evidence
  that an occupied server is broken. Health must remain positive during work.
- A busy receiver rejects a new upload before reading its body or claiming its
  one-use bearer. The load balancer can first contact a busy receiver; its 409
  is retried only while authoritative session state is still `ready`.
  Once claimed, file bodies are never replayed to another receiver.
- Available capacity excludes the union of claimed and protected tasks. Ending
  one lease cannot remove another task's protection, processing capacity, or
  cleanup ownership. Partial AWS inventory and deployments never imply idle.
- The receiver owns its pipeline through timeline/edit-source post-processing,
  task-local source snapshot cleanup, receiver raw-file cleanup, and terminal
  persistence. Shutdown never frees this ownership while work is running.
- An undeleted source is not recorded as deleted. Cleanup problems do not turn
  existing completed video outputs into failed projects. A quarantined receiver
  cannot accept another upload or let another task clean an active source.
- A stale heartbeat alone cannot authorize a peer sweep. Before any status
  mutation, a read-only capacity operation verifies the exact recorded owner
  task is STOPPED and its lease still matches. Unknown/missing/released owners
  remain deferred. Expired, never-claimed tokens have a separate atomic expiry
  branch that rechecks zero bytes and absent claim/consumption under the row lock.
- If terminal DB writes fail after physical cleanup, the same receiver retains
  its heartbeat, protection and lease, then retries only the terminal write.
  It never regenerates output or repeats an already-confirmed raw deletion.
- The common project finalizer remains authoritative for completed/failed
  results and usage settlement. No parallel refund or billing policy is added.
  A claimed session still displays processing during post-processing, even if
  output generation has completed; terminal states reconcile to the project.

## Verification and deployment boundary

Run deterministic multi-receiver/thread tests covering success, failure,
shutdown during work, delayed cleanup, database errors, partial protection
inventory, and a completion racing another task's admission. Verify that the
remaining receiver retains its raw file, task protection, lease, and work.
Run receiver/adapter/repository tests, web status/client tests, capacity tests,
CDK tests, and the repository verification gate.

Use an immutable, separately verified receiver image; never build the entire
Worker directory from the web checkout. Deploy only the reviewed capacity
function code, liveness health path, and exact receiver image/runtime identity.
Keep queues, resource sizes, IP/proxy/token/Secret configuration, and stopped
upload flags unchanged. Confirm zero active upload sessions and active capacity
leases before replacing the stopped receiver service.

Local concurrency tests and isolated image/render probes are not actual
production upload E2E. Do not copy the old nine public-release checks to the
new image. A later upload-reopening decision still requires genuine checks on
that exact image. Background/template ADMIN is separately allowed while video
uploads remain explicitly stopped; design PUBLIC remains gated on both paths.

## Deliberately deferred edge case

The bounded stale-candidate scan has no cursor. If 20 old records repeatedly
lack trustworthy owner evidence, automatic cleanup of later records can be
delayed; it must not guess those owners are gone. Observe the unverified-owner
events and inspect that backlog before upload reopening. At this release's
baseline there were no upload records with pending source cleanup. Adding a
new cleanup scheduler/pagination system is outside this minimal correction.
