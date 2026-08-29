import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileUploadCapacityTransientError } from "@/lib/file-upload-capacity-retry";
import { HttpError } from "@/lib/http";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  authenticatedSession: vi.fn(),
  getDb: vi.fn(),
  releaseAccess: vi.fn(),
  lockedReleaseAccess: vi.fn(),
  billingSummary: vi.fn(),
  usageSnapshot: vi.fn(),
  subtitleAccess: vi.fn(),
  transcriptionAccess: vi.fn(),
  thankYouGrant: vi.fn(),
  initialRenderRelease: vi.fn(),
  uploadDispatchTarget: vi.fn(),
  ensureUploadCapacity: vi.fn(),
  releaseUploadCapacity: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireAuthenticatedMvpSession: mocks.authenticatedSession,
}));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/file-upload-release", () => ({
  getFileUploadReleaseAccess: mocks.releaseAccess,
  lockFileUploadReleaseAccess: mocks.lockedReleaseAccess,
}));
vi.mock("@/lib/billing", () => ({
  getBillingSummary: mocks.billingSummary,
}));
vi.mock("@/lib/usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/usage")>()),
  getUsageSnapshot: mocks.usageSnapshot,
}));
vi.mock("@/lib/subtitle-template-release", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/subtitle-template-release")>()),
  lockEffectiveSubtitleTemplateAccess: mocks.subtitleAccess,
  lockSubtitleTemplateAccess: mocks.subtitleAccess,
}));
vi.mock("@/lib/transcription-release", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/transcription-release")>()),
  lockElevenLabsTranscriptionAccess: mocks.transcriptionAccess,
}));
vi.mock("@/lib/shorts-thank-you-event", () => ({
  issueShortsThankYouEventGrantIfEligible: mocks.thankYouGrant,
}));
vi.mock("@/lib/initial-render-release", () => ({
  resolveFileUploadInitialRenderRelease: mocks.initialRenderRelease,
}));
vi.mock("@/lib/job-dispatch", () => ({
  projectDispatchTargetForFeatures: mocks.uploadDispatchTarget,
}));
vi.mock("@/lib/aws", () => ({
  ensureFileUploadCapacity: mocks.ensureUploadCapacity,
  releaseFileUploadCapacity: mocks.releaseUploadCapacity,
}));

import {
  FILE_UPLOAD_CONTROL_BODY_MAX_BYTES,
  FILE_UPLOAD_MAX_BYTES,
  fileUploadBearerToken,
  fileUploadIntentHash,
  fileUploadTokenHash,
} from "@/lib/file-upload-control";
import {
  createDefaultTemplateConfig,
  upgradeTemplateConfigToV5,
} from "@/lib/template-config";
import { GET, POST } from "./route";

const SESSION_ID = "7bf704e2-f151-45a5-9939-69d2a62b22aa";
const USER_ID = "3d14e57e-d516-44b1-89ac-30d76a6e701f";
const REQUEST_ID = "3ba0f438-51ea-4a35-995f-0b50ba58e3ba";
const TOKEN_SECRET = "test-secret-with-at-least-thirty-two-bytes";
const EXPIRES_AT = "2026-08-23T13:00:00.000Z";

const validBody = {
  requestId: REQUEST_ID,
  file: {
    name: "folder/test-video.mp4",
    contentType: "video/mp4",
    sizeBytes: 123_456,
    durationSeconds: 600,
    width: 1920,
    height: 1080,
    hasAudio: true,
  },
  rangeStartSeconds: 60,
  rangeEndSeconds: 360,
  templateId: "dark-minimal",
  videoAspectRatio: "1:1",
  outputLanguage: "ko",
  rightsConfirmed: true,
};

function intentHashFor(body = validBody) {
  return fileUploadIntentHash({
    originalFilename: "test-video.mp4",
    declaredContentType: body.file.contentType.trim().toLowerCase()
      || "application/octet-stream",
    sizeBytes: body.file.sizeBytes,
    durationSeconds: body.file.durationSeconds,
    width: body.file.width ?? null,
    height: body.file.height ?? null,
    hasAudio: body.file.hasAudio,
    rangeStartSeconds: body.rangeStartSeconds,
    rangeEndSeconds: body.rangeEndSeconds,
    templateId: body.templateId,
    customTemplateId: null,
    videoAspectRatio: body.videoAspectRatio,
    outputLanguage: body.outputLanguage,
    subtitleTemplateId: null,
    subtitleCaptionPlacement: null,
    brandColor: null,
    rightsConfirmed: body.rightsConfirmed,
  });
}

