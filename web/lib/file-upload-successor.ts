type UnknownObject = Record<string, unknown>;

export type FileUploadWorkerIdentity = {
  workerSourceGitSha: string;
  workerImageDigest: string;
  fontManifestSha256: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function object(value: unknown): UnknownObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownObject
    : null;
}

function timestamp(value: unknown) {
  return typeof value === "string" ? Date.parse(value) : NaN;
}

/**
 * Only the explicitly readied receiver may admit administrator test jobs.
 * Absence of a successor is handled by the existing public check verifier;
 * malformed, draining or expired successors remain fenced, including admins.
 */
export function verifiedFileUploadSuccessorAdminReleaseId(
  runtimeRow: { passed?: unknown; details?: unknown; successor?: unknown },
  environment: FileUploadWorkerIdentity,
  adminEnabled: boolean,
  now = Date.now(),
): string | null {
  const published = object(runtimeRow.details);
  const successor = object(runtimeRow.successor);
  const identity = object(successor?.identity);
  const receiver = object(successor?.receiverEvidence);
  if (!adminEnabled || runtimeRow.passed !== true || !published || !successor
    || !identity || !receiver || successor.version !== 1 || successor.phase !== "admin_test"
    || !UUID.test(String(successor.id || ""))
    || !UUID.test(String(identity.releaseId || ""))
    || !UUID.test(String(identity.probeRunId || ""))
    || successor.previousReleaseId !== published.releaseId
    || successor.previousSourceGitSha !== published.sourceGitSha
    || successor.previousWorkerImageDigest !== published.workerImageDigest
    || identity.releaseId === published.releaseId
    || identity.workerImageDigest === published.workerImageDigest
    || identity.sourceGitSha !== environment.workerSourceGitSha
    || identity.workerImageDigest !== environment.workerImageDigest
    || identity.fontManifestSha256 !== environment.fontManifestSha256
    || identity.fontManifestSha256 !== published.fontManifestSha256
    || identity.renderSpecVersion !== 4 || identity.captionRenderSpecVersion !== 4
    || published.renderSpecVersion !== 4 || published.captionRenderSpecVersion !== 4
    || !SHA256.test(String(identity.manifestSha256 || ""))
    || !SHA256.test(String(identity.matrixSha256 || ""))
    || typeof identity.manifestS3VersionId !== "string" || !identity.manifestS3VersionId
    || typeof identity.matrixS3VersionId !== "string" || !identity.matrixS3VersionId
    || typeof identity.artifactUri !== "string" || !identity.artifactUri.startsWith("s3://")) {
    return null;
  }
  const startedAt = timestamp(successor.startedAt);
  const readyAt = timestamp(successor.readyAt);
  const expiresAt = timestamp(successor.expiresAt);
  const observedAt = timestamp(receiver.observedAt);
  if (![startedAt, readyAt, expiresAt, observedAt].every(Number.isFinite)
    || startedAt > readyAt || readyAt > now || expiresAt <= now
    || expiresAt > readyAt + 24 * 60 * 60 * 1_000 + 1_000
    || observedAt > readyAt || observedAt < readyAt - 5 * 60 * 1_000
    || typeof receiver.evidenceId !== "string" || !receiver.evidenceId
    || !SHA256.test(String(receiver.inventorySha256 || ""))
    || receiver.allReadyImagesMatch !== true
    || typeof receiver.readyReceiverCount !== "number"
    || !Number.isSafeInteger(receiver.readyReceiverCount) || receiver.readyReceiverCount < 1
    || ["oldTaskCount", "oldTargetCount", "protectedTaskCount", "capacityWaitingCount",
      "capacityGrantedCount", "capacityClaimedCount"].some((key) => receiver[key] !== 0)
    || ["releaseId", "sourceGitSha", "workerImageDigest", "fontManifestSha256",
      "renderSpecVersion", "captionRenderSpecVersion"].some(
      (key) => receiver[key] !== identity[key],
    )) {
    return null;
  }
  return String(identity.releaseId);
}
