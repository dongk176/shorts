import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verifiedFileUploadSuccessorAdminReleaseId } from "@/lib/file-upload-successor";

const oldId = "b8467c45-803f-4c45-83d3-63bcacfe601b";
const newId = "9d8a70c7-4d3f-4cb2-aa06-f2eb221aef56";
const operationId = "c217ec65-e6a8-4c98-916d-4fc76463202d";
const now = Date.parse("2026-08-31T08:00:00Z");
const environment = {
  workerSourceGitSha: "b".repeat(40),
  workerImageDigest: `sha256:${"b".repeat(64)}`,
  fontManifestSha256: "c".repeat(64),
};

export function successorFixture() {
  const published = {
    releaseId: oldId,
    sourceGitSha: "a".repeat(40),
    workerImageDigest: `sha256:${"a".repeat(64)}`,
    fontManifestSha256: environment.fontManifestSha256,
    renderSpecVersion: 4,
    captionRenderSpecVersion: 4,
  };
  const identity = {
    releaseId: newId,
    sourceGitSha: environment.workerSourceGitSha,
    workerImageDigest: environment.workerImageDigest,
    fontManifestSha256: environment.fontManifestSha256,
    renderSpecVersion: 4,
    captionRenderSpecVersion: 4,
    probeRunId: "b96e476c-a04a-4914-9ca9-3081dd5cdd90",
    artifactUri: "s3://private-test-artifacts/receiver/manifest.json",
    manifestSha256: "d".repeat(64),
    matrixSha256: "e".repeat(64),
    manifestS3VersionId: "manifest-version",
    matrixS3VersionId: "matrix-version",
  };
  return {
    passed: true,
    details: published,
    successor: {
      version: 1,
      id: operationId,
      phase: "admin_test",
      previousReleaseId: oldId,
      previousSourceGitSha: published.sourceGitSha,
      previousWorkerImageDigest: published.workerImageDigest,
      identity,
      startedAt: new Date(now - 120_000).toISOString(),
      readyAt: new Date(now - 30_000).toISOString(),
      expiresAt: new Date(now + 3_600_000).toISOString(),
      receiverEvidence: {
        ...identity,
        evidenceId: "observed-receiver-1",
        observedAt: new Date(now - 35_000).toISOString(),
        inventorySha256: "f".repeat(64),
        readyReceiverCount: 1,
        allReadyImagesMatch: true,
        oldTaskCount: 0,
        oldTargetCount: 0,
        protectedTaskCount: 0,
        capacityWaitingCount: 0,
        capacityGrantedCount: 0,
        capacityClaimedCount: 0,
      },
    },
  };
}

describe("verified file-upload successor admin admission", () => {
  it("admits only the observed successor identity for a verified administrator", () => {
    const row = successorFixture();
    expect(verifiedFileUploadSuccessorAdminReleaseId(row, environment, true, now)).toBe(newId);
    expect(verifiedFileUploadSuccessorAdminReleaseId(row, environment, false, now)).toBeNull();
    expect(verifiedFileUploadSuccessorAdminReleaseId(row, {
      ...environment, workerSourceGitSha: row.details.sourceGitSha,
      workerImageDigest: row.details.workerImageDigest,
    }, true, now)).toBeNull();
  });

  it.each([
    { version: 2 }, { phase: "draining" }, { phase: "expired" },
    { id: "bad" }, { previousReleaseId: newId },
    { previousSourceGitSha: "d".repeat(40) },
    { previousWorkerImageDigest: `sha256:${"d".repeat(64)}` },
    { expiresAt: new Date(now).toISOString() },
    { expiresAt: "infinity" }, { expiresAt: new Date(now + 25 * 3_600_000).toISOString() },
    { readyAt: new Date(now + 1_000).toISOString() }, { startedAt: "invalid" },
    { receiverEvidence: null }, { identity: null },
  ])("never reopens a draining, expired or corrupt handoff: %j", (patch) => {
    const row = successorFixture();
    Object.assign(row.successor, patch);
    expect(verifiedFileUploadSuccessorAdminReleaseId(row, environment, true, now)).toBeNull();
  });

  it.each([
    { sourceGitSha: "d".repeat(40) }, { workerImageDigest: `sha256:${"d".repeat(64)}` },
    { fontManifestSha256: "d".repeat(64) }, { renderSpecVersion: 3 },
    { captionRenderSpecVersion: 3 }, { probeRunId: "bad" },
    { manifestS3VersionId: "" }, { matrixS3VersionId: "" },
    { manifestSha256: "bad" }, { matrixSha256: "bad" }, { artifactUri: "https://untrusted.test" },
  ])("requires exact attested identity and artifacts: %j", (patch) => {
    const row = successorFixture();
    Object.assign(row.successor.identity, patch);
    expect(verifiedFileUploadSuccessorAdminReleaseId(row, environment, true, now)).toBeNull();
  });

  it.each([
    { oldTaskCount: 1 }, { oldTargetCount: 1 }, { protectedTaskCount: 1 },
    { capacityWaitingCount: 1 }, { capacityGrantedCount: 1 }, { capacityClaimedCount: 1 },
    { allReadyImagesMatch: false }, { readyReceiverCount: 0 }, { readyReceiverCount: "1" },
    { observedAt: new Date(now + 1_000).toISOString() },
    { observedAt: new Date(now - 6 * 60_000).toISOString() },
    { evidenceId: "" }, { inventorySha256: "bad" }, { releaseId: oldId },
  ])("requires the actual fully drained receiver readiness record: %j", (patch) => {
    const row = successorFixture();
    Object.assign(row.successor.receiverEvidence, patch);
    expect(verifiedFileUploadSuccessorAdminReleaseId(row, environment, true, now)).toBeNull();
  });
});

describe("file-upload successor migration contract", () => {
  const migration = readFileSync(new URL(
    "../../supabase/migrations/202608310002_file_upload_successor.sql", import.meta.url,
  ), "utf8");

  it("preserves old jobs, sessions and public flags with no extra public switch", () => {
    expect(migration).toContain("add column if not exists successor jsonb");
    expect(migration).not.toMatch(/\b(?:update|delete\s+from|insert\s+into)\s+shorts_mvp\.(?:runtime_feature_flags|upload_sessions|video_jobs)\b/i);
    expect(migration).not.toMatch(/\bcreate\s+table\b/i);
    expect(migration).toContain("before insert on shorts_mvp.video_jobs");
    expect(migration).toContain("successor compare-and-swap failed");
  });

  it("requires all nine fresh observations and immutable design-probe evidence", () => {
    expect(migration).toContain("interval '24 hours'");
    expect(migration).toContain("probe.state='finalized'");
    expect(migration).toContain("checked.details->>'probeRunId'=probe.id::text");
    expect(migration).toContain("probe.manifest_s3_version_id");
    expect(migration).toContain("probe.matrix_s3_version_id");
    expect(migration).toContain("checked.details->'customTemplateDesign'");
    expect(migration).toContain("needs the exact nine checks");
    expect(migration).toContain("verified_at=v_observed_at");
  });
});