const usage = {
  usedSeconds: 0,
  reservedSeconds: 0,
  limitSeconds: 10_000,
  remainingSeconds: 10_000,
  baseUsedSeconds: 0,
  baseReservedSeconds: 0,
  baseLimitSeconds: 10_000,
  baseRemainingSeconds: 10_000,
  addonRemainingSeconds: 0,
  periodStart: "2026-08-01T00:00:00.000Z",
  nextResetAt: "2026-09-01T00:00:00.000Z",
  enforcementEnabled: true,
};

const billing = {
  canCreateJobs: true,
  maxActiveJobs: 1,
  retentionDays: 30,
  activeProducts: [{ planCode: "starter_3m" }],
  hasManagedFeatureAccess: false,
};

function jsonRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/file-upload/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

type TransactionOptions = {
  existing?: Record<string, unknown>;
  activeJobs?: number;
  projectNumber?: number;
  customTemplate?: Record<string, unknown>;
  failUploadSessionInsert?: boolean;
};

function transactionDb(options: TransactionOptions = {}) {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const tx = Object.assign(vi.fn(async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    const sql = Array.from(strings).join("?").replace(/\s+/g, " ").trim();
    queries.push({ sql, values });
    if (sql.includes("where upload.request_id=")) {
      return options.existing ? [{ source: "upload", ...options.existing }] : [];
    }
    if (sql.includes("select count(*)::int as active")) {
      return [{ active: options.activeJobs ?? 0 }];
    }
    if (sql.includes("nextval('shorts_mvp.video_job_project_number_seq')")) {
      return [{ projectNumber: options.projectNumber ?? 321 }];
    }
    if (sql.includes("from shorts_mvp.custom_templates")) {
      return options.customTemplate ? [options.customTemplate] : [];
    }
    if (sql.includes("insert into shorts_mvp.usage_reservations")) {
      return [{ id: "62a66eaf-196a-4bd9-b8dc-d3b3dd65dac4" }];
    }
    if (sql.includes("insert into shorts_mvp.file_upload_capacity_requests")) {
      if (options.failUploadSessionInsert) throw new Error("insert failed");
      return [{ queueExpiresAt: EXPIRES_AT }];
    }
    if (sql.includes("select capacity.status")) return [{ status: "waiting" }];
    if (sql.includes("select upload.status,upload.consumed_at")) {
      return [{ status: "awaiting_upload", consumedAt: null }];
    }
    return [];
  }), {
    json: vi.fn((value: unknown) => value),
  });
  const db = Object.assign(vi.fn(async () => [{ desiredCount: 1 }]), {
    begin: vi.fn(async (callback: (transaction: typeof tx) => unknown) => (
      callback(tx)
    )),
  });
  return { db, tx, queries };
}

