import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  assertRelease: vi.fn(),
  master: vi.fn(),
  global: vi.fn(),
  v4: vi.fn(),
  uploadMaster: vi.fn(),
  resolveUpload: vi.fn(),
  targets: vi.fn(),
}));
vi.mock("@/lib/custom-template-design", () => ({ assertCustomTemplateDesignRenderRelease: mocks.assertRelease }));
vi.mock("@/lib/editor-rendering-release", () => ({
  editorRenderingV2MasterEnabled: mocks.master,
  editorRenderingV2GlobalEnabled: mocks.global,
}));
vi.mock("@/lib/editor-render-v4-feature", () => ({ isEditorRenderSpecV4Enabled: mocks.v4 }));
vi.mock("@/lib/file-upload-release", () => ({
  FILE_UPLOAD_FLAG_KEY: "file_upload",
  FILE_UPLOAD_PUBLIC_FLAG_KEY: "file_upload_public",
  FILE_UPLOAD_EMERGENCY_STOP_FLAG_KEY: "file_upload_emergency_stop",
  fileUploadMasterEnabled: mocks.uploadMaster,
}));
vi.mock("@/lib/initial-render-release", () => ({ resolveFileUploadInitialRenderRelease: mocks.resolveUpload }));
vi.mock("@/lib/job-dispatch", () => ({ allProjectDispatchTargets: mocks.targets }));

import {
  assertCustomTemplateDesignCanaryResults,
  assertCustomTemplateDesignRuntimeReady,
  getCustomTemplateDesignAdminState,
} from "@/lib/custom-template-design-admin";
import { HttpError } from "@/lib/http";

const STABLE = "11111111-1111-4111-8111-111111111111";
const CANDIDATE = "22222222-2222-4222-8222-222222222222";
const UPLOAD = "33333333-3333-4333-8333-333333333333";
const ENABLED_FLAG = "custom_template_design_enabled";
const PUBLIC_FLAG = "custom_template_design_public";
const gitSha = "a".repeat(40);
const workerImageDigest = `sha256:${"b".repeat(64)}`;
const fontManifestSha256 = "c".repeat(64);

function deployedTargets() {
  return ["legacy_project", "source_range", "elevenlabs_transcription", "subtitle_templates", "unified_template_subtitles"].map((targetKey) => ({
    targetKey,
    releaseId: `logical-${targetKey}`,
    workerSourceGitSha: gitSha,
    workerImageDigest,
    jobDefinitionArn: `arn:aws:batch:ap-northeast-2:123456789012:job-definition/${targetKey}:5`,
    jobQueueArn: `arn:aws:batch:ap-northeast-2:123456789012:job-queue/${targetKey}`,
    v4Capability: { renderSpecVersion: 4, captionRenderSpecVersion: 4, fontManifestSha256 },
  }));
}

type Row = Record<string, unknown>;
function fixture() {
  return {
    uploadFlags: [
      { flagKey: "file_upload", enabled: true },
      { flagKey: "file_upload_public", enabled: true },
      { flagKey: "file_upload_emergency_stop", enabled: false },
    ] as Row[],
    states: [{
      stableReleaseId: STABLE, candidateReleaseId: CANDIDATE,
      canaryEnabled: false, publicEnabled: true,
      renderV4InternalEnabled: false, renderV4RolloutPercent: 100,
      renderV4KillSwitch: false, leaseActive: false, editorEnabled: true,
    }] as Row[],
    registered: deployedTargets().map((target) => ({
      targetKey: target.targetKey,
      batchTargetReleaseId: target.releaseId,
      workerSourceGitSha: target.workerSourceGitSha,
      workerImageDigest: target.workerImageDigest,
      jobDefinitionArn: target.jobDefinitionArn,
      jobQueueArn: target.jobQueueArn,
      renderSpecVersion: 4, captionRenderSpecVersion: 4, fontManifestSha256,
      releaseGitSha: gitSha, releaseWorkerImageDigest: workerImageDigest,
    })) as Row[],
    sources: [{ sourceType: "youtube" }, { sourceType: "upload" }] as Row[],
    designFlags: [
      { flagKey: ENABLED_FLAG, enabled: false },
      { flagKey: PUBLIC_FLAG, enabled: false },
    ] as Row[],
  };
}

