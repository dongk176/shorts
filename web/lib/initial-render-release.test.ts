import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  resolveFileUploadInitialRenderRelease,
} from "@/lib/initial-render-release";

const sourceSha = "a".repeat(40);
const imageDigest = `sha256:${"b".repeat(64)}`;
const fontManifestSha256 = "c".repeat(64);
const releaseId = "f223e9e5-6aad-449f-8d2d-99202bfed190";

function transaction(rows: Record<string, unknown>[]) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const tx = vi.fn(async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    calls.push({
      sql: Array.from(strings).join("?").replace(/\s+/g, " ").trim(),
      values,
    });
    return rows;
  });
  return { tx, calls };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_EDITOR_RENDER_SPEC_V4_ENABLED", "true");
  vi.stubEnv("FILE_UPLOAD_WORKER_SOURCE_GIT_SHA", sourceSha);
  vi.stubEnv("FILE_UPLOAD_WORKER_IMAGE_DIGEST", imageDigest);
  vi.stubEnv("FILE_UPLOAD_WORKER_FONT_MANIFEST_SHA256", fontManifestSha256);
});

describe("file-upload initial render release", () => {
  it("binds administrator testing to the exact verified candidate", async () => {
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

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("state.candidate_release_id");
    expect(calls[0]?.sql).toContain("for share of state,runtime,release,project_target");
    expect(calls[0]?.values).toContain("candidate");
    expect(calls[0]?.values).toContain("subtitle_templates");
    expect(calls[0]?.values).toContain(sourceSha);
    expect(calls[0]?.values).toContain(imageDigest);
    expect(calls[0]?.values).toContain(fontManifestSha256);
  });

  it("uses only the promoted stable release after public enablement", async () => {
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

    expect(calls[0]?.values).toContain("stable");
    expect(calls[0]?.sql).toContain("state.public_enabled");
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