function query(
  queries: Array<{ sql: string; values: unknown[] }>,
  fragment: string,
) {
  return queries.find((entry) => entry.sql.includes(fragment));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("UNIFIED_TEMPLATE_SUBTITLE_LOCAL_UPLOAD_ENABLED", "");
  vi.stubEnv("FILE_UPLOAD_RECEIVER_URL", "https://receiver.example.com/base");
  vi.stubEnv("FILE_UPLOAD_RECEIVER_ALLOWED_HOSTS", "receiver.example.com");
  vi.stubEnv("FILE_UPLOAD_TOKEN_SECRET", TOKEN_SECRET);
  mocks.authenticatedSession.mockResolvedValue({ id: SESSION_ID, userId: USER_ID });
  mocks.releaseAccess.mockResolvedValue({ enabled: true, adminEnabled: true });
  mocks.lockedReleaseAccess.mockResolvedValue({
    enabled: true,
    adminEnabled: true,
    publicEnabled: false,
  });
  mocks.billingSummary.mockResolvedValue(billing);
  mocks.usageSnapshot.mockResolvedValue(usage);
  mocks.subtitleAccess.mockResolvedValue({
    enabled: true,
    unifiedEnabled: true,
  });
  mocks.transcriptionAccess.mockResolvedValue({
    enabled: true,
    policy: "elevenlabs_primary_openai_fallback",
  });
  mocks.thankYouGrant.mockResolvedValue({
    granted: false,
    grantedSeconds: 0,
    validUntil: null,
  });
  mocks.initialRenderRelease.mockResolvedValue({
    releaseId: "f223e9e5-6aad-449f-8d2d-99202bfed190",
    renderSpecVersion: 4,
    captionRenderSpecVersion: 4,
    fontManifestSha256: "a".repeat(64),
    workerImageDigest: `sha256:${"b".repeat(64)}`,
  });
  mocks.uploadDispatchTarget.mockReturnValue({
    targetKey: "elevenlabs_transcription",
    releaseId: "editor-v4",
    workerSourceGitSha: "a".repeat(40),
    workerImageDigest: `sha256:${"b".repeat(64)}`,
    jobDefinitionArn:
      "arn:aws:batch:ap-northeast-2:123456789012:job-definition/editor-v4:1",
    jobQueueArn:
      "arn:aws:batch:ap-northeast-2:123456789012:job-queue/editor-v4",
    v4Capability: {
      renderSpecVersion: 4,
      captionRenderSpecVersion: 4,
      fontManifestSha256: "a".repeat(64),
    },
  });
  mocks.ensureUploadCapacity.mockResolvedValue({
    desiredCount: 1,
    runningCount: 1,
    pendingCount: 0,
  });
  mocks.releaseUploadCapacity.mockResolvedValue(undefined);
});