function database(data = fixture()) {
  const statements: { sql: string; values: unknown[] }[] = [];
  const tx = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?").replace(/\s+/g, " ").trim();
    statements.push({ sql, values });
    if (sql.includes("from shorts_mvp.editor_release_state")) return data.states;
    if (sql.includes("from shorts_mvp.editor_release_project_targets")) return data.registered;
    if (sql.includes("select distinct j.source_type")) return data.sources;
    if (sql.includes("from shorts_mvp.runtime_feature_flags")) {
      return values.includes("file_upload") ? data.uploadFlags : data.designFlags;
    }
    throw new Error(`Unexpected test query: ${sql}`);
  });
  const begin = vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx));
  return { tx, db: Object.assign(tx, { begin }), begin, statements, data };
}

beforeEach(() => {
  vi.resetAllMocks();
  for (const mock of [mocks.master, mocks.global, mocks.v4, mocks.uploadMaster]) mock.mockReturnValue(true);
  mocks.targets.mockReturnValue(deployedTargets());
  mocks.resolveUpload.mockResolvedValue({ releaseId: UPLOAD });
  mocks.assertRelease.mockResolvedValue(undefined);
});

describe("custom template design runtime readiness", () => {
  it("accepts the exact five deployed stable targets without requiring internal canary enablement", async () => {
    const { tx, statements } = database();
    await expect(assertCustomTemplateDesignRuntimeReady(tx as never, true)).resolves.toEqual({
      projectReleaseId: STABLE, uploadReleaseId: UPLOAD,
    });
    expect(mocks.assertRelease.mock.calls.map((call) => call[1])).toEqual([STABLE, UPLOAD]);
    expect(mocks.resolveUpload).toHaveBeenCalledWith(tx, {
      targetKey: "legacy_project", access: { adminEnabled: false, publicEnabled: true },
    });
    expect(statements[0].values).toEqual(["file_upload", "file_upload_public", "file_upload_emergency_stop"]);
    expect(statements[0].sql).toContain("for share");
    expect(statements[1].sql).toContain("for share of s,f");
    const targetSql = statements[2].sql;
    expect(targetSql).toContain("join shorts_mvp.editor_releases release on release.id=target.release_id");
    expect(targetSql).toContain("release.render_spec_version,release.caption_render_spec_version,release.font_manifest_sha256");
    expect(targetSql).not.toContain("target.render_spec_version");
    expect(targetSql).not.toContain("target.font_manifest_sha256");
    expect(targetSql).toContain("for share of target,release");
  });

  it("uses the verified candidate for internal testing and preserves the actual upload public flag", async () => {
    const data = fixture();
    Object.assign(data.states[0], { canaryEnabled: true, renderV4InternalEnabled: true, publicEnabled: false, renderV4RolloutPercent: 0 });
    data.uploadFlags[1].enabled = false;
    const { tx } = database(data);
    await expect(assertCustomTemplateDesignRuntimeReady(tx as never, false)).resolves.toEqual({
      projectReleaseId: CANDIDATE, uploadReleaseId: UPLOAD,
    });
    expect(mocks.assertRelease).toHaveBeenNthCalledWith(1, tx, CANDIDATE);
    expect(mocks.resolveUpload).toHaveBeenCalledWith(tx, {
      targetKey: "legacy_project", access: { adminEnabled: true, publicEnabled: false },
    });
  });

  it("supports a verified admin-ready successor while preserving internal=false", async () => {
    const data = fixture();
    Object.assign(data.states[0], { canaryEnabled: true, renderV4TargetSuccessor: {
      version: 1, phase: "admin_ready", predecessorReleaseId: STABLE, successorReleaseId: CANDIDATE,
    } });
    const { tx } = database(data);
    await expect(assertCustomTemplateDesignRuntimeReady(tx as never, false)).resolves.toEqual({
      projectReleaseId: CANDIDATE, uploadReleaseId: UPLOAD,
    });
    expect(mocks.assertRelease).toHaveBeenNthCalledWith(1, tx, CANDIDATE);
    expect(data.states[0].renderV4InternalEnabled).toBe(false);
    await expect(assertCustomTemplateDesignRuntimeReady(tx as never, true)).rejects.toMatchObject({ status: 409 });
  });

  it.each([
    { version: 1, phase: "fenced" },
    { version: 2, phase: "active", activeReleaseId: STABLE },
    { version: 1, phase: "active", activeReleaseId: CANDIDATE },
    { version: 1, phase: "active", successorReleaseId: STABLE },
    { version: 1, phase: "admin_ready", predecessorReleaseId: CANDIDATE, successorReleaseId: CANDIDATE },
  ])("does not expose a fenced or mismatched successor state: %j", async (successor) => {
    const data = fixture();
    data.states[0].renderV4TargetSuccessor = successor;
    await expect(assertCustomTemplateDesignRuntimeReady(database(data).tx as never, false)).rejects.toMatchObject({ status: 409 });
    expect(mocks.assertRelease).not.toHaveBeenCalled();
  });

  it("uses the explicit active pin after a verified restoration instead of the abandoned successor", async () => {
    const data = fixture();
    data.states[0].renderV4TargetSuccessor = { version: 1, phase: "active",
      predecessorReleaseId: STABLE, successorReleaseId: CANDIDATE,
      activeReleaseId: STABLE, outcome: "cancel" };
    await expect(assertCustomTemplateDesignRuntimeReady(database(data).tx as never, true))
      .resolves.toEqual({ projectReleaseId: STABLE, uploadReleaseId: UPLOAD });
  });

  it.each(["master", "global", "v4", "uploadMaster"] as const)("rejects a disabled %s environment gate before reading runtime state", async (name) => {
    mocks[name].mockReturnValue(false);
    const { tx } = database();
    await expect(assertCustomTemplateDesignRuntimeReady(tx as never, false)).rejects.toMatchObject({ status: 409 });
    expect(tx).not.toHaveBeenCalled();
  });

  it.each([
    ["file_upload", false],
    ["file_upload_public", false],
    ["file_upload_emergency_stop", true],
  ])("requires the real upload mode for public availability: %s=%s", async (flag, value) => {
    const data = fixture();
    data.uploadFlags.find((row) => row.flagKey === flag)!.enabled = value;
    const { tx } = database(data);
    await expect(assertCustomTemplateDesignRuntimeReady(tx as never, true)).rejects.toMatchObject({ code: "CUSTOM_TEMPLATE_DESIGN_RUNTIME_NOT_READY" });
    expect(mocks.resolveUpload).not.toHaveBeenCalled();
    expect(mocks.assertRelease).not.toHaveBeenCalled();
  });

  it("does not treat a missing emergency-stop flag as verified OFF", async () => {
    const data = fixture();
    data.uploadFlags.pop();
    await expect(assertCustomTemplateDesignRuntimeReady(database(data).tx as never, false)).rejects.toMatchObject({ status: 409 });
  });

  it.each([
    { editorEnabled: false }, { renderV4KillSwitch: true }, { leaseActive: true },
    { renderV4KillSwitch: null }, { leaseActive: undefined },
    { publicEnabled: false }, { renderV4RolloutPercent: 99 },
  ])("fails closed on incomplete or suspended release state %j", async (patch) => {
    const data = fixture();
    Object.assign(data.states[0], patch);
    await expect(assertCustomTemplateDesignRuntimeReady(database(data).tx as never, true)).rejects.toMatchObject({ status: 409 });
    expect(mocks.assertRelease).not.toHaveBeenCalled();
  });

  it("does not use an inactive candidate as an implicit public fallback", async () => {
    const data = fixture();
    Object.assign(data.states[0], { canaryEnabled: true, renderV4InternalEnabled: false, publicEnabled: false });
    await expect(assertCustomTemplateDesignRuntimeReady(database(data).tx as never, false)).rejects.toMatchObject({ status: 409 });
  });

  it.each([
    ["targetKey", "unrecognized"], ["batchTargetReleaseId", "older-logical-release"],
    ["workerSourceGitSha", "d".repeat(40)], ["workerImageDigest", `sha256:${"d".repeat(64)}`],
    ["releaseGitSha", "d".repeat(40)], ["releaseWorkerImageDigest", `sha256:${"d".repeat(64)}`],
    ["jobDefinitionArn", "different-definition"], ["jobQueueArn", "different-queue"],
    ["renderSpecVersion", 3], ["captionRenderSpecVersion", 3],
    ["fontManifestSha256", "d".repeat(64)],
  ])("rejects a registered %s mismatch before receiver readiness", async (field, value) => {
    const data = fixture();
    data.registered[0][field] = value;
    await expect(assertCustomTemplateDesignRuntimeReady(database(data).tx as never, true)).rejects.toMatchObject({ status: 409 });
    expect(mocks.resolveUpload).not.toHaveBeenCalled();
  });

  it("requires all five registered and all five distinct deployed targets", async () => {
    const data = fixture();
    data.registered.pop();
    await expect(assertCustomTemplateDesignRuntimeReady(database(data).tx as never, true)).rejects.toMatchObject({ status: 409 });
    const targets = deployedTargets();
    targets[4] = targets[0];
    mocks.targets.mockReturnValue(targets);
    await expect(assertCustomTemplateDesignRuntimeReady(database().tx as never, true)).rejects.toMatchObject({ status: 409 });
  });

  it("requires explicit web manifest v4 capability rather than relying on registered metadata alone", async () => {
    mocks.targets.mockReturnValue(deployedTargets().map((target, index) => index ? target : { ...target, v4Capability: null }));
    await expect(assertCustomTemplateDesignRuntimeReady(database().tx as never, true)).rejects.toMatchObject({ status: 409 });
  });

  it("blocks a missing or unverified upload receiver without changing targets or flags", async () => {
    mocks.resolveUpload.mockResolvedValue(null);
    const first = database();
    await expect(assertCustomTemplateDesignRuntimeReady(first.tx as never, false)).rejects.toMatchObject({ status: 409 });
    mocks.resolveUpload.mockResolvedValue({ releaseId: UPLOAD });
    mocks.assertRelease.mockImplementation(async (_tx, releaseId) => {
      if (releaseId === UPLOAD) throw new HttpError(503, "receiver evidence missing");
    });
    await expect(assertCustomTemplateDesignRuntimeReady(database().tx as never, true)).rejects.toMatchObject({ status: 503 });
    expect(first.statements.every(({ sql }) => !/\b(insert|update|delete)\b/i.test(sql))).toBe(true);
  });
});

