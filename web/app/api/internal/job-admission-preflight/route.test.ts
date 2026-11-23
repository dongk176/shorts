import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { db } = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => db }));

const prefixes = [
  "LEGACY_PROJECT",
  "SOURCE_RANGE",
  "ELEVENLABS_TRANSCRIPTION",
  "SUBTITLE_TEMPLATES",
  "UNIFIED_TEMPLATE_SUBTITLES",
];

beforeEach(() => {
  db.mockReset().mockResolvedValue([{ operation: null }]);
  prefixes.forEach((prefix, index) => {
    vi.stubEnv(`${prefix}_BATCH_TARGET_RELEASE_ID`, `release-${index}`);
    vi.stubEnv(`${prefix}_WORKER_SOURCE_GIT_SHA`, "a".repeat(40));
    vi.stubEnv(`${prefix}_WORKER_IMAGE_DIGEST`, `sha256:${"b".repeat(64)}`);
    vi.stubEnv(
      `${prefix}_JOB_DEFINITION_ARN`,
      `arn:aws:batch:ap-northeast-2:123456789012:job-definition/target-${index}:1`,
    );
    vi.stubEnv(
      `${prefix}_BATCH_QUEUE_ARN`,
      `arn:aws:batch:ap-northeast-2:123456789012:job-queue/target-${index}`,
    );
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("job admission preflight", () => {
  it("returns one fingerprint only when all five targets are complete", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ready: true,
      publicAdmissionChecked: true,
      targetCount: 5,
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("fails closed without exposing the missing variable", async () => {
    vi.stubEnv("SOURCE_RANGE_WORKER_IMAGE_DIGEST", "");
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ready: false,
      detail: "Job admission configuration is incomplete",
    });
  });
});

it.each(["fenced", "admin_ready", "unknown"])("rejects %s even with complete target configuration", async phase => {
  db.mockResolvedValue([{ operation: { version: 1, phase } }]);
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ ready: false, code: "INITIAL_RENDER_RELEASE_HANDOFF" });
});
it("rejects missing and inaccessible state", async () => {
  db.mockResolvedValue([]); expect((await GET()).status).toBe(503);
  db.mockRejectedValue(new Error("unavailable")); expect((await GET()).status).toBe(503);
});
it("accepts the restored active predecessor", async () => {
  db.mockResolvedValue([{ operation: { version: 1, phase: "active", outcome: "cancel" } }]);
  expect((await GET()).status).toBe(200);
});
