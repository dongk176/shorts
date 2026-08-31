import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), db: vi.fn(), proof: vi.fn(), targets: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin", () => ({ requireAdminUser: mocks.admin }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/custom-template-design", () => ({ assertCustomTemplateDesignRenderRelease: mocks.proof }));
vi.mock("@/lib/job-dispatch", () => ({ allProjectDispatchTargets: mocks.targets }));
import { promoteEditorRelease, recordEditorReleaseCanaryCheck, startEditorReleaseCanary } from "./editor-release-actions";

const STABLE = "11111111-1111-4111-8111-111111111111";
const CANDIDATE = "22222222-2222-4222-8222-222222222222";
const FONT = "a".repeat(64);
const OLD_SHA = "d".repeat(40);
const OLD_DIGEST = `sha256:${"e".repeat(64)}`;
const OLD_EDITOR = "arn:aws:batch:ap-northeast-2:123456789012:job-definition/editor-old:1";
const targetKeys = ["legacy_project", "source_range", "elevenlabs_transcription", "subtitle_templates", "unified_template_subtitles"];
function predecessorProof() {
  return { compatibleSuccessor: { version: 1, predecessorReleaseId: STABLE,
    sourceGitSha: OLD_SHA, workerImageDigest: OLD_DIGEST, fontManifestSha256: FONT,
    editor: { jobDefinitionArn: OLD_EDITOR, contractSha256: FONT },
    projectTargets: Object.fromEntries(targetKeys.map((key) => [key, {
      batchTargetReleaseId: `old-${key}`, workerSourceGitSha: OLD_SHA, workerImageDigest: OLD_DIGEST,
      jobDefinitionArn: `arn:${key}`, jobQueueArn: `queue:${key}`, contractSha256: FONT,
    }])),
  } };
}
const isolated = ["worker-image", "legacy-no-timeline", "captured-timeline", "editor-v2", "ffprobe", "frame-parity", "browser-worker-visual-parity"];
const canary = ["save-render-download", "gemini-comments", "reopen-reedit", "rollback-drill", "initial-project-admission"];

function database(options: {
  state?: Record<string, unknown>; release?: Record<string, unknown>; stable?: Record<string, unknown>;
  missingCheck?: string; runtimeEnabled?: boolean; lease?: boolean; targetDrift?: boolean;
  successorAdminReleaseId?: string | null;
} = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const tx = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?").replace(/\s+/g, " ").trim();
    calls.push({ sql, values });
    if (sql.includes("select shorts_mvp.editor_target_successor_admin_release")) {
      return [{ releaseId: options.successorAdminReleaseId === undefined ? CANDIDATE : options.successorAdminReleaseId }];
    }
    if (sql.includes("as lease_active")) return [{ leaseActive: options.lease ?? false }];
    if (sql.startsWith("select") && sql.includes("from shorts_mvp.editor_release_state")) {
      return [{ stableReleaseId: STABLE, candidateReleaseId: CANDIDATE, canaryEnabled: true,
        publicEnabled: true, renderV4InternalEnabled: true, renderV4RolloutPercent: 100,
        renderV4KillSwitch: false, renderSpecVersion: 4, ...options.state }];
    }
    if (sql.startsWith("select status,")) return [{ status: "stable", renderSpecVersion: 4,
      captionRenderSpecVersion: 4, fontManifestSha256: FONT, gitSha: OLD_SHA,
      workerImageDigest: OLD_DIGEST, productionJobDefinitionArn: OLD_EDITOR, ...options.stable }];
    if (sql.startsWith("select id,status,git_sha")) return [{ id: CANDIDATE, status: "canary_active",
      gitSha: "b".repeat(40), workerImageDigest: `sha256:${"c".repeat(64)}`,
      renderSpecVersion: 4, captionRenderSpecVersion: 4, fontManifestSha256: FONT,
      customTemplateDesignVerified: true, ...options.release }];
    if (sql.startsWith("select enabled from shorts_mvp.runtime_feature_flags")) {
      return [{ enabled: options.runtimeEnabled ?? true }];
    }
    if (sql.includes("as target_count")) return [{ targetCount: 5, identitiesMatch: true }];
    if (sql.startsWith("select target_key,batch_target_release_id")) return targetKeys.map((targetKey) => ({
      targetKey, ...predecessorProof().compatibleSuccessor.projectTargets[targetKey],
      ...(options.targetDrift ? { jobQueueArn: "changed-queue" } : {}),
    }));
    if (sql.startsWith("select check_name,status")) return (
      values.includes("isolated") ? isolated : canary
    ).filter((checkName) => checkName !== options.missingCheck).map((checkName) => ({ checkName, status: "passed" }));
    if (sql.includes("from shorts_mvp.editor_render_requests")) return [{ active: 0, failed: 0, succeeded: 1 }];
    return [];
  });
  Object.assign(tx, { json: (value: unknown) => value });
  mocks.db.mockReturnValue({ begin: (run: (tx: unknown) => Promise<unknown>) => run(tx) });
  return { calls, tx, mutations: () => calls.filter(({ sql }) => /^(update|insert)/.test(sql)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("EDITOR_RENDERING_V2_ENABLED", "true");
  vi.stubEnv("EDITOR_RENDERING_V2_GLOBAL_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_EDITOR_RENDER_SPEC_V4_ENABLED", "true");
  mocks.admin.mockResolvedValue({ id: STABLE });
  mocks.proof.mockResolvedValue(predecessorProof());
  mocks.targets.mockReturnValue(Array.from({ length: 5 }, (_, targetKey) => ({ targetKey,
    v4Capability: { renderSpecVersion: 4, captionRenderSpecVersion: 4, fontManifestSha256: FONT } })));
});

