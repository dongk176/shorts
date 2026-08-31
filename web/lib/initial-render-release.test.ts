import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/custom-template-design", () => ({
  assertCustomTemplateDesignRenderRelease: vi.fn().mockResolvedValue(undefined),
}));

import {
  resolveFileUploadInitialRenderRelease,
} from "@/lib/initial-render-release";
import { assertCustomTemplateDesignRenderRelease } from "@/lib/custom-template-design";

const sourceSha = "a".repeat(40);
const imageDigest = `sha256:${"b".repeat(64)}`;
const fontManifestSha256 = "c".repeat(64);
const releaseId = "f223e9e5-6aad-449f-8d2d-99202bfed190";

const releaseCheckKeys = [
  "admin_end_to_end",
  "render_parity",
  "upload_1gb",
  "upload_5gb",
  "source_cleanup",
  "usage_integrity",
  "runtime_identity",
  "no_proxy_environment",
  "no_stuck_sessions",
];

function releaseChecks(overrides: Record<string, unknown> = {}) {
  return releaseCheckKeys.map((checkKey) => ({
    checkKey,
    passed: true,
    details: checkKey === "runtime_identity" ? {
      releaseId,
      sourceGitSha: sourceSha,
      workerImageDigest: imageDigest,
      fontManifestSha256,
      renderSpecVersion: 4,
      captionRenderSpecVersion: 4,
      ...overrides,
    } : checkKey === "render_parity" || checkKey === "admin_end_to_end" ? {
      releaseId,
      sourceGitSha: sourceSha,
    } : { sourceGitSha: sourceSha },
  }));
}

function transaction(
  rows: Record<string, unknown>[],
  checks: Record<string, unknown>[] = releaseChecks(),
) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const tx = vi.fn(async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    calls.push({
      sql: Array.from(strings).join("?").replace(/\s+/g, " ").trim(),
      values,
    });
    if (calls.at(-1)?.sql.includes("file_upload_release_checks")) return checks;
    return rows;
  });
  return { tx, calls };
}

function readySuccessorChecks() {
  const checks: Record<string, unknown>[] = releaseChecks();
  const runtime = checks.find((row) => row.checkKey === "runtime_identity")!;
  const identity = {
    releaseId: "350c3a5b-b279-436b-832c-b548a79b7f5c",
    sourceGitSha: "d".repeat(40),
    workerImageDigest: `sha256:${"d".repeat(64)}`,
    fontManifestSha256,
    renderSpecVersion: 4,
    captionRenderSpecVersion: 4,
    probeRunId: "cd9ff845-ce96-46b2-8049-4dd4ce4189d1",
    artifactUri: "s3://private-test-artifacts/receiver/manifest.json",
    manifestSha256: "e".repeat(64),
    matrixSha256: "f".repeat(64),
    manifestS3VersionId: "manifest-v1",
    matrixS3VersionId: "matrix-v1",
  };
  const now = Date.now();
  const successor = {
    version: 1,
    id: "fb4b13a7-ae55-4276-99e0-6161188e99b9",
    phase: "admin_test",
    previousReleaseId: releaseId,
    previousSourceGitSha: sourceSha,
    previousWorkerImageDigest: imageDigest,
    identity,
    startedAt: new Date(now - 120_000).toISOString(),
    readyAt: new Date(now - 30_000).toISOString(),
    expiresAt: new Date(now + 3_600_000).toISOString(),
    receiverEvidence: {
      ...identity,
      evidenceId: "observed-receiver-test",
      observedAt: new Date(now - 35_000).toISOString(),
      inventorySha256: "a".repeat(64),
      readyReceiverCount: 1,
      allReadyImagesMatch: true,
      oldTaskCount: 0,
      oldTargetCount: 0,
      protectedTaskCount: 0,
      capacityWaitingCount: 0,
      capacityGrantedCount: 0,
      capacityClaimedCount: 0,
    },
  };
  runtime.successor = successor;
  return { checks, successor, identity };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_EDITOR_RENDER_SPEC_V4_ENABLED", "true");
  vi.stubEnv("FILE_UPLOAD_WORKER_SOURCE_GIT_SHA", sourceSha);
  vi.stubEnv("FILE_UPLOAD_WORKER_IMAGE_DIGEST", imageDigest);
  vi.stubEnv("FILE_UPLOAD_WORKER_FONT_MANIFEST_SHA256", fontManifestSha256);
});