describe("administrator canary generation and re-edit evidence", () => {
  it("requires both actual source paths on the exact tested release and latest ready output", async () => {
    const { tx, statements } = database();
    await expect(assertCustomTemplateDesignCanaryResults(tx as never, { projectReleaseId: STABLE, uploadReleaseId: UPLOAD })).resolves.toBeUndefined();
    expect(statements).toHaveLength(1);
    const { sql, values } = statements[0];
    expect(values).toEqual([UPLOAD, STABLE, STABLE]);
    for (const guard of [
      "u.is_admin and u.withdrawn_at is null", "s.user_id=j.user_id", "r.user_id=j.user_id",
      "edit_release.worker_image_digest=r.worker_image_digest", "j.status='completed'", "j.user_deleted_at is null",
      "j.source_type in ('youtube','upload')", "j.initial_editor_release_id=case",
      "j.template_snapshot#>>'{config,background,kind}'='uploaded_image'",
      "jsonb_typeof(j.template_snapshot#>'{config,textOverlays}')='array'",
      "s.status='ready'", "length(s.output_s3_key)>0", "s.deleted_at is null", "s.expires_at>now()",
      "s.pending_edit_request_id is null", "s.editor_document#>>'{overlays,background,kind}'",
      "s.editor_document#>>'{template,snapshot,config,background,kind}'",
      "saved_text->>'id' like 'tpl:' || (j.template_snapshot->>'id') || ':%'",
      "r.status='succeeded'", "r.completed_at is not null", "r.batch_job_id is not null",
      "r.output_render_version=s.render_version",
    ]) expect(sql).toContain(guard);
  });

  it.each([
    { sources: [] }, { sources: [{ sourceType: "youtube" }] }, { sources: [{ sourceType: "upload" }] },
    { sources: [{ sourceType: "youtube" }, { sourceType: "youtube" }] },
  ])(
    "does not let incomplete source evidence substitute for both flows: %j", async ({ sources }) => {
      const data = fixture();
      data.sources = sources;
      await expect(assertCustomTemplateDesignCanaryResults(database(data).tx as never, { projectReleaseId: STABLE, uploadReleaseId: UPLOAD }))
        .rejects.toMatchObject({ status: 409, code: "CUSTOM_TEMPLATE_DESIGN_CANARY_REQUIRED" });
    },
  );
});