describe("explicit compatible editor successor", () => {
  it("promotes only after every old check and new immutable proof, without resetting public settings", async () => {
    const db = database();
    await promoteEditorRelease(CANDIDATE, STABLE);
    expect(mocks.proof).toHaveBeenCalledWith(db.tx, CANDIDATE);
    const writes = db.mutations().map(({ sql }) => sql).join("\n");
    expect(writes).toContain("previous_stable_release_id=stable_release_id");
    expect(writes).not.toMatch(/render_v4_(rollout_percent|kill_switch|internal_enabled)=/);
    expect(writes).not.toContain("public_enabled=");
    expect(writes).not.toContain("update shorts_mvp.runtime_feature_flags");
    const lastEvidence = db.calls.findIndex(({ sql }) => sql.includes("from shorts_mvp.editor_render_requests"));
    const firstWrite = db.calls.findIndex(({ sql }) => /^(update|insert)/.test(sql));
    expect(firstWrite).toBeGreaterThan(lastEvidence);
  });
  it("starts the new canary without resetting the already-public subtitle suite", async () => {
    const db = database({ release: { status: "canary_ready" } });
    await startEditorReleaseCanary(CANDIDATE, STABLE);
    const writes = db.mutations().map(({ sql }) => sql).join("\n");
    expect(writes).toContain("canary_enabled=true");
    expect(writes).not.toContain("update shorts_mvp.runtime_feature_flags");
    expect(writes).not.toMatch(/render_v4_(rollout_percent|kill_switch|internal_enabled)=/);
  });
  it("promotes an exact admin-ready successor while keeping internal=false", async () => {
    const db = database({ state: { renderV4InternalEnabled: false } });
    await promoteEditorRelease(CANDIDATE, STABLE);
    const helper = db.calls.find(({ sql }) => sql.includes("select shorts_mvp.editor_target_successor_admin_release"));
    expect(helper?.values).toEqual([STABLE]);
    expect(db.mutations().map(({ sql }) => sql).join("\n")).not.toMatch(/render_v4_(rollout_percent|kill_switch|internal_enabled)=/);
  });
  it.each([null, STABLE])("does not use internal=true to bypass the exact successor handoff (%s)", async (releaseId) => {
    const db = database({ successorAdminReleaseId: releaseId });
    await expect(promoteEditorRelease(CANDIDATE, STABLE)).rejects.toMatchObject({ code: "EDITOR_SUCCESSOR_HANDOFF_NOT_READY" });
    expect(db.mutations()).toEqual([]);
  });
  it("checks ready handoff within the start transaction before recording success", async () => {
    const db = database({ release: { status: "canary_ready" }, successorAdminReleaseId: null });
    await expect(startEditorReleaseCanary(CANDIDATE, STABLE)).rejects.toMatchObject({ code: "EDITOR_SUCCESSOR_HANDOFF_NOT_READY" });
    expect(db.calls.some(({ sql }) => sql.includes("select shorts_mvp.editor_target_successor_admin_release"))).toBe(true);
    expect(db.calls.some(({ values }) => values.includes("editor_release.canary_started"))).toBe(false);
  });
  it("records administrator verification without switching internal exposure on", async () => {
    const db = database({ state: { renderV4InternalEnabled: false } });
    await recordEditorReleaseCanaryCheck(CANDIDATE, "initial-project-admission", "passed");
    expect(db.mutations().some(({ sql }) => sql.startsWith("insert into shorts_mvp.editor_release_checks"))).toBe(true);
    expect(db.mutations().map(({ sql }) => sql).join("\n")).not.toContain("update shorts_mvp.editor_release_state");
  });
  it.each([null, STABLE])("refuses canary evidence without actual successor admission (%s)", async (releaseId) => {
    const db = database({ state: { renderV4InternalEnabled: false }, successorAdminReleaseId: releaseId });
    await expect(recordEditorReleaseCanaryCheck(CANDIDATE, "initial-project-admission", "passed"))
      .rejects.toMatchObject({ code: "EDITOR_RENDER_V4_INTERNAL_CANARY_REQUIRED" });
    expect(db.mutations()).toEqual([]);
  });
  it("requires explicit successor intent for new-format candidates", async () => {
    let db = database();
    await expect(promoteEditorRelease(CANDIDATE)).rejects.toMatchObject({ code: "EDITOR_SUCCESSOR_PRESERVE_REQUIRED" });
    expect(db.mutations()).toEqual([]);
    db = database({ release: { status: "canary_ready" } });
    await expect(startEditorReleaseCanary(CANDIDATE)).rejects.toMatchObject({ code: "EDITOR_SUCCESSOR_PRESERVE_REQUIRED" });
    expect(db.mutations()).toEqual([]);
  });
  it.each([
    { state: { stableReleaseId: CANDIDATE } }, { state: { publicEnabled: false } },
    { state: { renderV4KillSwitch: true } }, { state: { renderV4RolloutPercent: 0 } },
    { stable: { fontManifestSha256: "f".repeat(64) } }, { stable: { renderSpecVersion: 3 } },
    { missingCheck: "initial-project-admission" }, { missingCheck: "browser-worker-visual-parity" },
    { runtimeEnabled: false }, { lease: true },
    { targetDrift: true }, { stable: { gitSha: "f".repeat(40) } },
  ])("rejects drift or incomplete checks before mutation: %j", async (options) => {
    const db = database(options);
    await expect(promoteEditorRelease(CANDIDATE, STABLE)).rejects.toBeInstanceOf(Error);
    expect(db.mutations()).toEqual([]);
  });
  it("cannot substitute a merely-v4 renderer for the new verified contract", async () => {
    const db = database();
    mocks.proof.mockRejectedValue(new Error("unattested"));
    await expect(promoteEditorRelease(CANDIDATE, STABLE)).rejects.toThrow("unattested");
    expect(db.mutations()).toEqual([]);
  });
  it("rejects an A-based candidate if production moved to B before promotion", async () => {
    const db = database();
    const proof = predecessorProof();
    proof.compatibleSuccessor.predecessorReleaseId = "33333333-3333-4333-8333-333333333333";
    mocks.proof.mockResolvedValue(proof);
    await expect(promoteEditorRelease(CANDIDATE, STABLE)).rejects.toMatchObject({ code: "EDITOR_SUCCESSOR_PROVENANCE_MISMATCH" });
    expect(db.mutations()).toEqual([]);
  });
  it("preserves the default stopped promotion for unrelated first-time v4 releases", async () => {
    const db = database({ release: { customTemplateDesignVerified: false } });
    await promoteEditorRelease(CANDIDATE);
    const writes = db.mutations().map(({ sql }) => sql).join("\n");
    expect(writes).toContain("render_v4_rollout_percent=0");
    expect(writes).toContain("render_v4_kill_switch=true");
    expect(mocks.proof).not.toHaveBeenCalled();
  });
  it("requires the authenticated administrator, regardless of claimed IDs", async () => {
    const db = database();
    mocks.admin.mockRejectedValue(new Error("administrator required"));
    await expect(promoteEditorRelease(CANDIDATE, STABLE)).rejects.toThrow("administrator required");
    expect(db.calls).toEqual([]);
  });
});