describe("file upload job control plane", () => {
  it("conceals GET and signed-out/off POST probes with the same 404", async () => {
    const getResponse = await GET();
    expect(getResponse.status).toBe(404);
    await expect(getResponse.json()).resolves.toEqual({
      detail: "찾을 수 없습니다.",
      code: "NOT_FOUND",
    });

    mocks.authenticatedSession.mockRejectedValueOnce(
      new HttpError(401, "로그인이 필요합니다."),
    );
    const signedOut = await POST(jsonRequest(validBody));
    expect(signedOut.status).toBe(404);
    expect(mocks.getDb).not.toHaveBeenCalled();

    const { db } = transactionDb();
    mocks.getDb.mockReturnValue(db);
    mocks.releaseAccess.mockResolvedValueOnce({
      enabled: false,
      adminEnabled: false,
      publicEnabled: false,
    });
    const unavailable = await POST(jsonRequest(validBody));
    expect(unavailable.status).toBe(404);
    expect(db.begin).not.toHaveBeenCalled();

    mocks.releaseAccess.mockResolvedValueOnce({
      enabled: false,
      adminEnabled: false,
    });
    const disabled = await POST(jsonRequest(validBody));
    expect(disabled.status).toBe(404);
  });

  it("rechecks the locked release gate before receiver configuration or writes", async () => {
    const { db, queries } = transactionDb();
    mocks.getDb.mockReturnValue(db);
    mocks.lockedReleaseAccess.mockResolvedValue({
      enabled: false,
      adminEnabled: false,
      publicEnabled: false,
    });
    vi.stubEnv("FILE_UPLOAD_RECEIVER_URL", "");
    vi.stubEnv("FILE_UPLOAD_RECEIVER_ALLOWED_HOSTS", "");
    vi.stubEnv("FILE_UPLOAD_TOKEN_SECRET", "");

    const response = await POST(jsonRequest(validBody));

    expect(response.status).toBe(404);
    expect(queries.some((entry) => entry.sql.includes("insert into"))).toBe(false);
  });

  it("returns 503 for missing receiver configuration only after both release gates", async () => {
    const { db, queries } = transactionDb();
    mocks.getDb.mockReturnValue(db);
    vi.stubEnv("FILE_UPLOAD_TOKEN_SECRET", "");

    const response = await POST(jsonRequest(validBody));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "FILE_UPLOAD_RECEIVER_UNAVAILABLE",
    });
    expect(queries.some((entry) => entry.sql.includes("insert into"))).toBe(false);
  });

  it("creates the isolated upload job, reserves exact usage, and returns a bearer without persisting it", async () => {
    const { db, queries } = transactionDb({ projectNumber: 987 });
    mocks.getDb.mockReturnValue(db);

    const response = await POST(jsonRequest(validBody));
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(body).toMatchObject({
      projectNumber: 987,
      uploadUrl: expect.stringMatching(
        /^https:\/\/receiver\.example\.com\/base\/v1\/upload-sessions\/[0-9a-f-]+\/source$/,
      ),
      token: expect.stringMatching(/^easycut-upload-v1\./),
      expiresAt: null,
      preparationExpiresAt: EXPIRES_AT,
      status: "preparing",
      usage,
    });
    expect(body.jobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.uploadSessionId).toMatch(/^[0-9a-f-]{36}$/);

    const jobInsert = query(queries, "insert into shorts_mvp.video_jobs");
    expect(jobInsert?.sql).toContain("'upload_service','uploading','uploading'");
    expect(jobInsert?.sql).toContain("'upload'");
    expect(jobInsert?.values).toEqual(expect.arrayContaining([
      null,
      "test-video.mp4",
      "",
      "/api/projects/987/source-thumbnail",
      300,
    ]));
    const reservation = query(queries, "insert into shorts_mvp.usage_reservations");
    expect(reservation?.values).toContain(300);
    expect(query(queries, "reserve_usage_grants")?.values).toContain(300);
    expect(query(queries, "initialize_project_output_attempts")).toBeTruthy();
    expect(mocks.thankYouGrant).toHaveBeenCalledWith(expect.anything(), USER_ID);

    const sessionInsert = query(
      queries,
      "insert into shorts_mvp.file_upload_capacity_requests",
    );
    expect(sessionInsert?.values).toEqual(expect.arrayContaining([
      "test-video.mp4",
      "video/mp4",
      123_456,
      body.uploadUrl,
      fileUploadTokenHash(body.token),
      intentHashFor(),
    ]));
    expect(JSON.stringify(sessionInsert?.values)).not.toContain(body.token);
    expect(queries.some((entry) => entry.sql.includes("project_job_outbox"))).toBe(false);
  });

  it("stores the same trusted hidden-caption v5 snapshot without legacy subtitle fields", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("UNIFIED_TEMPLATE_SUBTITLE_LOCAL_UPLOAD_ENABLED", "true");
    vi.stubEnv("FILE_UPLOAD_RECEIVER_URL", "https://127.0.0.1:4443/base");
    vi.stubEnv("FILE_UPLOAD_RECEIVER_ALLOWED_HOSTS", "127.0.0.1");
    const customTemplateId = "35aa2b2e-e7df-48d7-9dbc-2b6224c4ffef";
    const config = upgradeTemplateConfigToV5(
      createDefaultTemplateConfig("comment-capture"),
    );
    config.subtitle = {
      ...config.subtitle,
      visible: false,
      variant: "highlight",
      y: 1_260,
      maxWidth: 800,
      fontId: "paperlogy",
      fontSize: 76,
      color: "#FFFFFF",
      accentColor: "#35E6E3",
    };
    const { db, queries } = transactionDb({
      projectNumber: 988,
      customTemplate: {
        id: customTemplateId,
        name: "업로드 통합 자막",
        baseTemplateId: "comment-capture",
        config,
        version: 1,
      },
    });
    mocks.getDb.mockReturnValue(db);

    const response = await POST(jsonRequest({
      ...validBody,
      customTemplateId,
      templateId: "dark-red",
    }));

    expect(
      response.status,
      JSON.stringify(await response.clone().json()),
    ).toBe(201);
    const jobInsert = query(queries, "insert into shorts_mvp.video_jobs");
    expect(jobInsert?.values).toEqual(expect.arrayContaining([
      "comment-capture",
      customTemplateId,
      expect.objectContaining({
        id: customTemplateId,
        config: expect.objectContaining({ schemaVersion: 5 }),
      }),
      "highlight",
      expect.objectContaining({
        schemaVersion: 4,
        enabled: false,
        subtitleTemplateId: "highlight",
        font: expect.objectContaining({ id: "paperlogy", sizePx: 76 }),
      }),
      "elevenlabs_primary_openai_fallback",
    ]));
    expect(mocks.subtitleAccess).toHaveBeenCalledWith(expect.anything(), USER_ID);
    expect(mocks.transcriptionAccess).toHaveBeenCalledWith(expect.anything(), USER_ID);
  });

  it("rejects a v5 upload when the strict subtitle canary is unavailable", async () => {
    const customTemplateId = "35aa2b2e-e7df-48d7-9dbc-2b6224c4ffef";
    const config = upgradeTemplateConfigToV5(createDefaultTemplateConfig());
    const { db, queries } = transactionDb({
      customTemplate: {
        id: customTemplateId,
        name: "차단된 통합 자막",
        baseTemplateId: "dark-minimal",
        config,
        version: 1,
      },
    });
    mocks.getDb.mockReturnValue(db);
    mocks.subtitleAccess.mockResolvedValueOnce({
      enabled: false,
      unifiedEnabled: false,
    });

    const response = await POST(jsonRequest({
      ...validBody,
      customTemplateId,
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "UNIFIED_TEMPLATE_SUBTITLE_CANARY_REQUIRED",
    });
    expect(query(queries, "insert into shorts_mvp.video_jobs")).toBeUndefined();
  });

  it("allows a v5 upload through the verified render release instead of a local-only exception", async () => {
    const customTemplateId = "35aa2b2e-e7df-48d7-9dbc-2b6224c4ffef";
    const config = upgradeTemplateConfigToV5(createDefaultTemplateConfig());
    const { db, queries } = transactionDb({
      customTemplate: {
        id: customTemplateId,
        name: "검증된 통합 자막",
        baseTemplateId: "dark-minimal",
        config,
        version: 1,
      },
    });
    mocks.getDb.mockReturnValue(db);

    const response = await POST(jsonRequest({
      ...validBody,
      customTemplateId,
    }));

    expect(response.status).toBe(201);
    expect(mocks.initialRenderRelease).toHaveBeenCalledWith(
      expect.anything(),
      {
        targetKey: "elevenlabs_transcription",
        access: expect.objectContaining({
          adminEnabled: true,
          publicEnabled: false,
        }),
      },
    );
    expect(query(queries, "insert into shorts_mvp.video_jobs")?.sql)
      .toContain("initial_editor_release_id");
  });

  it("reissues the identical token and URL for an idempotent request without reserving twice", async () => {
    const uploadSessionId = "5a46c5d2-1578-4238-b561-b09a11faacb1";
    const jobId = "db421da3-e87e-473a-b495-29309af5ae42";
    const token = fileUploadBearerToken(TOKEN_SECRET, {
      uploadSessionId,
      jobId,
      userId: USER_ID,
      requestId: REQUEST_ID,
    });
    const existing = {
      uploadSessionId,
      jobId,
      projectNumber: 44,
      requestId: REQUEST_ID,
      userId: USER_ID,
      tokenHash: fileUploadTokenHash(token),
      intentHash: intentHashFor(),
      uploadUrl: `https://receiver.example.com/base/v1/upload-sessions/${uploadSessionId}/source`,
      expiresAt: EXPIRES_AT,
      status: "awaiting_upload",
      isUnexpired: true,
    };
    const { db, queries } = transactionDb({ existing });
    mocks.getDb.mockReturnValue(db);

    const response = await POST(jsonRequest(validBody));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jobId,
      projectNumber: 44,
      uploadSessionId,
      uploadUrl: existing.uploadUrl,
      token,
    });
    expect(queries.some((entry) => entry.sql.includes("insert into"))).toBe(false);
    expect(queries.some((entry) => entry.sql.includes("reserve_usage_grants"))).toBe(false);
    expect(mocks.thankYouGrant).not.toHaveBeenCalled();
  });

  it("rejects a reused request id when any immutable upload intent field changes", async () => {
    const uploadSessionId = "5a46c5d2-1578-4238-b561-b09a11faacb1";
    const jobId = "db421da3-e87e-473a-b495-29309af5ae42";
    const token = fileUploadBearerToken(TOKEN_SECRET, {
      uploadSessionId,
      jobId,
      userId: USER_ID,
      requestId: REQUEST_ID,
    });
    const { db, queries } = transactionDb({
      existing: {
        uploadSessionId,
        jobId,
        projectNumber: 44,
        requestId: REQUEST_ID,
        userId: USER_ID,
        tokenHash: fileUploadTokenHash(token),
        intentHash: intentHashFor(),
        uploadUrl: `https://receiver.example.com/v1/upload-sessions/${uploadSessionId}/source`,
        expiresAt: EXPIRES_AT,
        status: "awaiting_upload",
        isUnexpired: true,
      },
    });
    mocks.getDb.mockReturnValue(db);

    const response = await POST(jsonRequest({
      ...validBody,
      file: { ...validBody.file, name: "different-name.mov" },
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "FILE_UPLOAD_INTENT_MISMATCH",
    });
    expect(queries.some((entry) => entry.sql.includes("insert into"))).toBe(false);
    expect(queries.some((entry) => entry.sql.includes("reserve_usage_grants"))).toBe(false);
    expect(mocks.thankYouGrant).not.toHaveBeenCalled();
  });

  it.each([
    ["claimed", true, 409, "FILE_UPLOAD_ALREADY_CLAIMED"],
    ["cancelled", true, 409, "FILE_UPLOAD_REQUEST_NOT_ACTIVE"],
    ["failed", true, 409, "FILE_UPLOAD_REQUEST_NOT_ACTIVE"],
    ["completed", true, 409, "FILE_UPLOAD_REQUEST_NOT_ACTIVE"],
    ["expired", true, 410, "FILE_UPLOAD_SESSION_EXPIRED"],
    ["awaiting_upload", false, 410, "FILE_UPLOAD_SESSION_EXPIRED"],
  ])("does not reissue a bearer for existing %s sessions", async (
    status,
    isUnexpired,
    expectedStatus,
    expectedCode,
  ) => {
    const uploadSessionId = "5a46c5d2-1578-4238-b561-b09a11faacb1";
    const jobId = "db421da3-e87e-473a-b495-29309af5ae42";
    const token = fileUploadBearerToken(TOKEN_SECRET, {
      uploadSessionId,
      jobId,
      userId: USER_ID,
      requestId: REQUEST_ID,
    });
    const { db, queries } = transactionDb({
      existing: {
        uploadSessionId,
        jobId,
        projectNumber: 44,
        requestId: REQUEST_ID,
        userId: USER_ID,
        tokenHash: fileUploadTokenHash(token),
        intentHash: intentHashFor(),
        uploadUrl: `https://receiver.example.com/v1/upload-sessions/${uploadSessionId}/source`,
        expiresAt: EXPIRES_AT,
        status,
        isUnexpired,
      },
    });
    mocks.getDb.mockReturnValue(db);

    const response = await POST(jsonRequest(validBody));

    expect(response.status).toBe(expectedStatus);
    const body = await response.json();
    expect(body).toMatchObject({ code: expectedCode });
    expect(body).not.toHaveProperty("token");
    expect(queries.some((entry) => entry.sql.includes("insert into"))).toBe(false);
  });

  it("rounds billable usage at the established 30-second boundary and plans the same output count", async () => {
    for (const [selectedSeconds, expectedUsage] of [[330, 300], [331, 360]]) {
      const { db, queries } = transactionDb();
      mocks.getDb.mockReturnValue(db);
      const response = await POST(jsonRequest({
        ...validBody,
        requestId: crypto.randomUUID(),
        rangeStartSeconds: 0,
        rangeEndSeconds: selectedSeconds,
      }));
      expect(response.status).toBe(201);
      expect(query(queries, "insert into shorts_mvp.usage_reservations")?.values)
        .toContain(expectedUsage);
      const jobValues = query(queries, "insert into shorts_mvp.video_jobs")?.values || [];
      expect(jobValues.filter((value) => value === 5).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("ceil-rounds fractional source metadata while preserving the exact selected range", async () => {
    const { db, queries } = transactionDb();
    mocks.getDb.mockReturnValue(db);

    const response = await POST(jsonRequest({
      ...validBody,
      file: { ...validBody.file, durationSeconds: 180.001 },
      rangeStartSeconds: 0,
      rangeEndSeconds: 180.001,
    }));

    expect(response.status).toBe(201);
    const job = query(queries, "insert into shorts_mvp.video_jobs");
    expect(job?.values).toContain(181);
    expect(job?.values).toContain(180.001);
    const upload = query(queries, "insert into shorts_mvp.file_upload_capacity_requests");
    expect(upload?.values).toContain(180.001);
  });

  it.each([
    ["minimum three-minute whole source", 180, 0, 180, 1, true],
    ["exact four-minute range", 240, 0, 240, 1, true],
    ["three-hour source and exact 60-minute range", 10_800, 0, 3_600, FILE_UPLOAD_MAX_BYTES, true],
    ["below source minimum", 179.999, 0, 179.999, 1, false],
    ["above source maximum", 10_800.001, 0, 3_600, 1, false],
    ["non-whole sub-four-minute selection", 180, 1, 180, 1, false],
    ["below range minimum", 600, 0, 239.999, 1, false],
    ["above range maximum", 7_200, 0, 3_600.001, 1, false],
    ["above five GiB", 600, 0, 300, FILE_UPLOAD_MAX_BYTES + 1, false],
  ])("validates %s", async (
    _label,
    durationSeconds,
    rangeStartSeconds,
    rangeEndSeconds,
    sizeBytes,
    accepted,
  ) => {
    const { db } = transactionDb();
    mocks.getDb.mockReturnValue(db);
    const response = await POST(jsonRequest({
      ...validBody,
      requestId: crypto.randomUUID(),
      file: { ...validBody.file, durationSeconds, sizeBytes },
      rangeStartSeconds,
      rangeEndSeconds,
    }));
    expect(response.status).toBe(accepted ? 201 : 400);
    expect(db.begin).toHaveBeenCalledTimes(accepted ? 1 : 0);
  });

  it("accepts blank untrusted MIME metadata but rejects missing audio and rights", async () => {
    const { db, queries } = transactionDb();
    mocks.getDb.mockReturnValue(db);
    const blankMime = await POST(jsonRequest({
      ...validBody,
      file: { ...validBody.file, contentType: "" },
    }));
    expect(blankMime.status).toBe(201);
    expect(query(queries, "insert into shorts_mvp.file_upload_capacity_requests")?.values)
      .toContain("application/octet-stream");

    for (const invalidBody of [
      { ...validBody, file: { ...validBody.file, hasAudio: false } },
      { ...validBody, rightsConfirmed: false },
    ]) {
      const response = await POST(jsonRequest(invalidBody));
      expect(response.status).toBe(400);
    }
  });

  it("uses the exact shared subtitle placement contract", async () => {
    const { db } = transactionDb();
    mocks.getDb.mockReturnValue(db);
    const accepted = await POST(jsonRequest({
      ...validBody,
      subtitleTemplateId: "pop",
      subtitleCaptionPlacement: "center",
      brandColor: "#35E6E3",
    }));
    expect(accepted.status).toBe(201);

    const rejected = await POST(jsonRequest({
      ...validBody,
      subtitleTemplateId: "pop",
      subtitleCaptionPlacement: "top",
    }));
    expect(rejected.status).toBe(400);
  });

  it("enforces billing, active-job, usage, custom-template, subtitle, and transcription gates", async () => {
    const paidDenied = transactionDb();
    mocks.getDb.mockReturnValue(paidDenied.db);
    mocks.billingSummary.mockResolvedValueOnce({ ...billing, canCreateJobs: false });
    expect((await POST(jsonRequest(validBody))).status).toBe(402);

    const activeDenied = transactionDb({ activeJobs: 1 });
    mocks.getDb.mockReturnValue(activeDenied.db);
    expect((await POST(jsonRequest(validBody))).status).toBe(409);

    const usageDenied = transactionDb();
    mocks.getDb.mockReturnValue(usageDenied.db);
    mocks.usageSnapshot.mockResolvedValueOnce({ ...usage, remainingSeconds: 299 });
    expect((await POST(jsonRequest(validBody))).status).toBe(402);

    const customDenied = transactionDb();
    mocks.getDb.mockReturnValue(customDenied.db);
    mocks.billingSummary.mockResolvedValueOnce({
      ...billing,
      activeProducts: [],
      hasManagedFeatureAccess: false,
    });
    expect((await POST(jsonRequest({
      ...validBody,
      customTemplateId: "fe5ef5b7-92b7-4743-9fab-8ee8b50da9fd",
    }))).status).toBe(402);

    const subtitleDenied = transactionDb();
    mocks.getDb.mockReturnValue(subtitleDenied.db);
    mocks.subtitleAccess.mockResolvedValueOnce({ enabled: false });
    expect((await POST(jsonRequest({
      ...validBody,
      subtitleTemplateId: "pop",
    }))).status).toBe(409);

    const transcriptionDenied = transactionDb();
    mocks.getDb.mockReturnValue(transcriptionDenied.db);
    mocks.transcriptionAccess.mockResolvedValueOnce({
      enabled: false,
      policy: "openai_stable",
    });
    expect((await POST(jsonRequest({
      ...validBody,
      subtitleTemplateId: "highlight",
    }))).status).toBe(409);
  });

  it("rejects raw file bodies and oversized streamed JSON before opening a transaction", async () => {
    const { db } = transactionDb();
    mocks.getDb.mockReturnValue(db);
    const multipart = new Request("http://localhost/api/file-upload/sessions", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=test" },
      body: "--test--",
    });
    expect((await POST(multipart)).status).toBe(415);

    const oversized = new Request("http://localhost/api/file-upload/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(FILE_UPLOAD_CONTROL_BODY_MAX_BYTES + 1));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect((await POST(oversized)).status).toBe(413);
    expect(db.begin).not.toHaveBeenCalled();
  });

  it("rolls back the job and reservation when session creation fails", async () => {
    const { db, queries } = transactionDb({ failUploadSessionInsert: true });
    mocks.getDb.mockReturnValue(db);

    const response = await POST(jsonRequest(validBody));

    expect(response.status).toBe(400);
    expect(query(queries, "insert into shorts_mvp.video_jobs")).toBeTruthy();
    expect(query(queries, "insert into shorts_mvp.usage_reservations")).toBeTruthy();
    expect(mocks.usageSnapshot).toHaveBeenCalledTimes(1);
  });

  it("finalizes and releases an unclaimed reservation when capacity cannot start", async () => {
    const { db, queries } = transactionDb();
    mocks.getDb.mockReturnValue(db);
    mocks.ensureUploadCapacity.mockRejectedValueOnce(new Error("lambda unavailable"));

    const response = await POST(jsonRequest(validBody));
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(503);
    expect(body).toMatchObject({
      code: "FILE_UPLOAD_CAPACITY_UNAVAILABLE",
    });
    expect(query(queries, "update shorts_mvp.file_upload_capacity_requests"))
      .toBeTruthy();
    expect(query(queries, "finalize_project_job")?.sql)
      .toContain("'upload_capacity_unavailable'");
    expect(mocks.releaseUploadCapacity).toHaveBeenCalledTimes(1);
  });

  it("keeps a transiently throttled capacity request preparing without refunding it", async () => {
    const { db, queries } = transactionDb();
    mocks.getDb.mockReturnValue(db);
    mocks.ensureUploadCapacity.mockRejectedValueOnce(
      new FileUploadCapacityTransientError({ name: "TooManyRequestsException" }),
    );

    const response = await POST(jsonRequest(validBody));
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(body).toMatchObject({
      status: "preparing",
      expiresAt: null,
    });
    expect(query(queries, "update shorts_mvp.file_upload_capacity_requests"))
      .toBeUndefined();
    expect(query(queries, "finalize_project_job")).toBeUndefined();
    expect(mocks.releaseUploadCapacity).not.toHaveBeenCalled();
  });

  it("has no stable-path dispatch, AWS wake, or outbox dependency", () => {
    const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    expect(source).not.toContain("project_job_outbox");
    expect(source).not.toContain("wakeOutboxDispatcher");
    expect(source).toContain("ensureFileUploadCapacity");
    expect(source).not.toContain("submitProjectJob");
  });
});