describe("read-only administrator rollout state", () => {
  it("defaults to OFF with missing seed rows and skips runtime checks", async () => {
    for (const designFlags of [[], [{ flagKey: ENABLED_FLAG, enabled: true }]]) {
      const data = fixture();
      data.designFlags = designFlags;
      const { db, begin } = database(data);
      await expect(getCustomTemplateDesignAdminState(db as never)).resolves.toMatchObject({ mode: "off", readyForAdmin: false, readyForPublic: false });
      expect(begin).not.toHaveBeenCalled();
    }
  });

  it("reports readiness without enabling the default-OFF feature", async () => {
    const { db, statements } = database();
    await expect(getCustomTemplateDesignAdminState(db as never)).resolves.toEqual({ mode: "off", readyForAdmin: true, readyForPublic: true });
    expect(statements.every(({ sql }) => !/\b(insert|update|delete)\b/i.test(sql))).toBe(true);
  });

  it.each([
    [false, true, "off"], [true, false, "admin"], [true, true, "public"],
  ])("reports mode from strict flags enabled=%s public=%s", async (enabled, publicEnabled, mode) => {
    const data = fixture();
    data.designFlags[0].enabled = enabled;
    data.designFlags[1].enabled = publicEnabled;
    expect((await getCustomTemplateDesignAdminState(database(data).db as never)).mode).toBe(mode);
  });

  it("keeps administrator testing available but public disabled until both canaries complete", async () => {
    const data = fixture();
    data.sources = [{ sourceType: "youtube" }];
    const state = await getCustomTemplateDesignAdminState(database(data).db as never);
    expect(state).toMatchObject({ readyForAdmin: true, readyForPublic: false });
    expect(state.readinessMessage).toContain("다운로드 영상과 미리보기도 확인");
  });

  it("reports a temporarily unhealthy published mode without silently turning it off", async () => {
    const data = fixture();
    data.designFlags[0].enabled = true;
    data.designFlags[1].enabled = true;
    mocks.assertRelease.mockRejectedValue(new Error("internal connection string must not leak"));
    const state = await getCustomTemplateDesignAdminState(database(data).db as never);
    expect(state).toMatchObject({ mode: "public", readyForAdmin: false, readyForPublic: false });
    expect(state.readinessMessage).not.toContain("internal connection string");
  });
});