describe("file-upload initial render release", () => {
  it("allows only an attested administrator successor while keeping the old public pin", async () => {
    const candidate = readySuccessorChecks();
    vi.stubEnv("FILE_UPLOAD_WORKER_SOURCE_GIT_SHA", candidate.identity.sourceGitSha);
    vi.stubEnv("FILE_UPLOAD_WORKER_IMAGE_DIGEST", candidate.identity.workerImageDigest);
    const { tx, calls } = transaction([{
      ...candidate.identity,
      releaseWorkerImageDigest: candidate.identity.workerImageDigest,
    }], candidate.checks);
    await expect(resolveFileUploadInitialRenderRelease(tx as never, {
      targetKey: "legacy_project",
      access: { adminEnabled: true, publicEnabled: true },
    })).resolves.toMatchObject({ releaseId: candidate.identity.releaseId });
    expect(calls[1]?.values).toContain(candidate.identity.releaseId);
    expect(assertCustomTemplateDesignRenderRelease).toHaveBeenCalledWith(
      tx, candidate.identity.releaseId,
    );
    expect(candidate.checks.find((row) => row.checkKey === "runtime_identity")?.details)
      .toMatchObject({ releaseId, sourceGitSha: sourceSha, workerImageDigest: imageDigest });
  });

  it("blocks public callers and old candidate environments during admin successor testing", async () => {
    const candidate = readySuccessorChecks();
    const oldEnvironment = transaction([], candidate.checks);
    await expect(resolveFileUploadInitialRenderRelease(oldEnvironment.tx as never, {
      targetKey: "legacy_project", access: { adminEnabled: true, publicEnabled: true },
    })).resolves.toBeNull();
    vi.stubEnv("FILE_UPLOAD_WORKER_SOURCE_GIT_SHA", candidate.identity.sourceGitSha);
    vi.stubEnv("FILE_UPLOAD_WORKER_IMAGE_DIGEST", candidate.identity.workerImageDigest);
    const publicCaller = transaction([], candidate.checks);
    await expect(resolveFileUploadInitialRenderRelease(publicCaller.tx as never, {
      targetKey: "legacy_project", access: { adminEnabled: false, publicEnabled: true },
    })).resolves.toBeNull();
    expect(oldEnvironment.calls).toHaveLength(1);
    expect(publicCaller.calls).toHaveLength(1);
    expect(assertCustomTemplateDesignRenderRelease).not.toHaveBeenCalled();
  });

  it.each([true, false])("keeps the drain fenced even when public=%s", async (publicEnabled) => {
    const candidate = readySuccessorChecks();
    candidate.successor.phase = "draining";
    const { tx, calls } = transaction([], candidate.checks);
    await expect(resolveFileUploadInitialRenderRelease(tx as never, {
      targetKey: "legacy_project", access: { adminEnabled: true, publicEnabled },
    })).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("rechecks finalized evidence before returning a successor, with no legacy fallback", async () => {
    const candidate = readySuccessorChecks();
    vi.stubEnv("FILE_UPLOAD_WORKER_SOURCE_GIT_SHA", candidate.identity.sourceGitSha);
    vi.stubEnv("FILE_UPLOAD_WORKER_IMAGE_DIGEST", candidate.identity.workerImageDigest);
    const { tx } = transaction([{
      ...candidate.identity,
      releaseWorkerImageDigest: candidate.identity.workerImageDigest,
    }], candidate.checks);
    vi.mocked(assertCustomTemplateDesignRenderRelease)
      .mockRejectedValueOnce(new Error("attestation is no longer available"));
    await expect(resolveFileUploadInitialRenderRelease(tx as never, {
      targetKey: "legacy_project", access: { adminEnabled: true, publicEnabled: true },
    })).rejects.toThrow("attestation is no longer available");
  });

  it("binds administrator testing to the exact verified upload worker", async () => {
    const { tx, calls } = transaction([{
      releaseId,
      renderSpecVersion: 4,
      captionRenderSpecVersion: 4,
      fontManifestSha256,
      releaseWorkerImageDigest: imageDigest,
    }]);

    await expect(resolveFileUploadInitialRenderRelease(tx as never, {
      targetKey: "subtitle_templates",
      access: { adminEnabled: true, publicEnabled: false },
    })).resolves.toEqual({
      releaseId,
      renderSpecVersion: 4,
      captionRenderSpecVersion: 4,
      fontManifestSha256,
      workerImageDigest: imageDigest,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.sql).toContain("successor");
    expect(calls[1]?.sql).toContain("for share of state,runtime,release,project_target");
    expect(calls[1]?.sql).not.toContain("state.candidate_release_id");
    expect(calls[1]?.values).toContain("subtitle_templates");
    expect(calls[1]?.values).toContain(sourceSha);
    expect(calls[1]?.values).toContain(imageDigest);
    expect(calls[1]?.values).toContain(fontManifestSha256);
  });

  it("binds public uploads to the exact independently verified upload release", async () => {
    const { tx, calls } = transaction([{
      releaseId,
      renderSpecVersion: 4,
      captionRenderSpecVersion: 4,
      fontManifestSha256,
      releaseWorkerImageDigest: imageDigest,
    }]);

    await expect(resolveFileUploadInitialRenderRelease(tx as never, {
      targetKey: "legacy_project",
      access: { adminEnabled: true, publicEnabled: true },
    })).resolves.toMatchObject({ releaseId });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.sql).toContain("file_upload_release_checks");
    expect(calls[0]?.sql).toContain("for share");
    expect(calls[1]?.values).toContain(releaseId);
    expect(calls[1]?.values).toContain(sourceSha);
    expect(calls[1]?.values).toContain(imageDigest);
    expect(calls[1]?.sql).not.toContain("state.stable_release_id");
  });

  it("fails closed for incomplete or explicitly failed public evidence", async () => {
    const release = [{
      releaseId,
      renderSpecVersion: 4,
      captionRenderSpecVersion: 4,
      fontManifestSha256,
      releaseWorkerImageDigest: imageDigest,
    }];
    const missing = transaction(release, releaseChecks().slice(1));
    await expect(resolveFileUploadInitialRenderRelease(missing.tx as never, {
      targetKey: "legacy_project",
      access: { adminEnabled: false, publicEnabled: true },
    })).resolves.toBeNull();
    expect(missing.calls).toHaveLength(1);

    const failedChecks = releaseChecks();
    failedChecks[0] = { ...failedChecks[0], passed: false };
    const failed = transaction(release, failedChecks);
    await expect(resolveFileUploadInitialRenderRelease(failed.tx as never, {
      targetKey: "legacy_project",
      access: { adminEnabled: true, publicEnabled: true },
    })).resolves.toBeNull();
    expect(failed.calls).toHaveLength(1);
  });

  it.each([
    ["sourceGitSha", "d".repeat(40)],
    ["workerImageDigest", `sha256:${"d".repeat(64)}`],
    ["fontManifestSha256", "d".repeat(64)],
    ["renderSpecVersion", 3],
    ["captionRenderSpecVersion", 3],
    ["releaseId", "not-a-release"],
  ])("rejects public runtime identity mismatch in %s", async (key, value) => {
    const { tx, calls } = transaction([], releaseChecks({ [key]: value }));
    await expect(resolveFileUploadInitialRenderRelease(tx as never, {
      targetKey: "subtitle_templates",
      access: { adminEnabled: false, publicEnabled: true },
    })).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("rejects public evidence whose render or supporting checks belong to another release", async () => {
    const renderMismatch = releaseChecks();
    const renderIndex = renderMismatch.findIndex((row) => row.checkKey === "render_parity");
    renderMismatch[renderIndex] = {
      ...renderMismatch[renderIndex],
      details: { releaseId: crypto.randomUUID(), sourceGitSha: sourceSha },
    };
    const render = transaction([], renderMismatch);
    await expect(resolveFileUploadInitialRenderRelease(render.tx as never, {
      targetKey: "legacy_project",
      access: { adminEnabled: false, publicEnabled: true },
    })).resolves.toBeNull();
    expect(render.calls).toHaveLength(1);

    const sourceMismatch = releaseChecks();
    sourceMismatch[0] = {
      ...sourceMismatch[0],
      details: { sourceGitSha: "d".repeat(40) },
    };
    const supporting = transaction([], sourceMismatch);
    await expect(resolveFileUploadInitialRenderRelease(supporting.tx as never, {
      targetKey: "legacy_project",
      access: { adminEnabled: true, publicEnabled: true },
    })).resolves.toBeNull();
    expect(supporting.calls).toHaveLength(1);
  });

  it("fails closed before querying when identity or access is incomplete", async () => {
    const { tx, calls } = transaction([]);
    vi.stubEnv("FILE_UPLOAD_WORKER_IMAGE_DIGEST", "");

    await expect(resolveFileUploadInitialRenderRelease(tx as never, {
      targetKey: "legacy_project",
      access: { adminEnabled: true, publicEnabled: false },
    })).resolves.toBeNull();
    expect(calls).toHaveLength(0);

    vi.stubEnv("FILE_UPLOAD_WORKER_IMAGE_DIGEST", imageDigest);
    await expect(resolveFileUploadInitialRenderRelease(tx as never, {
      targetKey: "legacy_project",
      access: { adminEnabled: false, publicEnabled: false },
    })).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("rejects a database release that differs from the upload worker", async () => {
    const { tx } = transaction([{
      releaseId,
      renderSpecVersion: 4,
      captionRenderSpecVersion: 4,
      fontManifestSha256,
      releaseWorkerImageDigest: `sha256:${"d".repeat(64)}`,
    }]);
    await expect(resolveFileUploadInitialRenderRelease(tx as never, {
      targetKey: "unified_template_subtitles",
      access: { adminEnabled: true, publicEnabled: false },
    })).resolves.toBeNull();
  });
});
