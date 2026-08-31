import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultTemplateConfig } from "@/lib/template-config";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ lockAssets: vi.fn(), lockAccess: vi.fn() }));
vi.mock("@/lib/background-assets", () => ({ lockOwnedBackgroundAssets: mocks.lockAssets }));
vi.mock("@/lib/custom-template-design-access", async (original) => ({
  ...(await original<typeof import("@/lib/custom-template-design-access")>()),
  lockCustomTemplateDesignAccess: mocks.lockAccess,
}));
import { assertCustomTemplateDesignRenderRelease, CUSTOM_TEMPLATE_DESIGN_ISOLATED_CHECKS, lockTemplateDesignForSave } from "./custom-template-design";

const ASSET = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const RELEASE = "33333333-3333-4333-8333-333333333333";
function verifiedRow() {
  const gitSha = "a".repeat(40);
  const workerImageDigest = `sha256:${"b".repeat(64)}`;
  const fontManifestSha256 = "c".repeat(64);
  return {
    gitSha, workerImageDigest, fontManifestSha256,
    renderSpecVersion: 4, captionRenderSpecVersion: 4,
    probeGitSha: gitSha, probeWorkerImageDigest: workerImageDigest,
    probeFontManifestSha256: fontManifestSha256,
    probeRunId: ASSET, artifactUri: "s3://private/probe/manifest.json",
    checkArtifactUri: "s3://private/probe/manifest.json",
    manifestSha256: "d".repeat(64), matrixSha256: "e".repeat(64),
    manifestS3VersionId: "manifest-version", matrixS3VersionId: "matrix-version",
    details: {
      probeRunId: ASSET,
      customTemplateDesign: {
        version: 1, passed: true, wrapRevision: "editor-text-v1",
        renderSpecVersion: 4, captionRenderSpecVersion: 4,
        sourceGitSha: gitSha, workerImageDigest, fontManifestSha256,
      },
    },
  };
}

function databaseRow(row: Record<string, unknown> = verifiedRow()) {
  const { details, ...columns } = row;
  return { ...columns, detailsJson: JSON.stringify(details) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lockAccess.mockResolvedValue({ enabled: false });
  mocks.lockAssets.mockResolvedValue([]);
});

describe("design save admission", () => {
  it("does not gate or rewrite ordinary templates", async () => {
    const db = vi.fn();
    await lockTemplateDesignForSave(db as never, USER, createDefaultTemplateConfig());
    expect(mocks.lockAccess).not.toHaveBeenCalled();
    expect(mocks.lockAssets).not.toHaveBeenCalled();
    expect(db).not.toHaveBeenCalled();
  });
  it("keeps an unchanged saved design usable when new use is disabled", async () => {
    const config = { ...createDefaultTemplateConfig(), background: { kind: "uploaded_image" as const, assetId: ASSET } };
    const db = vi.fn();
    await lockTemplateDesignForSave(db as never, USER, config, structuredClone(config));
    expect(mocks.lockAccess).not.toHaveBeenCalled();
    expect(mocks.lockAssets).toHaveBeenCalledWith(db, USER, [ASSET]);
  });
  it("gates new use before acquiring any asset lease", async () => {
    const config = { ...createDefaultTemplateConfig(), background: { kind: "uploaded_image" as const, assetId: ASSET } };
    await expect(lockTemplateDesignForSave(vi.fn() as never, USER, config)).rejects.toMatchObject({
      status: 403, code: "CUSTOM_TEMPLATE_DESIGN_DISABLED",
    });
    expect(mocks.lockAssets).not.toHaveBeenCalled();
  });
  it.each([undefined, createDefaultTemplateConfig()])("does not let empty new text fields bypass a disabled feature", async (previous) => {
    const config = { ...createDefaultTemplateConfig(), textOverlays: [] };
    await expect(lockTemplateDesignForSave(vi.fn() as never, USER, config, previous)).rejects.toMatchObject({
      status: 403, code: "CUSTOM_TEMPLATE_DESIGN_DISABLED",
    });
    expect(mocks.lockAssets).not.toHaveBeenCalled();
  });
  it("validates ownership inside the caller's save transaction", async () => {
    mocks.lockAccess.mockResolvedValue({ enabled: true });
    mocks.lockAssets.mockRejectedValue(new Error("not owned"));
    const config = { ...createDefaultTemplateConfig(), background: { kind: "uploaded_image" as const, assetId: ASSET } };
    await expect(lockTemplateDesignForSave(vi.fn() as never, USER, config)).rejects.toThrow("not owned");
  });
});

