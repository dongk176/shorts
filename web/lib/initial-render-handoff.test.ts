import type { TransactionSql } from "postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDispatchTarget } from "@/lib/job-dispatch";

vi.mock("server-only", () => ({}));

import { resolveInitialRenderRelease } from "@/lib/initial-render-release";

const userId = "db2d558d-9704-4143-89fb-c462993dd79c";
const target: ProjectDispatchTarget = {
  targetKey: "legacy_project",
  releaseId: "test-v4-successor",
  workerSourceGitSha: "a".repeat(40),
  workerImageDigest: `sha256:${"b".repeat(64)}`,
  jobDefinitionArn: "arn:aws:batch:ap-northeast-2:111111111111:job-definition/project:2",
  jobQueueArn: "arn:aws:batch:ap-northeast-2:111111111111:job-queue/project",
  v4Capability: {
    renderSpecVersion: 4,
    captionRenderSpecVersion: 4,
    fontManifestSha256: "c".repeat(64),
  },
};
const release = {
  releaseId: "f18a3b76-cd6b-46e8-8d42-081873d32f8a",
  renderSpecVersion: 4,
  captionRenderSpecVersion: 4,
  fontManifestSha256: target.v4Capability!.fontManifestSha256,
  releaseWorkerImageDigest: target.workerImageDigest,
};

function transaction(...results: Record<string, unknown>[][]) {
  const sql: string[] = [];
  const tx = vi.fn(async (parts: TemplateStringsArray) => {
    sql.push(parts.join("?").replace(/\s+/g, " "));
    return results.shift() ?? [];
  });
  return { tx, db: tx as unknown as TransactionSql, sql };
}

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_EDITOR_RENDER_SPEC_V4_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

describe("initial render handoff preserves v4 without legacy fallback", () => {
  it("returns only the exact worker image and font tuple", async () => {
    const { db, tx } = transaction([release]);
    await expect(resolveInitialRenderRelease(db, { userId, dispatchTarget: target }))
      .resolves.toEqual({ releaseId: release.releaseId, renderSpecVersion: 4,
        captionRenderSpecVersion: 4, fontManifestSha256: release.fontManifestSha256,
        workerImageDigest: target.workerImageDigest });
    expect(tx).toHaveBeenCalledTimes(1);
  });

  it.each([true, null, undefined])("rejects missing exact target when v4_required=%s", async (v4Required) => {
    const { db, sql } = transaction([], [{ v4Required }]);
    await expect(resolveInitialRenderRelease(db, { userId, dispatchTarget: target }))
      .rejects.toMatchObject({ status: 503, code: "INITIAL_RENDER_RELEASE_HANDOFF" });
    expect(sql).toHaveLength(2);
    expect(sql[1]).toContain("render_v4_infra_lease_id");
    expect(sql[1]).toContain("render_v4_rollout_percent");
    expect(sql[1]).toContain("for share of state,runtime");
    expect(sql.join(" ")).not.toMatch(/insert|update shorts_mvp/);
  });

  it("fails closed when the rollout state is absent", async () => {
    const { db } = transaction([], []);
    await expect(resolveInitialRenderRelease(db, { userId, dispatchTarget: target }))
      .rejects.toMatchObject({ code: "INITIAL_RENDER_RELEASE_HANDOFF" });
  });

  it.each([
    { renderSpecVersion: 3 },
    { captionRenderSpecVersion: 3 },
    { fontManifestSha256: "d".repeat(64) },
    { releaseWorkerImageDigest: `sha256:${"d".repeat(64)}` },
  ])("rejects a mismatched release before any mutation: %j", async (mismatch) => {
    const { db, tx } = transaction([{ ...release, ...mismatch }], [{ v4Required: true }]);
    await expect(resolveInitialRenderRelease(db, { userId, dispatchTarget: target }))
      .rejects.toMatchObject({ code: "INITIAL_RENDER_RELEASE_HANDOFF" });
    expect(tx).toHaveBeenCalledTimes(2);
  });

  it("retains explicit legacy or out-of-rollout behavior", async () => {
    const { db } = transaction([], [{ v4Required: false }]);
    await expect(resolveInitialRenderRelease(db, { userId, dispatchTarget: target })).resolves.toBeNull();
  });

  it("does not query the rollout for a stable legacy-only target or signed-out caller", async () => {
    const { db, tx } = transaction();
    await expect(resolveInitialRenderRelease(db, { userId, dispatchTarget: {
      ...target, v4Capability: null,
    } })).resolves.toBeNull();
    await expect(resolveInitialRenderRelease(db, { userId: null, dispatchTarget: target })).resolves.toBeNull();
    vi.stubEnv("NEXT_PUBLIC_EDITOR_RENDER_SPEC_V4_ENABLED", "false");
    await expect(resolveInitialRenderRelease(db, { userId, dispatchTarget: target })).resolves.toBeNull();
    expect(tx).not.toHaveBeenCalled();
  });
});