describe("immutable design renderer evidence", () => {
  it("preserves exact attested lane keys without changing the shared database transform", async () => {
    const row = databaseRow();
    const compatibleSuccessor = { projectTargets: {
      legacy_project: { contractSha256: "f".repeat(64) },
      source_range: { contractSha256: "e".repeat(64) },
    } };
    row.detailsJson = JSON.stringify({ ...JSON.parse(row.detailsJson), compatibleSuccessor });
    const db = vi.fn().mockResolvedValueOnce([row]).mockResolvedValueOnce(
      CUSTOM_TEMPLATE_DESIGN_ISOLATED_CHECKS.map((checkName) => ({ checkName, status: "passed" })),
    );
    await expect(assertCustomTemplateDesignRenderRelease(db as never, RELEASE))
      .resolves.toEqual({ compatibleSuccessor });
    expect(db.mock.calls[0][0].join("?")).toContain("c.details::text as details_json");
  });

  it.each([null, undefined, "not JSON", "null", "[]"])(
    "rejects missing or malformed serialized evidence: %s", async (detailsJson) => {
      const db = vi.fn().mockResolvedValue([{ ...databaseRow(), detailsJson }]);
      await expect(assertCustomTemplateDesignRenderRelease(db as never, RELEASE))
        .rejects.toMatchObject({ status: 503, code: "CUSTOM_TEMPLATE_DESIGN_RENDER_UNAVAILABLE" });
    },
  );
  it("requires a finalized exact-identity probe with versioned artifacts", async () => {
    const db = vi.fn().mockResolvedValueOnce([databaseRow(verifiedRow())]).mockResolvedValueOnce(
      CUSTOM_TEMPLATE_DESIGN_ISOLATED_CHECKS.map((checkName) => ({ checkName, status: "passed" })),
    );
    await expect(assertCustomTemplateDesignRenderRelease(db as never, RELEASE)).resolves.toEqual({ compatibleSuccessor: undefined });
    const sql = db.mock.calls[0][0].join("?");
    expect(sql).toContain("p.state='finalized'");
    expect(sql).toContain("for share of r,p,c");
  });
  it.each(CUSTOM_TEMPLATE_DESIGN_ISOLATED_CHECKS)("does not admit a renderer after isolated check %s fails", async (failed) => {
    const db = vi.fn().mockResolvedValueOnce([databaseRow(verifiedRow())]).mockResolvedValueOnce(
      CUSTOM_TEMPLATE_DESIGN_ISOLATED_CHECKS.map((checkName) => ({ checkName, status: checkName === failed ? "failed" : "passed" })),
    );
    await expect(assertCustomTemplateDesignRenderRelease(db as never, RELEASE)).rejects.toMatchObject({ status: 503 });
  });
  it("never falls back to the old renderer or reserves usage", async () => {
    const db = vi.fn();
    await expect(assertCustomTemplateDesignRenderRelease(db as never, null)).rejects.toMatchObject({
      status: 503, code: "CUSTOM_TEMPLATE_DESIGN_RENDER_UNAVAILABLE",
    });
    expect(db).not.toHaveBeenCalled();
  });
  it.each([
    { probeGitSha: "f".repeat(40) }, { probeWorkerImageDigest: "sha256:other" },
    { probeFontManifestSha256: "f".repeat(64) }, { renderSpecVersion: 3 },
    { captionRenderSpecVersion: 3 }, { manifestSha256: "invalid" },
    { matrixSha256: null }, { manifestS3VersionId: null }, { matrixS3VersionId: null },
    { checkArtifactUri: "s3://other/probe/manifest.json" },
    { details: { probeRunId: ASSET } },
  ])("rejects incomplete or conflicting proof %j", async (patch) => {
    const db = vi.fn().mockResolvedValue([databaseRow({ ...verifiedRow(), ...patch })]);
    await expect(assertCustomTemplateDesignRenderRelease(db as never, RELEASE)).rejects.toMatchObject({ status: 503 });
  });
  it.each([
    { passed: false }, { version: 2 }, { wrapRevision: "other" },
    { renderSpecVersion: 3 }, { sourceGitSha: "f".repeat(40) },
    { workerImageDigest: "sha256:other" }, { fontManifestSha256: "f".repeat(64) },
  ])("rejects unattested feature identity %j", async (patch) => {
    const row = verifiedRow();
    Object.assign(row.details.customTemplateDesign, patch);
    await expect(assertCustomTemplateDesignRenderRelease(vi.fn().mockResolvedValue([databaseRow(row)]) as never, RELEASE))
      .rejects.toMatchObject({ status: 503 });
  });
});
