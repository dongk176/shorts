import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  authenticatedSession: vi.fn(),
  getDb: vi.fn(),
  usage: vi.fn(),
  recentJobs: vi.fn(),
  projectByNumber: vi.fn(),
  publicExampleByNumber: vi.fn(),
  publicState: vi.fn(),
  publicExamples: vi.fn(),
  authenticatedUser: vi.fn(),
  analyze: vi.fn(),
  submitInitial: vi.fn(),
  submitRerender: vi.fn(),
  wakeDispatcher: vi.fn(),
  deleteObjects: vi.fn(),
  billing: vi.fn(),
  signedUrl: vi.fn(),
  shortDownloadUrl: vi.fn(),
  generateComments: vi.fn(),
  paidCommentGenerationEnabled: vi.fn(),
}));

vi.mock("@aws-sdk/cloudfront-signer", () => ({
  getSignedUrl: mocks.signedUrl,
}));
vi.mock("@/lib/session", () => ({
  requireMvpSession: mocks.session,
  requireAuthenticatedMvpSession: mocks.authenticatedSession,
}));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/billing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing")>()),
  getBillingSummary: mocks.billing,
}));
vi.mock("@/lib/supabase/server", () => ({ getAuthenticatedUser: mocks.authenticatedUser }));
vi.mock("@/lib/usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/usage")>()),
  getUsageSnapshot: mocks.usage,
}));
vi.mock("@/lib/data", () => ({
  getRecentJobs: mocks.recentJobs,
  getProjectByNumber: mocks.projectByNumber,
  getPublicExampleProjectByNumber: mocks.publicExampleByNumber,
  getPublicExampleJobs: mocks.publicExamples,
  getPublicMvpState: mocks.publicState,
  getPlans: vi.fn(),
}));
vi.mock("@/lib/youtube", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/youtube")>()),
  analyzeYoutubeUrl: mocks.analyze,
}));
vi.mock("@/lib/aws", () => ({
  submitInitialJob: mocks.submitInitial,
  submitRerender: mocks.submitRerender,
  wakeOutboxDispatcher: mocks.wakeDispatcher,
  deleteShortObjects: mocks.deleteObjects,
  getShortDownloadUrl: mocks.shortDownloadUrl,
}));
vi.mock("@/lib/comment-regeneration-server", () => ({
  generateCommentsWithGemini: mocks.generateComments,
  paidGeminiCommentGenerationEnabled: mocks.paidCommentGenerationEnabled,
}));

import { GET as getJob } from "./jobs/[jobId]/route";
import { GET as getProject } from "./projects/[projectNumber]/route";
import { HttpError } from "@/lib/http";
import { POST as createJob } from "./jobs/route";
import { POST as selectPlan } from "./mvp/plan/route";
import { GET as getMvpState } from "./mvp/state/route";
import { GET as accessShort } from "./shorts/[shortId]/access/route";
import { GET as accessEditSource } from "./shorts/[shortId]/edit-source/route";
import { POST as applyRangeEdit } from "./shorts/[shortId]/apply-edit/route";
import { GET as accessEditTimeline } from "./shorts/[shortId]/edit-timeline/route";
import { GET as accessEditorChannelAsset } from "./shorts/[shortId]/editor-channel-asset/route";
import { POST as regenerateComments } from "./shorts/[shortId]/regenerate-comments/route";
import { GET as downloadShort } from "./shorts/[shortId]/download/route";
import { POST as rerenderShort } from "./shorts/[shortId]/rerender/route";
import { PATCH as patchShort } from "./shorts/[shortId]/route";
import { POST as createPersonalTemplate } from "./templates/route";
import { createDefaultTemplateConfig, videoFrameForAspect } from "@/lib/template-config";

const usage = {
  usedSeconds: 60,
  reservedSeconds: 0,
  limitSeconds: 6000,
  remainingSeconds: 5940,
  baseUsedSeconds: 60,
  baseReservedSeconds: 0,
  baseLimitSeconds: 6000,
  baseRemainingSeconds: 5940,
  addonRemainingSeconds: 0,
  periodStart: "2026-06-30T15:00:00.000Z",
  nextResetAt: "2026-07-31T15:00:00.000Z",
  enforcementEnabled: true as const,
};

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function dbWithRows(...responses: unknown[][]) {
  const tag = vi.fn();
  for (const response of responses) tag.mockResolvedValueOnce(response);
  Object.assign(tag, { json: (value: unknown) => value });
  return tag;
}

function dbForSuccessfulJobCreation() {
  const db = dbWithRows([], [analysisRow]);
  const tx = dbWithRows([], [], [{ active: 0 }], [{ projectNumber: 1 }], [{ id: "reservation-a" }], [], []);
  Object.assign(db, { begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)) });
  return db;
}

function dbForSuccessfulRangeJobCreation() {
  const db = dbWithRows(
    [],
    [{ ...analysisRow, durationSeconds: 7200, sourceRangeSelectionEnabled: true }],
    [
      { flagKey: "source_range_selection", enabled: true },
      { flagKey: "source_range_selection_public", enabled: true },
    ],
    [{ isAdmin: false }],
  );
  const tx = dbWithRows(
    [],
    [
      { flagKey: "source_range_selection", enabled: true },
      { flagKey: "source_range_selection_public", enabled: true },
    ],
    [{ isAdmin: false }],
    [],
    [{ active: 0 }],
    [{ projectNumber: 1 }],
    [{ id: "reservation-range" }],
    [],
    [],
  );
  Object.assign(db, {
    begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
  });
  return { db, tx };
}

const analysisId = "6bce83c4-b12e-4d11-8f16-2fef8a96c541";
const analysisRow = {
  youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  youtubeVideoId: "dQw4w9WgXcQ",
  videoTitle: "테스트 영상",
  channelName: "채널",
  channelThumbnailUrl: "https://yt3.ggpht.com/channel-avatar",
  thumbnailUrl: "https://example.com/thumb.jpg",
  durationSeconds: 600,
  creationAllowed: true,
  creationBlockCode: null,
  creationBlockReason: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LEGACY_PROJECT_JOB_DEFINITION_ARN = (
    "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
    + "shorts-mvp-project-heavy-fargate-production:27"
  );
  process.env.LEGACY_PROJECT_BATCH_QUEUE_ARN = (
    "arn:aws:batch:ap-northeast-2:123456789012:job-queue/"
    + "shorts-mvp-project-fargate-production"
  );
  process.env.SOURCE_RANGE_JOB_DEFINITION_ARN = (
    "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
    + "shorts-mvp-source-range-v1-production:1"
  );
  process.env.SOURCE_RANGE_BATCH_QUEUE_ARN = (
    "arn:aws:batch:ap-northeast-2:123456789012:job-queue/"
    + "shorts-mvp-source-range-production"
  );
  process.env.ELEVENLABS_TRANSCRIPTION_JOB_DEFINITION_ARN = (
    "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
    + "shorts-mvp-elevenlabs-transcription-canary-production:1"
  );
  process.env.ELEVENLABS_TRANSCRIPTION_BATCH_QUEUE_ARN = (
    "arn:aws:batch:ap-northeast-2:123456789012:job-queue/"
    + "shorts-mvp-elevenlabs-transcription-canary-production"
  );
  process.env.SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN = (
    "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
    + "shorts-mvp-subtitle-templates-canary-production:1"
  );
  process.env.SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN = (
    "arn:aws:batch:ap-northeast-2:123456789012:job-queue/"
    + "shorts-mvp-subtitle-templates-canary-production"
  );
  delete process.env.ELEVENLABS_TRANSCRIPTION_ENABLED;
  delete process.env.SUBTITLE_TEMPLATES_ENABLED;
  delete process.env.EDITOR_RENDERING_V2_ENABLED;
  delete process.env.EDITOR_RENDERING_V2_GLOBAL_ENABLED;
  delete process.env.EDITOR_RENDERING_V2_TEST_USER_IDS;
  delete process.env.EDITOR_OVERLAY_PREVIEW_ENABLED;
  delete process.env.VIDEO_JOB_BACKEND;
  process.env.SOURCE_RANGE_SELECTION_ENABLED = "true";
  delete process.env.RANGE_EDITING_ENABLED;
  delete process.env.CLOUDFRONT_DOMAIN;
  delete process.env.CLOUDFRONT_KEY_PAIR_ID;
  delete process.env.CLOUDFRONT_PRIVATE_KEY_B64;
  mocks.session.mockResolvedValue({
    id: "session-a",
    selectedPlanCode: "plus",
    userId: "user-a",
    user: { id: "auth-a", email: "owner@example.com", displayName: null, avatarUrl: null },
  });
  mocks.usage.mockResolvedValue(usage);
  mocks.publicState.mockResolvedValue({ plans: [], generatedShortCount: 4321 });
  mocks.publicExamples.mockResolvedValue([{ id: "example-job", isExample: true }]);
  mocks.publicExampleByNumber.mockResolvedValue(null);
  mocks.authenticatedSession.mockImplementation(() => mocks.session());
  mocks.authenticatedUser.mockResolvedValue({ id: "auth-a" });
  mocks.wakeDispatcher.mockResolvedValue(undefined);
  mocks.signedUrl.mockReturnValue("https://cdn.example.com/signed-edit-source.mp4");
  mocks.shortDownloadUrl.mockResolvedValue("https://cdn.example.com/signed-download.mp4");
  mocks.paidCommentGenerationEnabled.mockReturnValue(true);
  mocks.generateComments.mockResolvedValue(["생성된 댓글"]);
  mocks.billing.mockResolvedValue({
    activeProducts: [{
      planCode: "plus",
      displayName: "Plus",
      billingCycle: "monthly",
      currentPeriodStart: "2026-07-01T00:00:00.000Z",
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
      nextChargeAt: "2026-08-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      monthlySourceSeconds: 6000,
    }],
    status: "active", planCode: "plus", billingCycle: "monthly",
    currentPeriodStart: "2026-07-01T00:00:00.000Z", currentPeriodEnd: "2026-08-01T00:00:00.000Z",
    nextChargeAt: "2026-08-01T00:00:00.000Z", cancelAtPeriodEnd: false,
    scheduledPlanCode: null, scheduledBillingCycle: null, cardIssuer: "11",
    cardNumberMasked: "12345678****1234", cardLast4: "1234",
    canCreateJobs: true, maxActiveJobs: 1, retentionDays: 7,
  });
});

describe("range editing feature gate and snapshot", () => {
  const shortId = "d3515e25-d12c-4c6a-95e3-2c3aafe813b4";
  const input = {
    startSeconds: 105,
    endSeconds: 165,
    hookTitle: "새 제목",
    channelDisplayName: "채널",
    subtitlesEnabled: true,
    commentOverlays: [{
      id: "c2b3653e-9692-4bf7-916a-f17bb8809fe5",
      startSeconds: 0,
      endSeconds: 40,
      text: "댓글",
      initial: "댓",
      avatarColor: "#112233",
      nickname: "닉네임",
      likeCount: 100,
      ageLabel: "1개월 전",
    }],
    templateId: "comment-capture",
    titleFontScale: 1,
    titleTextStyles: [],
  };

  it("hides both new APIs when the environment flag is disabled", async () => {
    const timelineResponse = await accessEditTimeline(
      new Request(`http://localhost/api/shorts/${shortId}/edit-timeline`),
      { params: Promise.resolve({ shortId }) },
    );
    const applyResponse = await applyRangeEdit(
      jsonRequest(`http://localhost/api/shorts/${shortId}/apply-edit`, input),
      { params: Promise.resolve({ shortId }) },
    );

    expect(timelineResponse.status).toBe(404);
    expect(applyResponse.status).toBe(404);
    expect(mocks.authenticatedSession).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("returns the current clean clip as a fallback timeline for older shorts", async () => {
    process.env.RANGE_EDITING_ENABLED = "true";
    process.env.CLOUDFRONT_DOMAIN = "cdn.example.com";
    process.env.CLOUDFRONT_KEY_PAIR_ID = "key-pair";
    process.env.CLOUDFRONT_PRIVATE_KEY_B64 = Buffer.from("private-key").toString("base64");
    mocks.getDb.mockReturnValue(dbWithRows([{
      editTimelineS3Key: null,
      cleanClipS3Key: "edit-sources/clean.mp4",
      startSeconds: 100,
      endSeconds: 140,
      initialStartSeconds: 90,
      initialEndSeconds: 150,
      subtitleSegments: [{ start: 5, end: 10, text: "현재 자막" }],
      expiresAt: new Date(Date.now() + 60_000),
    }]));

    const response = await accessEditTimeline(
      new Request(`http://localhost/api/shorts/${shortId}/edit-timeline`),
      { params: Promise.resolve({ shortId }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      url: "https://cdn.example.com/signed-edit-source.mp4",
      timelineStartSeconds: 100,
      timelineEndSeconds: 140,
      currentStartSeconds: 100,
      currentEndSeconds: 140,
      initialStartSeconds: 100,
      initialEndSeconds: 140,
      subtitleSegments: [{ start: 5, end: 10, text: "현재 자막" }],
      version: 0,
      canExtendSelection: false,
    });
    expect(mocks.signedUrl).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://cdn.example.com/edit-sources/clean.mp4",
    }));
  });

  it("does not queue a comment template without at least one editable comment", async () => {
    process.env.RANGE_EDITING_ENABLED = "true";

    const response = await applyRangeEdit(
      jsonRequest(`http://localhost/api/shorts/${shortId}/apply-edit`, {
        ...input,
        commentOverlays: [],
      }),
      { params: Promise.resolve({ shortId }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("stores a full pending snapshot and proportionally retimes comments", async () => {
    process.env.RANGE_EDITING_ENABLED = "true";
    const db = dbWithRows([{
      id: shortId,
      status: "ready",
      durationSeconds: 40,
      templateId: "comment-capture",
      customTemplateId: null,
      templateSnapshot: { presetVersion: 3 },
      videoAspectRatio: "1:1",
      editTimelineS3Key: "edit-sources/timeline.mp4",
      editTimelineStartSeconds: 90,
      editTimelineEndSeconds: 170,
      editTimelineSubtitleSegments: [
        { start: 15, end: 25, text: "선택 자막" },
      ],
    }]);
    const tx = dbWithRows([{ id: shortId }], []);
    Object.assign(db, { begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)) });
    mocks.getDb.mockReturnValue(db);

    const response = await applyRangeEdit(
      jsonRequest(`http://localhost/api/shorts/${shortId}/apply-edit`, input),
      { params: Promise.resolve({ shortId }) },
    );

    expect(response.status).toBe(202);
    const pendingSnapshot = tx.mock.calls[0].slice(1).find((value) => (
      typeof value === "object" && value !== null && "durationSeconds" in value
    ));
    expect(pendingSnapshot).toMatchObject({
      startSeconds: 105,
      endSeconds: 165,
      durationSeconds: 60,
      subtitleSegments: [{ start: 0, end: 10, text: "선택 자막" }],
      commentOverlays: [{ startSeconds: 0, endSeconds: 60, text: "댓글" }],
    });
    expect(tx).toHaveBeenCalledTimes(2);
  });

  it("stores edited subtitle text while preserving captured timeline timestamps", async () => {
    process.env.RANGE_EDITING_ENABLED = "true";
    const db = dbWithRows([{
      id: shortId,
      status: "ready",
      durationSeconds: 40,
      templateId: "comment-capture",
      customTemplateId: null,
      templateSnapshot: { presetVersion: 3 },
      videoAspectRatio: "1:1",
      editTimelineS3Key: "edit-sources/timeline.mp4",
      editTimelineStartSeconds: 90,
      editTimelineEndSeconds: 170,
      editTimelineSubtitleSegments: [
        { start: 15, end: 25, text: "선택 자막" },
      ],
    }]);
    const tx = dbWithRows([{ id: shortId }], []);
    const begin = vi.fn(
      (callback: (transaction: typeof tx) => unknown) => callback(tx),
    );
    Object.assign(db, { begin });
    mocks.getDb.mockReturnValue(db);

    const response = await applyRangeEdit(
      jsonRequest(`http://localhost/api/shorts/${shortId}/apply-edit`, {
        ...input,
        subtitleSegments: [
          { start: 15, end: 25, text: "사용자가 수정한 자막" },
        ],
      }),
      { params: Promise.resolve({ shortId }) },
    );

    expect(response.status).toBe(202);
    const pendingSnapshot = tx.mock.calls[0].slice(1).find((value) => (
      typeof value === "object" && value !== null && "durationSeconds" in value
    ));
    expect(pendingSnapshot).toMatchObject({
      subtitleSegments: [{
        start: 0,
        end: 10,
        text: "사용자가 수정한 자막",
      }],
      timelineSubtitleSegments: [{
        start: 15,
        end: 25,
        text: "사용자가 수정한 자막",
      }],
    });
  });

  it("rejects edited subtitle timestamps in the range editor", async () => {
    process.env.RANGE_EDITING_ENABLED = "true";
    mocks.getDb.mockReturnValue(dbWithRows([{
      id: shortId,
      status: "ready",
      durationSeconds: 40,
      templateId: "comment-capture",
      customTemplateId: null,
      templateSnapshot: { presetVersion: 3 },
      videoAspectRatio: "1:1",
      editTimelineS3Key: "edit-sources/timeline.mp4",
      editTimelineStartSeconds: 90,
      editTimelineEndSeconds: 170,
      editTimelineSubtitleSegments: [
        { start: 15, end: 25, text: "선택 자막" },
      ],
    }]));

    const response = await applyRangeEdit(
      jsonRequest(`http://localhost/api/shorts/${shortId}/apply-edit`, {
        ...input,
        subtitleSegments: [
          { start: 15.1, end: 25, text: "시간까지 바꾼 자막" },
        ],
      }),
      { params: Promise.resolve({ shortId }) },
    );

    expect(response.status).toBe(400);
  });

  it("drops hidden malformed comments when applying a non-comment template", async () => {
    process.env.RANGE_EDITING_ENABLED = "true";
    const db = dbWithRows([{
      id: shortId,
      status: "ready",
      renderVersion: 1,
      durationSeconds: 40,
      templateId: "comment-capture",
      customTemplateId: null,
      templateSnapshot: { presetVersion: 3 },
      videoAspectRatio: "1:1",
      editTimelineS3Key: "edit-sources/timeline.mp4",
      editTimelineStartSeconds: 90,
      editTimelineEndSeconds: 170,
      editTimelineSubtitleSegments: [],
      onboardingWelcomeFunded: false,
    }]);
    const tx = dbWithRows([{ id: shortId }], []);
    Object.assign(db, { begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)) });
    mocks.getDb.mockReturnValue(db);

    const response = await applyRangeEdit(
      jsonRequest(`http://localhost/api/shorts/${shortId}/apply-edit`, {
        ...input,
        templateId: "dark-red",
        commentOverlays: [{ id: "legacy-comment", text: "" }],
      }),
      { params: Promise.resolve({ shortId }) },
    );

    expect(response.status).toBe(202);
    const pendingSnapshot = tx.mock.calls[0].slice(1).find((value) => (
      typeof value === "object" && value !== null && "durationSeconds" in value
    ));
    expect(pendingSnapshot).toMatchObject({
      templateId: "dark-red",
      commentOverlays: [],
    });
  });

  it("switches an older non-comment short to the comment template and queues its comments", async () => {
    process.env.RANGE_EDITING_ENABLED = "true";
    const db = dbWithRows([{
      id: shortId,
      status: "ready",
      startSeconds: 100,
      endSeconds: 140,
      durationSeconds: 40,
      templateId: "dark-red",
      customTemplateId: null,
      templateSnapshot: { presetVersion: 3 },
      videoAspectRatio: "1:1",
      editTimelineS3Key: null,
      cleanClipS3Key: "edit-sources/clean.mp4",
      subtitleSegments: [{ start: 5, end: 10, text: "현재 자막" }],
    }]);
    const tx = dbWithRows([{ id: shortId }], []);
    Object.assign(db, { begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)) });
    mocks.getDb.mockReturnValue(db);

    const response = await applyRangeEdit(
      jsonRequest(`http://localhost/api/shorts/${shortId}/apply-edit`, {
        ...input,
        startSeconds: 105,
        endSeconds: 135,
      }),
      { params: Promise.resolve({ shortId }) },
    );

    expect(response.status).toBe(202);
    const pendingSnapshot = tx.mock.calls[0].slice(1).find((value) => (
      typeof value === "object" && value !== null && "durationSeconds" in value
    ));
    expect(pendingSnapshot).toMatchObject({
      startSeconds: 105,
      endSeconds: 135,
      durationSeconds: 30,
      templateId: "comment-capture",
      customTemplateId: null,
      templateSnapshot: { presetVersion: 3 },
      subtitleSegments: [{ start: 0, end: 5, text: "현재 자막" }],
      commentOverlays: [{ startSeconds: 0, endSeconds: 30, text: "댓글" }],
    });
  });

  it("replaces a custom snapshot when its base preset is explicitly selected", async () => {
    process.env.RANGE_EDITING_ENABLED = "true";
    const customTemplateId = "8d5373bd-63c0-4697-94eb-44c8f5046bdc";
    const db = dbWithRows([{
      id: shortId,
      status: "ready",
      durationSeconds: 40,
      templateId: "comment-capture",
      customTemplateId,
      templateSnapshot: {
        id: customTemplateId,
        name: "내 댓글 템플릿",
        baseTemplateId: "comment-capture",
        config: { schemaVersion: 4 },
        version: 1,
      },
      videoAspectRatio: "1:1",
      editTimelineS3Key: "edit-sources/timeline.mp4",
      editTimelineStartSeconds: 90,
      editTimelineEndSeconds: 170,
      editTimelineSubtitleSegments: [],
    }]);
    const tx = dbWithRows([{ id: shortId }], []);
    Object.assign(db, { begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)) });
    mocks.getDb.mockReturnValue(db);

    const response = await applyRangeEdit(
      jsonRequest(`http://localhost/api/shorts/${shortId}/apply-edit`, {
        ...input,
        customTemplateId: null,
      }),
      { params: Promise.resolve({ shortId }) },
    );

    expect(response.status).toBe(202);
    const pendingSnapshot = tx.mock.calls[0].slice(1).find((value) => (
      typeof value === "object" && value !== null && "durationSeconds" in value
    ));
    expect(pendingSnapshot).toMatchObject({
      templateId: "comment-capture",
      customTemplateId: null,
      templateSnapshot: { presetVersion: 3 },
    });
  });

  it("rejects an edit outside the captured timeline", async () => {
    process.env.RANGE_EDITING_ENABLED = "true";
    const db = dbWithRows([{
      id: shortId,
      status: "ready",
      durationSeconds: 40,
      templateId: "dark-red",
      videoAspectRatio: "1:1",
      editTimelineS3Key: "edit-sources/timeline.mp4",
      editTimelineStartSeconds: 100,
      editTimelineEndSeconds: 160,
      editTimelineSubtitleSegments: [],
    }]);
    mocks.getDb.mockReturnValue(db);

    const response = await applyRangeEdit(
      jsonRequest(`http://localhost/api/shorts/${shortId}/apply-edit`, input),
      { params: Promise.resolve({ shortId }) },
    );

    expect(response.status).toBe(400);
  });

  it("snaps sub-step browser drift back to fractional timeline boundaries", async () => {
    process.env.RANGE_EDITING_ENABLED = "true";
    const db = dbWithRows([{
      id: shortId,
      status: "ready",
      durationSeconds: 40,
      templateId: "dark-red",
      customTemplateId: null,
      templateSnapshot: { presetVersion: 3 },
      videoAspectRatio: "1:1",
      editTimelineS3Key: "edit-sources/timeline.mp4",
      editTimelineStartSeconds: 870.03,
      editTimelineEndSeconds: 990,
      editTimelineSubtitleSegments: [],
    }]);
    const tx = dbWithRows([{ id: shortId }], []);
    Object.assign(db, { begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)) });
    mocks.getDb.mockReturnValue(db);

    const response = await applyRangeEdit(
      jsonRequest(`http://localhost/api/shorts/${shortId}/apply-edit`, {
        ...input,
        startSeconds: 870,
        endSeconds: 990.03,
        templateId: "dark-red",
        commentOverlays: [],
      }),
      { params: Promise.resolve({ shortId }) },
    );

    expect(response.status).toBe(202);
    const pendingSnapshot = tx.mock.calls[0].slice(1).find((value) => (
      typeof value === "object" && value !== null && "durationSeconds" in value
    ));
    expect(pendingSnapshot).toMatchObject({
      startSeconds: 870.03,
      endSeconds: 990,
      durationSeconds: 119.97,
    });
  });

  it("requires an owned, non-example, unexpired project with an editable source", async () => {
    process.env.RANGE_EDITING_ENABLED = "true";
    const db = dbWithRows([]);
    mocks.getDb.mockReturnValue(db);

    const response = await applyRangeEdit(
      jsonRequest(`http://localhost/api/shorts/${shortId}/apply-edit`, input),
      { params: Promise.resolve({ shortId }) },
    );

    expect(response.status).toBe(404);
    const query = Array.from(db.mock.calls[0][0] as TemplateStringsArray).join("");
    expect(query).toContain("not j.is_example");
    expect(query).toContain("s.user_id=");
    expect(query).toContain("s.expires_at > now()");
    expect(query).toContain("coalesce(s.edit_timeline_s3_key,s.clean_clip_s3_key) is not null");
  });

  it("rejects a final selection shorter than one second", async () => {
    process.env.RANGE_EDITING_ENABLED = "true";
    mocks.getDb.mockReturnValue(dbWithRows([{
      id: shortId,
      status: "ready",
      durationSeconds: 40,
      templateId: "dark-red",
      videoAspectRatio: "1:1",
      editTimelineS3Key: "edit-sources/timeline.mp4",
      editTimelineStartSeconds: 90,
      editTimelineEndSeconds: 170,
      editTimelineSubtitleSegments: [],
    }]));

    const response = await applyRangeEdit(
      jsonRequest(`http://localhost/api/shorts/${shortId}/apply-edit`, {
        ...input,
        startSeconds: 100,
        endSeconds: 100.5,
      }),
      { params: Promise.resolve({ shortId }) },
    );

    expect(response.status).toBe(400);
  });

  it("rejects a duplicate request while the previous snapshot is rendering", async () => {
    process.env.RANGE_EDITING_ENABLED = "true";
    mocks.getDb.mockReturnValue(dbWithRows([{
      id: shortId,
      status: "rerendering",
      durationSeconds: 40,
      editTimelineS3Key: "edit-sources/timeline.mp4",
    }]));

    const response = await applyRangeEdit(
      jsonRequest(`http://localhost/api/shorts/${shortId}/apply-edit`, input),
      { params: Promise.resolve({ shortId }) },
    );

    expect(response.status).toBe(409);
  });
});

describe("subtitle template edit isolation", () => {
  const shortId = "d164fb8d-d6e1-4232-8463-9115cdf7e561";

  it("rejects admin subtitle controls for an old project without word timing", async () => {
    process.env.EDITOR_RENDERING_V2_ENABLED = "true";
    const candidateReleaseId = "5a5f9f4d-f59d-4ba3-a28a-9396ac8284a7";
    const document = JSON.parse(readFileSync(
      new URL("../../../test-fixtures/editor-document-v3.json", import.meta.url),
      "utf8",
    ));
    document.renderSpec.version = 2;
    document.renderSpec.subtitles = {
      centerX: 540,
      offsetY: 0,
      scale: 1,
    };
    const db = dbWithRows(
      [{
        publicEnabled: false,
        canaryEnabled: true,
        runtimeEnabled: false,
        testerEnabled: true,
        userIsAdmin: true,
        stableReleaseId: null,
        stableUiVersion: null,
        stableDocumentVersion: null,
        stableStatus: null,
        candidateReleaseId,
        candidateUiVersion: 3,
        candidateDocumentVersion: 3,
        candidateStatus: "canary_active",
        candidateSubtitleEditingCapable: true,
        subtitleEditingPublicEnabled: false,
      }],
      [{
        id: shortId,
        subtitleTemplateId: null,
        wordTimedSubtitlesAvailable: false,
      }],
    );
    const begin = vi.fn();
    Object.assign(db, { begin });
    mocks.getDb.mockReturnValue(db);

    const response = await applyRangeEdit(
      jsonRequest(`http://localhost/api/shorts/${shortId}/apply-edit`, {
        requestId: "5253b207-cd49-45bc-8d83-69c2b781e21f",
        release: {
          releaseId: candidateReleaseId,
          channel: "canary",
          uiVersion: 3,
          documentVersion: 3,
        },
        document,
      }),
      { params: Promise.resolve({ shortId }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "EDITOR_WORD_TIMED_SUBTITLES_REQUIRED",
    });
    expect(begin).not.toHaveBeenCalled();
  });

  it("rejects a legacy apply-edit before queuing a subtitle-template output", async () => {
    process.env.RANGE_EDITING_ENABLED = "true";
    const db = dbWithRows([{
      id: shortId,
      status: "ready",
      subtitleTemplateId: "highlight",
    }]);
    const begin = vi.fn();
    Object.assign(db, { begin });
    mocks.getDb.mockReturnValue(db);

    const response = await applyRangeEdit(
      jsonRequest(`http://localhost/api/shorts/${shortId}/apply-edit`, {
        startSeconds: 0,
        endSeconds: 10,
        hookTitle: "기존 편집 요청",
        channelDisplayName: "채널",
        subtitlesEnabled: true,
        subtitleSegments: [],
        commentOverlays: [],
        templateId: "dark-minimal",
        titleFontScale: 1,
        titleTextStyles: [],
      }),
      { params: Promise.resolve({ shortId }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      detail: "자막 템플릿으로 만든 영상은 아직 편집할 수 없습니다.",
      code: "SUBTITLE_TEMPLATE_EDIT_UNSUPPORTED",
    });
    expect(begin).not.toHaveBeenCalled();
  });

  it("rejects a document apply-edit before recording a subtitle-template render request", async () => {
    process.env.EDITOR_RENDERING_V2_ENABLED = "true";
    const releaseId = "5a5f9f4d-f59d-4ba3-a28a-9396ac8284a7";
    const document = JSON.parse(readFileSync(
      new URL("../../../test-fixtures/editor-document-v2.json", import.meta.url),
      "utf8",
    ));
    const db = dbWithRows(
      [{
        publicEnabled: false,
        canaryEnabled: true,
        runtimeEnabled: false,
        testerEnabled: true,
        userIsAdmin: true,
        stableReleaseId: null,
        stableUiVersion: null,
        stableDocumentVersion: null,
        stableStatus: null,
        candidateReleaseId: releaseId,
        candidateUiVersion: 2,
        candidateDocumentVersion: 2,
        candidateStatus: "canary_active",
      }],
      [{
        id: shortId,
        subtitleTemplateId: "pop",
      }],
    );
    const begin = vi.fn();
    Object.assign(db, { begin });
    mocks.getDb.mockReturnValue(db);

    const response = await applyRangeEdit(
      jsonRequest(`http://localhost/api/shorts/${shortId}/apply-edit`, {
        requestId: "5253b207-cd49-45bc-8d83-69c2b781e21f",
        release: {
          releaseId,
          channel: "canary",
          uiVersion: 2,
          documentVersion: 2,
        },
        document,
      }),
      { params: Promise.resolve({ shortId }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      detail: "자막 템플릿으로 만든 영상은 아직 편집할 수 없습니다.",
      code: "SUBTITLE_TEMPLATE_EDIT_UNSUPPORTED",
    });
    expect(db).toHaveBeenCalledTimes(2);
    expect(begin).not.toHaveBeenCalled();
  });

  it("rejects edit-source and edit-timeline access for subtitle-template outputs", async () => {
    process.env.RANGE_EDITING_ENABLED = "true";
    const sourceDb = dbWithRows([{
      cleanClipS3Key: "clean/source.mp4",
      expiresAt: new Date(Date.now() + 60_000),
      subtitleTemplateId: "basic",
    }], []);
    mocks.getDb.mockReturnValue(sourceDb);

    const sourceResponse = await accessEditSource(
      new Request(`http://localhost/api/shorts/${shortId}/edit-source`),
      { params: Promise.resolve({ shortId }) },
    );
    expect(sourceResponse.status).toBe(409);
    await expect(sourceResponse.json()).resolves.toMatchObject({
      code: "SUBTITLE_TEMPLATE_EDIT_UNSUPPORTED",
    });
    expect(Array.from(
      sourceDb.mock.calls[0][0] as TemplateStringsArray,
    ).join("")).not.toContain("s.subtitle_template_id is null");
    expect(mocks.signedUrl).not.toHaveBeenCalled();

    const timelineDb = dbWithRows([{
      editTimelineS3Key: "edit-sources/timeline.mp4",
      cleanClipS3Key: "clean/source.mp4",
      expiresAt: new Date(Date.now() + 60_000),
      subtitleTemplateId: "highlight",
    }], []);
    mocks.getDb.mockReturnValue(timelineDb);
    const timelineResponse = await accessEditTimeline(
      new Request(`http://localhost/api/shorts/${shortId}/edit-timeline`),
      { params: Promise.resolve({ shortId }) },
    );
    expect(timelineResponse.status).toBe(409);
    await expect(timelineResponse.json()).resolves.toMatchObject({
      code: "SUBTITLE_TEMPLATE_EDIT_UNSUPPORTED",
    });
    expect(Array.from(
      timelineDb.mock.calls[0][0] as TemplateStringsArray,
    ).join("")).not.toContain("s.subtitle_template_id is null");
    expect(mocks.signedUrl).not.toHaveBeenCalled();

    const channelAssetDb = dbWithRows([{
      assetKey: "edit-sources/a/editor-assets/channel.png",
      expiresAt: new Date(Date.now() + 60_000),
      subtitleTemplateId: "pop",
    }], []);
    mocks.getDb.mockReturnValue(channelAssetDb);
    const channelAssetResponse = await accessEditorChannelAsset(
      new Request(`http://localhost/api/shorts/${shortId}/editor-channel-asset`),
      { params: Promise.resolve({ shortId }) },
    );
    expect(channelAssetResponse.status).toBe(409);
    await expect(channelAssetResponse.json()).resolves.toMatchObject({
      code: "SUBTITLE_TEMPLATE_EDIT_UNSUPPORTED",
    });
    expect(Array.from(
      channelAssetDb.mock.calls[0][0] as TemplateStringsArray,
    ).join("")).not.toContain("s.subtitle_template_id is null");
    expect(mocks.signedUrl).not.toHaveBeenCalled();
  });

  it("serves subtitle-template editor assets only to the active admin v3 canary", async () => {
    process.env.EDITOR_RENDERING_V2_ENABLED = "true";
    process.env.RANGE_EDITING_ENABLED = "true";
    process.env.CLOUDFRONT_DOMAIN = "cdn.example.com";
    process.env.CLOUDFRONT_KEY_PAIR_ID = "key-pair";
    process.env.CLOUDFRONT_PRIVATE_KEY_B64 = Buffer.from("private-key").toString("base64");
    const candidateReleaseId = "5a5f9f4d-f59d-4ba3-a28a-9396ac8284a7";
    const adminV3Release = {
      publicEnabled: false,
      canaryEnabled: true,
      runtimeEnabled: false,
      testerEnabled: true,
      userIsAdmin: true,
      stableReleaseId: null,
      stableUiVersion: null,
      stableDocumentVersion: null,
      stableStatus: null,
      candidateReleaseId,
      candidateUiVersion: 3,
      candidateDocumentVersion: 3,
      candidateStatus: "canary_active",
      candidateSubtitleEditingCapable: true,
      subtitleEditingPublicEnabled: false,
    };
    const expiresAt = new Date(Date.now() + 60_000);

    const sourceDb = dbWithRows([{
      cleanClipS3Key: "edit-sources/clean.mp4",
      expiresAt,
      subtitleTemplateId: "pop",
    }], [adminV3Release]);
    mocks.getDb.mockReturnValue(sourceDb);
    const sourceResponse = await accessEditSource(
      new Request(`http://localhost/api/shorts/${shortId}/edit-source`),
      { params: Promise.resolve({ shortId }) },
    );
    expect(sourceResponse.status).toBe(200);
    await expect(sourceResponse.json()).resolves.toMatchObject({
      url: "https://cdn.example.com/signed-edit-source.mp4",
    });

    const timelineDb = dbWithRows([{
      editTimelineS3Key: null,
      cleanClipS3Key: "edit-sources/clean.mp4",
      startSeconds: 10,
      endSeconds: 20,
      initialStartSeconds: 10,
      initialEndSeconds: 20,
      subtitleSegments: [{ start: 0, end: 5, text: "자막" }],
      expiresAt,
      subtitleTemplateId: "pop",
    }], [adminV3Release]);
    mocks.getDb.mockReturnValue(timelineDb);
    const timelineResponse = await accessEditTimeline(
      new Request(`http://localhost/api/shorts/${shortId}/edit-timeline`),
      { params: Promise.resolve({ shortId }) },
    );
    expect(timelineResponse.status).toBe(200);
    await expect(timelineResponse.json()).resolves.toMatchObject({
      url: "https://cdn.example.com/signed-edit-source.mp4",
      subtitleSegments: [{ start: 0, end: 5, text: "자막" }],
    });

    const channelAssetDb = dbWithRows([{
      assetKey: "edit-sources/a/editor-assets/channel.png",
      expiresAt,
      subtitleTemplateId: "pop",
    }], [adminV3Release]);
    mocks.getDb.mockReturnValue(channelAssetDb);
    const channelAssetResponse = await accessEditorChannelAsset(
      new Request(`http://localhost/api/shorts/${shortId}/editor-channel-asset`),
      { params: Promise.resolve({ shortId }) },
    );
    expect(channelAssetResponse.status).toBe(307);
  });

  it.each([
    {
      label: "queues a sparse source cue id for the active admin canary",
      cueIndex: 7,
      sourceCueIndexes: [7],
      expectedStatus: 202,
    },
    {
      label: "rejects a cue id that is absent from the source caption spec",
      cueIndex: 6,
      sourceCueIndexes: [7],
      expectedStatus: 400,
    },
    {
      label: "rejects a duplicate raw source cue id",
      cueIndex: 7,
      sourceCueIndexes: [7, 7],
      expectedStatus: 400,
    },
  ])("$label", async ({ cueIndex, sourceCueIndexes, expectedStatus }) => {
    process.env.EDITOR_RENDERING_V2_ENABLED = "true";
    const candidateReleaseId = "5a5f9f4d-f59d-4ba3-a28a-9396ac8284a7";
    const requestId = "5253b207-cd49-45bc-8d83-69c2b781e21f";
    const adminV3Release = {
      publicEnabled: false,
      canaryEnabled: true,
      runtimeEnabled: false,
      testerEnabled: true,
      userIsAdmin: true,
      stableReleaseId: null,
      stableUiVersion: null,
      stableDocumentVersion: null,
      stableStatus: null,
      candidateReleaseId,
      candidateUiVersion: 3,
      candidateDocumentVersion: 3,
      candidateStatus: "canary_active",
      candidateSubtitleEditingCapable: true,
      subtitleEditingPublicEnabled: false,
    };
    const document = JSON.parse(readFileSync(
      new URL("../../../test-fixtures/editor-document-v3.json", import.meta.url),
      "utf8",
    ));
    document.renderSpec = {
      ...document.renderSpec,
      version: 2,
      subtitles: {
        centerX: 540,
        offsetY: 0,
        scale: 1,
        cueEdits: [{
          cueIndex,
          text: "수정한 자막",
        }],
      },
    };
    const db = dbWithRows(
      [adminV3Release],
      [{
        id: shortId,
        jobId: "job-a",
        mvpSessionId: "session-a",
        status: "ready",
        renderVersion: 3,
        durationSeconds: 3.5,
        templateId: "dark-minimal",
        customTemplateId: null,
        templateSnapshot: { presetVersion: 3 },
        videoAspectRatio: "16:9",
        editTimelineS3Key: "edit-sources/timeline.mp4",
        editTimelineStartSeconds: 10,
        editTimelineEndSeconds: 20,
        cleanClipS3Key: "edit-sources/clean.mp4",
        startSeconds: 11,
        endSeconds: 16,
        subtitleTemplateId: "pop",
        captionRenderSpec: {
          schemaVersion: 3,
          templateId: "pop",
          captionPlacement: "lower",
          fps: 30,
          safeArea: { x: 72, y: 192, width: 936, height: 1_536 },
          font: {
            fontId: "pretendard",
            fileId: "Pretendard-Bold.woff2",
            sha256: "0000000000000000000000000000000000000000000000000000000000000000",
            family: "Pretendard",
            weight: 700,
          },
          style: {
            fontSize: 64,
            textColor: "#FFFFFF",
            accentColor: "#16A34A",
            outlineColor: "#000000",
            outlineWidth: 8,
          },
          cues: sourceCueIndexes.map((sourceCueIndex, sourceCuePosition) => ({
            sourceCueIndex,
            startFrame: sourceCuePosition * 30,
            endFrame: (sourceCuePosition + 1) * 30,
            words: [{ text: "자막" }],
            events: [{
              startFrame: sourceCuePosition * 30,
              endFrame: (sourceCuePosition + 1) * 30,
            }],
          })),
        },
        channelThumbnailUrl: "https://example.com/channel.png",
        editorDocument: null,
        onboardingWelcomeFunded: false,
      }],
      [],
    );
    const tx = dbWithRows(
      [adminV3Release],
      [{ id: requestId }],
      [{ id: shortId }],
      [],
    );
    const begin = vi.fn(
      (callback: (transaction: typeof tx) => unknown) => callback(tx),
    );
    Object.assign(db, { begin });
    mocks.getDb.mockReturnValue(db);

    const response = await applyRangeEdit(
      jsonRequest(`http://localhost/api/shorts/${shortId}/apply-edit`, {
        requestId,
        release: {
          releaseId: candidateReleaseId,
          channel: "canary",
          uiVersion: 3,
          documentVersion: 3,
        },
        document,
      }),
      { params: Promise.resolve({ shortId }) },
    );

    expect(response.status).toBe(expectedStatus);
    if (expectedStatus === 400) {
      await expect(response.json()).resolves.toMatchObject({
        code: "EDITOR_CAPTION_CUE_INVALID",
      });
      expect(begin).not.toHaveBeenCalled();
      return;
    }
    await expect(response.json()).resolves.toMatchObject({
      status: "rerendering",
      releaseId: candidateReleaseId,
      releaseChannel: "canary",
    });
    const updateCall = tx.mock.calls[2];
    expect(Array.from(updateCall[0] as TemplateStringsArray).join(""))
      .toContain("s.subtitle_template_id is null");
    expect(updateCall).toContain(true);
  });

  it("blocks caption comment regeneration before reservation or Gemini usage", async () => {
    process.env.EDITOR_OVERLAY_PREVIEW_ENABLED = "true";
    const db = dbWithRows(
      [],
      [{
        id: shortId,
        hookTitle: "자막 영상",
        highlightReason: "테스트",
        subtitleSegments: [],
        status: "ready",
        subtitleTemplateId: "pop",
      }],
    );
    mocks.getDb.mockReturnValue(db);

    const response = await regenerateComments(
      jsonRequest(`http://localhost/api/shorts/${shortId}/regenerate-comments`, {
        requestId: "8ef92390-124f-49e0-803b-f8987a7a3118",
        commentCount: 1,
      }),
      { params: Promise.resolve({ shortId }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "SUBTITLE_TEMPLATE_EDIT_UNSUPPORTED",
    });
    const queriedSql = db.mock.calls.map(([strings]) =>
      Array.from(strings as TemplateStringsArray).join(""),
    ).join("\n");
    expect(queriedSql).toContain("generated_short.subtitle_template_id is null");
    expect(queriedSql).not.toContain("reserve_ai_comment_regeneration_usage");
    expect(mocks.generateComments).not.toHaveBeenCalled();
  });

  it("keeps ordinary comment regeneration unchanged", async () => {
    process.env.EDITOR_OVERLAY_PREVIEW_ENABLED = "true";
    const db = dbWithRows(
      [],
      [{
        id: shortId,
        hookTitle: "일반 영상",
        highlightReason: "테스트",
        subtitleSegments: [],
        status: "ready",
        subtitleTemplateId: null,
      }],
      [{ reservationId: "reservation-comment" }],
      [],
      [{ id: "reservation-comment" }],
    );
    mocks.getDb.mockReturnValue(db);

    const response = await regenerateComments(
      jsonRequest(`http://localhost/api/shorts/${shortId}/regenerate-comments`, {
        requestId: "bda42bad-ae7c-43bb-960f-2c5984285404",
        commentCount: 1,
      }),
      { params: Promise.resolve({ shortId }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      comments: ["생성된 댓글"],
    });
    expect(mocks.generateComments).toHaveBeenCalledOnce();
    const queriedSql = db.mock.calls.map(([strings]) =>
      Array.from(strings as TemplateStringsArray).join(""),
    ).join("\n");
    expect(queriedSql).toContain("reserve_ai_comment_regeneration_usage");
  });
});

describe("MVP state visibility", () => {
  it("hides all projects until the visitor signs in", async () => {
    mocks.authenticatedUser.mockResolvedValue(null);
    mocks.publicState.mockResolvedValue({
      plans: [{ code: "free", displayName: "Free", monthlySourceSeconds: 0, retentionDays: 1, monthlyPriceKrw: 0, yearlyPriceKrw: 0, maxActiveJobs: 0 }],
      generatedShortCount: 4321,
    });
    mocks.getDb.mockReturnValue(vi.fn());
    const response = await getMvpState();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sessionId: null,
      user: null,
      recentJobs: [],
    });
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.usage).not.toHaveBeenCalled();
    expect(mocks.recentJobs).not.toHaveBeenCalled();
    expect(mocks.publicExamples).not.toHaveBeenCalled();
  });

  it("returns only the authenticated user's project query result", async () => {
    mocks.getDb.mockReturnValue(vi.fn());
    mocks.recentJobs.mockResolvedValue([{ id: "job-a" }]);
    const response = await getMvpState();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ recentJobs: [{ id: "job-a" }] });
    expect(mocks.recentJobs).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: "user-a" }));
  });
});

describe("job API security and idempotency", () => {
  it("requires login before creating a job", async () => {
    mocks.authenticatedSession.mockRejectedValue(new HttpError(401, "로그인이 필요합니다."));
    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-red",
      rightsConfirmed: true,
      requestId: "4a2ea3f0-49a9-4b2f-98ff-134d392511d9",
    }));
    expect(response.status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("creates a source-range job with selected usage and exact Batch target", async () => {
    const { db, tx } = dbForSuccessfulRangeJobCreation();
    mocks.getDb.mockReturnValue(db);

    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-red",
      rightsConfirmed: true,
      requestId: "4a2ea3f0-49a9-4b2f-98ff-134d392511f0",
      rangeStartSeconds: 1200,
      rangeEndSeconds: 2400,
    }));

    expect(response.status).toBe(202);
    const insertCall = tx.mock.calls.find(([strings]) =>
      Array.from(strings as TemplateStringsArray).join("").includes(
        "insert into shorts_mvp.video_jobs",
      ));
    expect(insertCall?.slice(1)).toEqual(expect.arrayContaining([
      7200,
      1200,
      2400,
      150,
      true,
      process.env.SOURCE_RANGE_JOB_DEFINITION_ARN,
      process.env.SOURCE_RANGE_BATCH_QUEUE_ARN,
    ]));
    const reservationCall = tx.mock.calls.find(([strings]) =>
      Array.from(strings as TemplateStringsArray).join("").includes(
        "insert into shorts_mvp.usage_reservations",
      ));
    expect(reservationCall?.slice(1)).toContain(1200);
  });

  it("pins only an admitted admin job to the ElevenLabs candidate", async () => {
    process.env.ELEVENLABS_TRANSCRIPTION_ENABLED = "true";
    const db = dbWithRows([], [analysisRow]);
    const tx = dbWithRows(
      [],
      [
        { flagKey: "elevenlabs_transcription", enabled: true },
        { flagKey: "elevenlabs_transcription_public", enabled: false },
      ],
      [{ isAdmin: true }],
      [],
      [{ active: 0 }],
      [{ projectNumber: 11 }],
      [{ id: "reservation-elevenlabs" }],
      [],
      [],
    );
    Object.assign(db, {
      begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    });
    mocks.getDb.mockReturnValue(db);

    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-red",
      rightsConfirmed: true,
      requestId: "51903416-67cc-410a-a1b7-89ffcc24f48e",
    }));

    expect(response.status).toBe(202);
    const insertCall = tx.mock.calls.find(([strings]) =>
      Array.from(strings as TemplateStringsArray).join("").includes(
        "insert into shorts_mvp.video_jobs",
      ));
    expect(insertCall?.slice(1)).toEqual(expect.arrayContaining([
      "elevenlabs_primary_openai_fallback",
      process.env.ELEVENLABS_TRANSCRIPTION_JOB_DEFINITION_ARN,
      process.env.ELEVENLABS_TRANSCRIPTION_BATCH_QUEUE_ARN,
    ]));
  });

  it("pins an admitted admin personal custom-template job to the ElevenLabs candidate", async () => {
    process.env.ELEVENLABS_TRANSCRIPTION_ENABLED = "true";
    const customTemplateId = "3e5cd85c-03db-4f04-9854-c39b74486172";
    const customTemplateConfig = createDefaultTemplateConfig("white-yellow");
    customTemplateConfig.video = videoFrameForAspect("9:16");
    const db = dbWithRows([], [analysisRow]);
    const tx = dbWithRows(
      [],
      [
        { flagKey: "elevenlabs_transcription", enabled: true },
        { flagKey: "elevenlabs_transcription_public", enabled: false },
      ],
      [{ isAdmin: true }],
      [],
      [{
        id: customTemplateId,
        name: "개인 세로 템플릿",
        baseTemplateId: "white-yellow",
        config: customTemplateConfig,
        version: 3,
      }],
      [{ active: 0 }],
      [{ projectNumber: 14 }],
      [{ id: "reservation-elevenlabs-custom" }],
      [],
      [],
    );
    Object.assign(db, {
      begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    });
    mocks.getDb.mockReturnValue(db);

    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-red",
      customTemplateId,
      rightsConfirmed: true,
      requestId: "cc9ec978-2600-43a8-8f78-71472d45d4a6",
    }));

    expect(response.status).toBe(202);
    const insertCall = tx.mock.calls.find(([strings]) =>
      Array.from(strings as TemplateStringsArray).join("").includes(
        "insert into shorts_mvp.video_jobs",
      ));
    expect(insertCall?.slice(1)).toEqual(expect.arrayContaining([
      customTemplateId,
      "elevenlabs_primary_openai_fallback",
      process.env.ELEVENLABS_TRANSCRIPTION_JOB_DEFINITION_ARN,
      process.env.ELEVENLABS_TRANSCRIPTION_BATCH_QUEUE_ARN,
    ]));
    expect(insertCall?.slice(1)).not.toContain(
      process.env.SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN,
    );
  });

  it("pins an authorized subtitle template job to its isolated candidate", async () => {
    process.env.SUBTITLE_TEMPLATES_ENABLED = "true";
    process.env.ELEVENLABS_TRANSCRIPTION_ENABLED = "true";
    const db = dbWithRows([], [analysisRow]);
    const tx = dbWithRows(
      [],
      [
        { flagKey: "subtitle_templates", enabled: true },
        { flagKey: "subtitle_templates_public", enabled: false },
      ],
      [{ isAdmin: true }],
      [
        { flagKey: "elevenlabs_transcription", enabled: true },
        { flagKey: "elevenlabs_transcription_public", enabled: false },
        { flagKey: "elevenlabs_public_compliance_approved", enabled: false },
      ],
      [{ isAdmin: true }],
      [],
      [{ active: 0 }],
      [{ projectNumber: 12 }],
      [{ id: "reservation-subtitle" }],
      [],
      [],
    );
    Object.assign(db, {
      begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    });
    mocks.getDb.mockReturnValue(db);

    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-minimal",
      subtitleTemplateId: "highlight",
      subtitleCaptionPlacement: "center",
      brandColor: "#FF715E",
      videoAspectRatio: "9:16",
      rightsConfirmed: true,
      requestId: "29199bd8-8097-49df-aa79-fd531436c4fa",
    }));

    expect(response.status).toBe(202);
    const insertCall = tx.mock.calls.find(([strings]) =>
      Array.from(strings as TemplateStringsArray).join("").includes(
        "insert into shorts_mvp.video_jobs",
      ));
    expect(insertCall?.slice(1)).toEqual(expect.arrayContaining([
      "highlight",
      expect.objectContaining({ presetVersion: 3, brandColor: "#FF715E" }),
      expect.objectContaining({
        subtitleTemplateId: "highlight",
        selectionId: "highlight",
        captionPlacement: "center",
        baseTemplateId: "dark-minimal",
        videoAspectRatio: "9:16",
        color: expect.objectContaining({ active: "#FF715E" }),
        safeArea: { x: 120, y: 890, width: 840, height: 140 },
      }),
      "elevenlabs_primary_openai_fallback",
      process.env.SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN,
      process.env.SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN,
    ]));
  });

  it("pins an authorized regular brand-color job to the isolated admin candidate", async () => {
    process.env.SUBTITLE_TEMPLATES_ENABLED = "true";
    process.env.ELEVENLABS_TRANSCRIPTION_ENABLED = "true";
    const db = dbWithRows([], [analysisRow]);
    const tx = dbWithRows(
      [],
      [
        { flagKey: "subtitle_templates", enabled: true },
        { flagKey: "subtitle_templates_public", enabled: false },
      ],
      [{ isAdmin: true }],
      [
        { flagKey: "elevenlabs_transcription", enabled: true },
        { flagKey: "elevenlabs_transcription_public", enabled: false },
        { flagKey: "elevenlabs_public_compliance_approved", enabled: false },
      ],
      [{ isAdmin: true }],
      [],
      [{ active: 0 }],
      [{ projectNumber: 13 }],
      [{ id: "reservation-brand-color" }],
      [],
      [],
    );
    Object.assign(db, {
      begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    });
    mocks.getDb.mockReturnValue(db);

    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "comment-capture",
      brandColor: "#FF715E",
      rightsConfirmed: true,
      requestId: "e75e0a53-9c53-48b0-a62e-601e6bb24b8a",
    }));

    expect(response.status).toBe(202);
    const insertCall = tx.mock.calls.find(([strings]) =>
      Array.from(strings as TemplateStringsArray).join("").includes(
        "insert into shorts_mvp.video_jobs",
      ));
    expect(insertCall?.slice(1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ presetVersion: 3, brandColor: "#FF715E" }),
      "elevenlabs_primary_openai_fallback",
      process.env.SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN,
      process.env.SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN,
    ]));
  });

  it("fails closed when a subtitle candidate cannot use ElevenLabs transcription", async () => {
    process.env.SUBTITLE_TEMPLATES_ENABLED = "true";
    const db = dbWithRows([], [analysisRow]);
    const tx = dbWithRows(
      [],
      [
        { flagKey: "subtitle_templates", enabled: true },
        { flagKey: "subtitle_templates_public", enabled: false },
      ],
      [{ isAdmin: true }],
      [],
    );
    Object.assign(db, {
      begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    });
    mocks.getDb.mockReturnValue(db);

    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-minimal",
      subtitleTemplateId: "highlight",
      rightsConfirmed: true,
      requestId: "e971dc3a-7bad-4b26-9e9f-cdba6fb87f24",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "SUBTITLE_SUITE_TRANSCRIPTION_DISABLED",
    });
    expect(tx.mock.calls.some(([strings]) =>
      Array.from(strings as TemplateStringsArray).join("").includes(
        "insert into shorts_mvp.video_jobs",
      ))).toBe(false);
  });

  it("fails closed for a public subtitle job when compliance approval is revoked", async () => {
    process.env.SUBTITLE_TEMPLATES_ENABLED = "true";
    process.env.ELEVENLABS_TRANSCRIPTION_ENABLED = "true";
    process.env.EDITOR_RENDERING_V2_ENABLED = "true";
    process.env.EDITOR_RENDERING_V2_GLOBAL_ENABLED = "true";
    const stableReleaseId = "fb2172e5-fc37-4a8f-82ad-5c4db355d02d";
    const publicReleaseRow = {
      publicEnabled: true,
      canaryEnabled: false,
      runtimeEnabled: true,
      testerEnabled: false,
      userIsAdmin: false,
      stableReleaseId,
      stableUiVersion: 3,
      stableDocumentVersion: 3,
      stableStatus: "stable",
      stableSubtitleEditingCapable: true,
      candidateReleaseId: null,
      candidateUiVersion: null,
      candidateDocumentVersion: null,
      candidateStatus: null,
      candidateSubtitleEditingCapable: false,
      subtitleEditingPublicEnabled: true,
    };
    const db = dbWithRows([], [analysisRow]);
    const tx = dbWithRows(
      [],
      [
        { flagKey: "subtitle_templates", enabled: true },
        { flagKey: "subtitle_templates_public", enabled: true },
      ],
      [{ isAdmin: false }],
      [publicReleaseRow],
      [
        { flagKey: "elevenlabs_transcription", enabled: true },
        { flagKey: "elevenlabs_transcription_public", enabled: true },
        { flagKey: "elevenlabs_public_compliance_approved", enabled: false },
      ],
      [{ isAdmin: false }],
      [publicReleaseRow],
    );
    Object.assign(db, {
      begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    });
    mocks.getDb.mockReturnValue(db);

    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-minimal",
      subtitleTemplateId: "highlight",
      rightsConfirmed: true,
      requestId: "33a11fa2-4b6a-4468-ac16-af8ce1b2d35e",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "SUBTITLE_SUITE_TRANSCRIPTION_DISABLED",
    });
    expect(tx.mock.calls.some(([strings]) =>
      Array.from(strings as TemplateStringsArray).join("").includes(
        "insert into shorts_mvp.video_jobs",
      ))).toBe(false);
  });

  it("rejects the retired basic subtitle template before touching storage", async () => {
    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-minimal",
      subtitleTemplateId: "basic",
      rightsConfirmed: true,
      requestId: "02b4b365-06de-41aa-888d-f39b5d28ae97",
    }));

    expect(response.status).toBe(400);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects a subtitle position without a subtitle style before touching storage", async () => {
    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-minimal",
      subtitleCaptionPlacement: "center",
      rightsConfirmed: true,
      requestId: "bceea4e6-3db2-4816-9b58-ef20f2ad8425",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      detail: "자막 위치는 자막 템플릿과 함께 선택해 주세요.",
    });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects a forged subtitle template field from a non-admin", async () => {
    process.env.SUBTITLE_TEMPLATES_ENABLED = "true";
    const db = dbWithRows([], [analysisRow]);
    const tx = dbWithRows(
      [],
      [
        { flagKey: "subtitle_templates", enabled: true },
        { flagKey: "subtitle_templates_public", enabled: false },
      ],
      [{ isAdmin: false }],
    );
    Object.assign(db, {
      begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    });
    mocks.getDb.mockReturnValue(db);

    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-minimal",
      subtitleTemplateId: "highlight",
      rightsConfirmed: true,
      requestId: "963e8dab-8244-463d-98ac-f7ab569dd227",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      detail: "현재 계정에서는 자막 템플릿 테스트를 사용할 수 없습니다.",
    });
    expect(tx.mock.calls.some(([strings]) =>
      Array.from(strings as TemplateStringsArray).join("").includes(
        "insert into shorts_mvp.video_jobs",
      ))).toBe(false);
  });

  it("rejects a forged brand color field from a non-admin regular template request", async () => {
    process.env.SUBTITLE_TEMPLATES_ENABLED = "true";
    const db = dbWithRows([], [analysisRow]);
    const tx = dbWithRows(
      [],
      [
        { flagKey: "subtitle_templates", enabled: true },
        { flagKey: "subtitle_templates_public", enabled: false },
      ],
      [{ isAdmin: false }],
    );
    Object.assign(db, {
      begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    });
    mocks.getDb.mockReturnValue(db);

    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-minimal",
      brandColor: "#FF715E",
      rightsConfirmed: true,
      requestId: "c2d6f74f-c88b-4daa-b7bb-acde46ec3fd9",
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      detail: "현재 계정에서는 브랜드 컬러를 사용할 수 없습니다.",
      code: "SUBTITLE_SUITE_ACCESS_REQUIRED",
    });
  });

  it("fails closed when a subtitle job cannot use the isolated AWS Batch target", async () => {
    process.env.SUBTITLE_TEMPLATES_ENABLED = "true";
    process.env.VIDEO_JOB_BACKEND = "mac_pull";
    const db = dbWithRows([], [analysisRow]);
    const tx = dbWithRows(
      [],
      [
        { flagKey: "subtitle_templates", enabled: true },
        { flagKey: "subtitle_templates_public", enabled: false },
      ],
      [{ isAdmin: true }],
    );
    Object.assign(db, {
      begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    });
    mocks.getDb.mockReturnValue(db);

    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-minimal",
      subtitleTemplateId: "pop",
      rightsConfirmed: true,
      requestId: "35a05777-8aad-457a-8745-271d5e1319b6",
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      detail: "자막 템플릿 테스트 작업을 안전한 전용 워커에 연결하지 못했습니다.",
    });
  });

  it("does not consult subtitle release state for a regular job request", async () => {
    process.env.SUBTITLE_TEMPLATES_ENABLED = "true";
    const db = dbWithRows([], [analysisRow]);
    const tx = dbWithRows(
      [],
      [],
      [{ active: 0 }],
      [{ projectNumber: 13 }],
      [{ id: "reservation-regular" }],
      [],
      [],
    );
    Object.assign(db, {
      begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    });
    mocks.getDb.mockReturnValue(db);

    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-red",
      rightsConfirmed: true,
      requestId: "1b94a244-7684-4e0f-b2cf-50be83217de2",
    }));

    expect(response.status).toBe(202);
    const queriedSql = tx.mock.calls.map(([strings]) =>
      Array.from(strings as TemplateStringsArray).join(""),
    ).join("\n");
    expect(queriedSql).not.toContain("subtitle_templates");
  });

  it("blocks a snapshotted source-range analysis whenever the master switch is off", async () => {
    process.env.SOURCE_RANGE_SELECTION_ENABLED = "false";
    const db = dbWithRows(
      [],
      [{ ...analysisRow, durationSeconds: 7200, sourceRangeSelectionEnabled: true }],
      [
        { flagKey: "source_range_selection", enabled: true },
        { flagKey: "source_range_selection_public", enabled: true },
      ],
      [{ isAdmin: false }],
    );
    const begin = vi.fn();
    Object.assign(db, { begin });
    mocks.getDb.mockReturnValue(db);

    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-red",
      rightsConfirmed: true,
      requestId: "4a2ea3f0-49a9-4b2f-98ff-134d392511f1",
      rangeStartSeconds: 1200,
      rangeEndSeconds: 2400,
    }));

    expect(response.status).toBe(409);
    expect(begin).not.toHaveBeenCalled();
  });

  it("blocks a non-admin snapshotted range after public access is disabled", async () => {
    const db = dbWithRows(
      [],
      [{ ...analysisRow, durationSeconds: 7200, sourceRangeSelectionEnabled: true }],
      [
        { flagKey: "source_range_selection", enabled: true },
        { flagKey: "source_range_selection_public", enabled: false },
      ],
      [{ isAdmin: false }],
    );
    const begin = vi.fn();
    Object.assign(db, { begin });
    mocks.getDb.mockReturnValue(db);

    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-red",
      rightsConfirmed: true,
      requestId: crypto.randomUUID(),
      rangeStartSeconds: 1200,
      rangeEndSeconds: 2400,
    }));

    expect(response.status).toBe(409);
    expect(begin).not.toHaveBeenCalled();
  });

  it.each([
    [1200, 1439.999],
    [1200, 4800.001],
    [7000, 7240],
  ])("rejects an invalid selected source range (%s-%s)", async (start, end) => {
    const db = dbWithRows(
      [],
      [{ ...analysisRow, durationSeconds: 7200, sourceRangeSelectionEnabled: true }],
      [
        { flagKey: "source_range_selection", enabled: true },
        { flagKey: "source_range_selection_public", enabled: true },
      ],
      [{ isAdmin: false }],
    );
    const begin = vi.fn();
    Object.assign(db, { begin });
    mocks.getDb.mockReturnValue(db);

    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-red",
      rightsConfirmed: true,
      requestId: crypto.randomUUID(),
      rangeStartSeconds: start,
      rangeEndSeconds: end,
    }));

    expect(response.status).toBe(400);
    expect(begin).not.toHaveBeenCalled();
  });

  it("keeps legacy web clients working without a per-job rights confirmation", async () => {
    mocks.getDb.mockReturnValue(dbForSuccessfulJobCreation());
    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
      analysisId,
      templateId: "dark-red",
      rightsConfirmed: false,
      requestId: "4a2ea3f0-49a9-4b2f-98ff-134d392511d0",
    }));
    expect(response.status).toBe(202);
    expect(mocks.authenticatedSession).toHaveBeenCalledOnce();
  });

  it("creates a job after the per-job rights confirmation", async () => {
    mocks.getDb.mockReturnValue(dbForSuccessfulJobCreation());
    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
      analysisId,
      templateId: "dark-red",
      rightsConfirmed: true,
      requestId: "4a2ea3f0-49a9-4b2f-98ff-134d392511d0",
    }));
    expect(response.status).toBe(202);
    expect(mocks.authenticatedSession).toHaveBeenCalledOnce();
  });

  it("temporarily blocks only after repeated membership or paid-content failures", async () => {
    const db = dbWithRows([], [analysisRow]);
    const tx = dbWithRows([], [], [{
      active: 0,
      restrictedContentCooldownMinutes: 7,
    }]);
    Object.assign(db, { begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)) });
    mocks.getDb.mockReturnValue(db);

    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-red",
      rightsConfirmed: true,
      requestId: "2d9e4ec7-459c-430f-ab0c-b3d9bb16883f",
    }));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      detail: "너무 자주 요청이 발생하여 잠시 7분 동안 작업을 할 수 없습니다.",
      code: "RESTRICTED_CONTENT_COOLDOWN",
    });
    expect(mocks.usage).not.toHaveBeenCalled();
    expect(mocks.wakeDispatcher).not.toHaveBeenCalled();
  });

  it("lets a signed-in free user create while plan enforcement is disabled", async () => {
    mocks.usage.mockResolvedValue({
      ...usage,
      limitSeconds: 0,
      remainingSeconds: 0,
      baseLimitSeconds: 0,
      baseRemainingSeconds: 0,
      enforcementEnabled: false,
    });
    mocks.billing.mockResolvedValue({
      status: "none", planCode: "free", billingCycle: null,
      currentPeriodStart: null, currentPeriodEnd: null, nextChargeAt: null,
      cancelAtPeriodEnd: false, scheduledPlanCode: null, scheduledBillingCycle: null,
      cardIssuer: null, cardNumberMasked: null, cardLast4: null,
      canCreateJobs: false, maxActiveJobs: 0, retentionDays: 1,
    });
    const db = dbWithRows([], [analysisRow]);
    const tx = dbWithRows([], [], [{ active: 0 }], [{ projectNumber: 2 }], [{ id: "reservation-free" }], []);
    Object.assign(db, { begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)) });
    mocks.getDb.mockReturnValue(db);

    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-red",
      rightsConfirmed: true,
      requestId: "4a2ea3f0-49a9-4b2f-98ff-134d392511e0",
    }));

    expect(response.status).toBe(202);
    expect(tx).toHaveBeenCalledTimes(7);
  });

  it("still requires an active subscription when plan enforcement is restored", async () => {
    mocks.billing.mockResolvedValue({
      status: "none", planCode: "free", billingCycle: null,
      currentPeriodStart: null, currentPeriodEnd: null, nextChargeAt: null,
      cancelAtPeriodEnd: false, scheduledPlanCode: null, scheduledBillingCycle: null,
      cardIssuer: null, cardNumberMasked: null, cardLast4: null,
      canCreateJobs: false, maxActiveJobs: 0, retentionDays: 1,
    });
    const db = dbWithRows([], [analysisRow]);
    const tx = dbWithRows([], [], [{ active: 0 }]);
    Object.assign(db, { begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)) });
    mocks.getDb.mockReturnValue(db);

    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-red",
      rightsConfirmed: true,
      requestId: "4a2ea3f0-49a9-4b2f-98ff-134d392511e1",
    }));

    expect(response.status).toBe(402);
    expect(tx).toHaveBeenCalledTimes(3);
  });

  it("returns an existing request without a second Batch submission", async () => {
    mocks.getDb.mockReturnValue(dbWithRows([{ id: "job-existing", projectNumber: 7, status: "queued" }]));
    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
      analysisId,
      templateId: "dark-red",
      rightsConfirmed: true,
      clipLengthOption: "sec_31_60",
      requestId: "4a2ea3f0-49a9-4b2f-98ff-134d392511d0",
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jobId: "job-existing",
      projectNumber: 7,
      status: "queued",
      usage,
    });
    expect(mocks.submitInitial).not.toHaveBeenCalled();
    expect(mocks.wakeDispatcher).not.toHaveBeenCalled();
  });

  it("rejects job creation when the analysis is blocked by YouTube availability", async () => {
    mocks.getDb.mockReturnValue(dbWithRows([], [{
      ...analysisRow,
      creationAllowed: false,
      creationBlockCode: "region_restricted",
      creationBlockReason: "이 영상은 국가별 시청이 제한된 영상입니다.",
    }]));
    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-red",
      rightsConfirmed: true,
      requestId: "4a2ea3f0-49a9-4b2f-98ff-134d392511d4",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      detail: "이 영상은 국가별 시청이 제한된 영상입니다.",
      code: "HTTP_409",
    });
    expect(mocks.submitInitial).not.toHaveBeenCalled();
  });

  it("rejects job creation when persisted metadata is shorter than three minutes", async () => {
    mocks.getDb.mockReturnValue(dbWithRows([], [{
      ...analysisRow,
      durationSeconds: 179,
    }]));
    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-red",
      rightsConfirmed: true,
      requestId: "4a2ea3f0-49a9-4b2f-98ff-134d392511d6",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      detail: "롱폼 영상만 사용할 수 있어요. 쇼츠를 만들려면 3분 이상의 영상을 입력해 주세요.",
      code: "SOURCE_VIDEO_TOO_SHORT",
    });
    expect(mocks.wakeDispatcher).not.toHaveBeenCalled();
  });

  it("rejects range fields from a non-entitled analysis", async () => {
    mocks.getDb.mockReturnValue(dbForSuccessfulJobCreation());
    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
      analysisId,
      templateId: "dark-red",
      rightsConfirmed: true,
      rangeStartSeconds: 100,
      rangeEndSeconds: 130,
      requestId: "4a2ea3f0-49a9-4b2f-98ff-134d392511d2",
    }));

    expect(response.status).toBe(409);
    expect(mocks.wakeDispatcher).not.toHaveBeenCalled();
  });

  it("keeps the queued job recoverable when the immediate dispatcher wake fails", async () => {
    mocks.getDb.mockReturnValue(dbForSuccessfulJobCreation());
    mocks.wakeDispatcher.mockRejectedValueOnce(new Error("temporary invoke failure"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-red",
      rightsConfirmed: true,
      requestId: "4a2ea3f0-49a9-4b2f-98ff-134d392511d5",
    }));

    expect(response.status).toBe(202);
    expect(mocks.wakeDispatcher).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith("outbox_dispatch_wake_failed", {
      jobId: expect.any(String),
      errorName: "Error",
    });
    error.mockRestore();
  });

  it("accepts the 5:4 video region ratio", async () => {
    mocks.getDb.mockReturnValue(dbForSuccessfulJobCreation());
    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-red",
      rightsConfirmed: true,
      videoAspectRatio: "5:4",
      requestId: "4a2ea3f0-49a9-4b2f-98ff-134d392511d4",
    }));

    expect(response.status).toBe(202);
  });

  it("versions every new supported comment preset job for the square-reference channel layout", async () => {
    const db = dbWithRows([], [analysisRow]);
    const tx = dbWithRows(
      [],
      [],
      [{ active: 0 }],
      [{ projectNumber: 7 }],
      [{ id: "reservation-comment-v2" }],
      [],
      [],
    );
    Object.assign(db, { begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)) });
    mocks.getDb.mockReturnValue(db);

    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "comment-capture",
      videoAspectRatio: "16:9",
      rightsConfirmed: true,
      requestId: "a25dd669-6410-41d2-9f7e-6e01fe0bc19e",
    }));

    expect(response.status).toBe(202);
    const insertCall = tx.mock.calls.find(([strings]) =>
      Array.from(strings as TemplateStringsArray).join("").includes("insert into shorts_mvp.video_jobs"),
    );
    expect(insertCall?.slice(1)).toContainEqual({ presetVersion: 3 });
    expect(insertCall?.slice(1)).toContain("16:9");
  });

  it("versions non-comment preset jobs for the square-reference channel position", async () => {
    const db = dbWithRows([], [analysisRow]);
    const tx = dbWithRows(
      [],
      [],
      [{ active: 0 }],
      [{ projectNumber: 8 }],
      [{ id: "reservation-fixed-channel-v3" }],
      [],
      [],
    );
    Object.assign(db, { begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)) });
    mocks.getDb.mockReturnValue(db);

    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-red",
      videoAspectRatio: "5:4",
      rightsConfirmed: true,
      requestId: "aa705073-af96-45fc-85cb-d13c60af45b1",
    }));

    expect(response.status).toBe(202);
    const insertCall = tx.mock.calls.find(([strings]) =>
      Array.from(strings as TemplateStringsArray).join("").includes("insert into shorts_mvp.video_jobs"),
    );
    expect(insertCall?.slice(1)).toContainEqual({ presetVersion: 3 });
  });

  it.each(["4:5", "9:16"] as const)(
    "rejects the %s ratio for the default comment preset",
    async (videoAspectRatio) => {
      const response = await createJob(jsonRequest("http://localhost/api/jobs", {
        analysisId,
        templateId: "comment-capture",
        videoAspectRatio,
        rightsConfirmed: true,
        requestId: "788377cc-754b-4184-939a-bd8ed46ba9ba",
      }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        detail: expect.stringContaining("세로형과 세로 꽉참"),
      });
    },
  );

  it("lets Plus use a saved custom-template ratio even when the client sends another ratio", async () => {
    const customTemplateId = "14f19366-89b7-4c54-8ec6-c0f2b75584c1";
    const config = createDefaultTemplateConfig();
    config.video = videoFrameForAspect("4:5");
    const db = dbWithRows([], [analysisRow]);
    const tx = dbWithRows(
      [],
      [],
      [{
        id: customTemplateId,
        name: "세로 고정 템플릿",
        baseTemplateId: "dark-minimal",
        config,
        version: 3,
      }],
      [{ active: 0 }],
      [{ projectNumber: 7 }],
      [{ id: "reservation-custom" }],
      [],
      [],
    );
    Object.assign(db, { begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)) });
    mocks.getDb.mockReturnValue(db);

    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-red",
      customTemplateId,
      videoAspectRatio: "16:9",
      rightsConfirmed: true,
      requestId: "47b1209d-213b-4f56-9668-ed2511c595f7",
    }));

    expect(response.status).toBe(202);
    const insertCall = tx.mock.calls.find(([strings]) =>
      Array.from(strings as TemplateStringsArray).join("").includes("insert into shorts_mvp.video_jobs"),
    );
    expect(insertCall?.slice(1)).toContain("4:5");
    expect(insertCall?.slice(1)).not.toContain("16:9");
  });

  it("rejects an unsupported video aspect ratio before touching the database", async () => {
    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-red",
      videoAspectRatio: "3:2",
      rightsConfirmed: true,
      requestId: "4a2ea3f0-49a9-4b2f-98ff-134d392511d3",
    }));
    expect(response.status).toBe(400);
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("does not expose another session's job", async () => {
    mocks.recentJobs.mockResolvedValue([]);
    const response = await getJob(
      new Request("http://localhost/api/jobs/job-b"),
      { params: Promise.resolve({ jobId: "job-b" }) },
    );
    expect(response.status).toBe(404);
    expect(mocks.recentJobs).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "session-a", userId: "user-a" }),
      "job-b",
    );
  });

  it("loads an owned project by its numeric route", async () => {
    mocks.getDb.mockReturnValue(vi.fn());
    mocks.projectByNumber.mockResolvedValue({ id: "job-a", projectNumber: 12 });

    const response = await getProject(
      new Request("http://localhost/api/projects/12"),
      { params: Promise.resolve({ projectNumber: "12" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      project: { id: "job-a", projectNumber: 12 },
      access: { canEdit: true, canDownload: true },
    });
    expect(mocks.projectByNumber).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "session-a", userId: "user-a" }),
      12,
    );
  });

  it("loads a public example project without requiring login", async () => {
    mocks.getDb.mockReturnValue(vi.fn());
    mocks.publicExampleByNumber.mockResolvedValue({
      id: "example-job",
      projectNumber: 12,
      isExample: true,
    });
    mocks.authenticatedSession.mockRejectedValue(new HttpError(401, "로그인이 필요합니다."));

    const response = await getProject(
      new Request("http://localhost/api/projects/12"),
      { params: Promise.resolve({ projectNumber: "12" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      project: { id: "example-job", projectNumber: 12, isExample: true },
      access: { canEdit: false, canDownload: false },
    });
    expect(mocks.authenticatedSession).not.toHaveBeenCalled();
    expect(mocks.projectByNumber).not.toHaveBeenCalled();
  });

  it("does not expose another user's numeric project route", async () => {
    mocks.getDb.mockReturnValue(vi.fn());
    mocks.projectByNumber.mockResolvedValue(null);

    const response = await getProject(
      new Request("http://localhost/api/projects/13"),
      { params: Promise.resolve({ projectNumber: "13" }) },
    );

    expect(response.status).toBe(404);
  });

  it("rejects malformed project numbers before creating a session", async () => {
    const response = await getProject(
      new Request("http://localhost/api/projects/not-a-number"),
      { params: Promise.resolve({ projectNumber: "not-a-number" }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.authenticatedSession).not.toHaveBeenCalled();
  });

  it("requires login for direct numeric project routes", async () => {
    mocks.authenticatedSession.mockRejectedValue(new HttpError(401, "로그인이 필요합니다."));

    const response = await getProject(
      new Request("http://localhost/api/projects/98"),
      { params: Promise.resolve({ projectNumber: "98" }) },
    );

    expect(response.status).toBe(401);
    expect(mocks.projectByNumber).not.toHaveBeenCalled();
  });

  it("returns blocked project actions without an active paid product", async () => {
    mocks.getDb.mockReturnValue(dbWithRows());
    mocks.projectByNumber.mockResolvedValue({ id: "job-free", projectNumber: 14 });
    mocks.billing.mockResolvedValue({ activeProducts: [] });

    const response = await getProject(
      new Request("http://localhost/api/projects/14"),
      { params: Promise.resolve({ projectNumber: "14" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      project: { id: "job-free", projectNumber: 14 },
      access: { canEdit: false, canDownload: false },
    });
  });

  it("returns enabled project actions for an active administrator-issued account", async () => {
    mocks.getDb.mockReturnValue(dbWithRows());
    mocks.projectByNumber.mockResolvedValue({ id: "job-managed", projectNumber: 15 });
    mocks.billing.mockResolvedValue({
      activeProducts: [],
      hasManagedFeatureAccess: true,
    });

    const response = await getProject(
      new Request("http://localhost/api/projects/15"),
      { params: Promise.resolve({ projectNumber: "15" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      project: { id: "job-managed", projectNumber: 15 },
      access: { canEdit: true, canDownload: true },
    });
  });
});

describe("plan API", () => {
  it("rejects direct plan mutations", async () => {
    const response = await selectPlan();
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ detail: expect.stringContaining("결제 승인") });
  });
});

describe("short ownership, expiry, and edit validation", () => {
  it("does not issue a download URL without an active paid product", async () => {
    mocks.billing.mockResolvedValue({ activeProducts: [] });
    mocks.getDb.mockReturnValue(dbWithRows([{ allowed: false }]));

    const response = await downloadShort(
      new Request("http://localhost/api/shorts/short-free/download"),
      { params: Promise.resolve({ shortId: "short-free" }) },
    );

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({
      code: "PAID_PROJECT_ACTION_REQUIRED",
    });
    expect(mocks.shortDownloadUrl).not.toHaveBeenCalled();
  });

  it("does not issue an edit source URL without an active paid product", async () => {
    mocks.billing.mockResolvedValue({ activeProducts: [] });
    mocks.getDb.mockReturnValue(dbWithRows([{ allowed: false }]));

    const response = await accessEditSource(
      new Request("http://localhost/api/shorts/short-free/edit-source"),
      { params: Promise.resolve({ shortId: "short-free" }) },
    );

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({
      code: "PAID_PROJECT_ACTION_REQUIRED",
    });
    expect(mocks.signedUrl).not.toHaveBeenCalled();
  });

  it("issues a download URL for an active administrator-issued account", async () => {
    mocks.billing.mockResolvedValue({
      activeProducts: [],
      hasManagedFeatureAccess: true,
    });
    mocks.getDb.mockReturnValue(dbWithRows(
      [{
        outputS3Key: "outputs/managed-short.mp4",
        expiresAt: new Date(Date.now() + 60_000),
        hookTitle: "발급계정 쇼츠",
      }],
    ));

    const response = await downloadShort(
      new Request("http://localhost/api/shorts/short-managed/download"),
      { params: Promise.resolve({ shortId: "short-managed" }) },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://cdn.example.com/signed-download.mp4");
  });

  it("issues an edit source URL for an active administrator-issued account", async () => {
    process.env.CLOUDFRONT_DOMAIN = "cdn.example.com";
    process.env.CLOUDFRONT_KEY_PAIR_ID = "key-pair";
    process.env.CLOUDFRONT_PRIVATE_KEY_B64 = Buffer.from("private-key").toString("base64");
    mocks.billing.mockResolvedValue({
      activeProducts: [],
      hasManagedFeatureAccess: true,
    });
    mocks.getDb.mockReturnValue(dbWithRows(
      [{
        cleanClipS3Key: "edit-sources/managed-clean.mp4",
        expiresAt: new Date(Date.now() + 60_000),
      }],
    ));

    const response = await accessEditSource(
      new Request("http://localhost/api/shorts/short-managed/edit-source"),
      { params: Promise.resolve({ shortId: "short-managed" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      url: "https://cdn.example.com/signed-edit-source.mp4",
    });
  });

  it("rejects a title longer than two lines before touching the database", async () => {
    const request = jsonRequest("http://localhost/api/shorts/short-a", {
      hookTitle: "첫 줄\n둘째 줄\n셋째 줄",
      channelDisplayName: "채널",
      subtitlesEnabled: false,
      subtitleSegments: [],
      templateId: "dark-red",
    });
    const response = await patchShort(request, {
      params: Promise.resolve({ shortId: "short-a" }),
    });
    expect(response.status).toBe(400);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects editing a short not owned by the session", async () => {
    mocks.getDb.mockReturnValue(dbWithRows([]));
    const response = await patchShort(jsonRequest("http://localhost/api/shorts/short-b", {
      hookTitle: "유효한 제목",
      channelDisplayName: "채널",
      subtitlesEnabled: false,
      subtitleSegments: [],
      templateId: "dark-red",
    }), { params: Promise.resolve({ shortId: "short-b" }) });
    expect(response.status).toBe(404);
  });

  it("rejects patching a subtitle-template output before changing its metadata", async () => {
    const db = dbWithRows([{
      id: "short-caption",
      subtitleTemplateId: "basic",
    }]);
    mocks.getDb.mockReturnValue(db);

    const response = await patchShort(jsonRequest(
      "http://localhost/api/shorts/short-caption",
      {
        hookTitle: "변경 시도",
        channelDisplayName: "채널",
        subtitlesEnabled: true,
        subtitleSegments: [],
        commentOverlays: [],
        templateId: "dark-minimal",
      },
    ), { params: Promise.resolve({ shortId: "short-caption" }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "SUBTITLE_TEMPLATE_EDIT_UNSUPPORTED",
    });
    expect(db).toHaveBeenCalledOnce();
  });

  it("persists a valid timed comment overlay for the comment template", async () => {
    const db = dbWithRows(
      [{ id: "short-a", subtitleSegments: [], durationSeconds: "30" }],
      [{ id: "short-a", renderVersion: 1 }],
    );
    mocks.getDb.mockReturnValue(db);
    const response = await patchShort(jsonRequest("http://localhost/api/shorts/short-a", {
      hookTitle: "유효한 제목",
      channelDisplayName: "기존 채널",
      subtitlesEnabled: false,
      subtitleSegments: [],
      commentOverlays: [{
        id: "6bce83c4-b12e-4d11-8f16-2fef8a96c541",
        startSeconds: 0,
        endSeconds: 10,
        text: "댓글 테스트입니다",
        initial: "소",
        avatarColor: "#8B2CC4",
        nickname: "소담기록24",
        likeCount: 10,
        ageLabel: "5개월 전",
      }],
      templateId: "comment-capture",
      titleFontScale: 1,
    }), { params: Promise.resolve({ shortId: "short-a" }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ saved: true });
    expect(db).toHaveBeenCalledTimes(2);
  });

  it("drops hidden malformed comments when saving a non-comment template", async () => {
    const db = dbWithRows(
      [{ id: "short-a", subtitleSegments: [], durationSeconds: "30", templateId: "comment-capture" }],
      [{ id: "short-a", renderVersion: 1 }],
    );
    mocks.getDb.mockReturnValue(db);
    const response = await patchShort(jsonRequest("http://localhost/api/shorts/short-a", {
      hookTitle: "유효한 제목",
      channelDisplayName: "기존 채널",
      subtitlesEnabled: false,
      subtitleSegments: [],
      commentOverlays: [{ id: "legacy-comment", text: "" }],
      templateId: "paper",
      titleFontScale: 1,
    }), { params: Promise.resolve({ shortId: "short-a" }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ saved: true });
    expect(db).toHaveBeenCalledTimes(2);
  });

  it("persists non-overlapping title text color ranges", async () => {
    const db = dbWithRows(
      [{ id: "short-a", subtitleSegments: [], durationSeconds: "30" }],
      [{ id: "short-a", renderVersion: 1 }],
    );
    mocks.getDb.mockReturnValue(db);
    const response = await patchShort(jsonRequest("http://localhost/api/shorts/short-a", {
      hookTitle: "선택 색상 테스트",
      channelDisplayName: "기존 채널",
      subtitlesEnabled: false,
      subtitleSegments: [],
      templateId: "dark-red",
      titleFontScale: 1,
      titleTextStyles: [
        { start: 0, end: 2, color: "#00FF00", backgroundColor: "#123456" },
        { start: 3, end: 5, color: "#FFCC00" },
      ],
    }), { params: Promise.resolve({ shortId: "short-a" }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ saved: true });
    expect(db).toHaveBeenCalledTimes(2);
  });

  it("rejects overlapping title text color ranges", async () => {
    const db = dbWithRows([{ id: "short-a", subtitleSegments: [], durationSeconds: "30" }]);
    mocks.getDb.mockReturnValue(db);
    const response = await patchShort(jsonRequest("http://localhost/api/shorts/short-a", {
      hookTitle: "선택 색상 테스트",
      channelDisplayName: "기존 채널",
      subtitlesEnabled: false,
      subtitleSegments: [],
      templateId: "dark-red",
      titleTextStyles: [
        { start: 0, end: 4, color: "#00FF00" },
        { start: 3, end: 5, backgroundColor: "#123456" },
      ],
    }), { params: Promise.resolve({ shortId: "short-a" }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ detail: expect.stringContaining("겹치지 않게") });
    expect(db).toHaveBeenCalledOnce();
  });

  it("rejects overlapping comment ranges", async () => {
    const db = dbWithRows([{ id: "short-a", subtitleSegments: [], durationSeconds: "30" }]);
    mocks.getDb.mockReturnValue(db);
    const baseComment = {
      text: "댓글 테스트입니다", initial: "소", avatarColor: "#8B2CC4",
      nickname: "소담기록24", likeCount: 1_312, ageLabel: "5개월 전",
    };
    const response = await patchShort(jsonRequest("http://localhost/api/shorts/short-a", {
      hookTitle: "유효한 제목",
      channelDisplayName: "기존 채널",
      subtitlesEnabled: false,
      subtitleSegments: [],
      commentOverlays: [
        { ...baseComment, id: "6bce83c4-b12e-4d11-8f16-2fef8a96c541", startSeconds: 0, endSeconds: 12 },
        { ...baseComment, id: "a74f8b4a-6044-4aa2-b71f-78776ba98a4b", startSeconds: 10, endSeconds: 20 },
      ],
      templateId: "comment-capture",
      titleFontScale: 1,
    }), { params: Promise.resolve({ shortId: "short-a" }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ detail: expect.stringContaining("겹치지 않게") });
    expect(db).toHaveBeenCalledOnce();
  });

  it("rejects rerendering a short not owned by the session", async () => {
    mocks.getDb.mockReturnValue(dbWithRows([]));
    const response = await rerenderShort(
      new Request("http://localhost/api/shorts/short-b/rerender", { method: "POST" }),
      { params: Promise.resolve({ shortId: "short-b" }) },
    );
    expect(response.status).toBe(404);
    expect(mocks.submitRerender).not.toHaveBeenCalled();
  });

  it("rejects legacy rerendering for a subtitle-template output", async () => {
    const db = dbWithRows([{
      id: "short-caption",
      status: "ready",
      subtitleTemplateId: "pop",
    }]);
    const begin = vi.fn();
    Object.assign(db, { begin });
    mocks.getDb.mockReturnValue(db);

    const response = await rerenderShort(
      new Request("http://localhost/api/shorts/short-caption/rerender", { method: "POST" }),
      { params: Promise.resolve({ shortId: "short-caption" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "SUBTITLE_TEMPLATE_EDIT_UNSUPPORTED",
    });
    expect(begin).not.toHaveBeenCalled();
  });

  it("queues rerendering in the database without calling Batch from Vercel", async () => {
    const db = dbWithRows([{
      id: "short-a",
      status: "ready",
      renderedConfigHash: "old-hash",
      currentConfigHash: "new-hash",
    }]);
    const tx = dbWithRows([{ id: "short-a" }], []);
    const begin = vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx));
    Object.assign(db, {
      begin,
    });
    mocks.getDb.mockReturnValue(db);

    const response = await rerenderShort(
      new Request("http://localhost/api/shorts/short-a/rerender", { method: "POST" }),
      { params: Promise.resolve({ shortId: "short-a" }) },
    );

    expect(response.status).toBe(202);
    expect(begin).toHaveBeenCalledOnce();
    expect(tx).toHaveBeenCalledTimes(2);
    expect(mocks.submitRerender).not.toHaveBeenCalled();
  });

  it("blocks repeated compute-heavy rerenders for a free welcome project", async () => {
    const db = dbWithRows([{
      id: "short-free",
      status: "ready",
      renderVersion: 2,
      onboardingWelcomeFunded: true,
      renderedConfigHash: "old-hash",
      currentConfigHash: "new-hash",
    }]);
    mocks.getDb.mockReturnValue(db);

    const response = await rerenderShort(
      new Request("http://localhost/api/shorts/short-free/rerender", { method: "POST" }),
      { params: Promise.resolve({ shortId: "short-free" }) },
    );

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({
      code: "ONBOARDING_WELCOME_RERENDER_LIMIT",
    });
    expect(db).toHaveBeenCalledTimes(1);
  });

  it("does not issue a Signed URL for missing or expired shorts", async () => {
    mocks.getDb.mockReturnValue(dbWithRows([]));
    const response = await accessShort(
      new Request("http://localhost/api/shorts/short-expired/access"),
      { params: Promise.resolve({ shortId: "short-expired" }) },
    );
    expect(response.status).toBe(404);
  });

  it("returns signed playback and poster URLs for a completed short", async () => {
    process.env.CLOUDFRONT_DOMAIN = "cdn.example.com";
    process.env.CLOUDFRONT_KEY_PAIR_ID = "key-pair";
    process.env.CLOUDFRONT_PRIVATE_KEY_B64 = Buffer.from("private-key").toString("base64");
    mocks.getDb.mockReturnValue(dbWithRows([{
      outputS3Key: "outputs/session-a/job-a/short-a/v2.mp4",
      thumbnailS3Key: "thumbnails/session-a/job-a/short-a/v2.jpg",
      expiresAt: null,
      renderVersion: 2,
    }]));
    mocks.signedUrl.mockImplementation(({ url }: { url: string }) => `${url}?signed=1`);

    const response = await accessShort(
      new Request("http://localhost/api/shorts/short-a/access"),
      { params: Promise.resolve({ shortId: "short-a" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      url: "https://cdn.example.com/outputs/session-a/job-a/short-a/v2.mp4?signed=1",
      posterUrl: "https://cdn.example.com/thumbnails/session-a/job-a/short-a/v2.jpg?signed=1",
      renderVersion: 2,
    });
    expect(mocks.signedUrl).toHaveBeenCalledTimes(2);
  });

  it("does not expose another session's clean edit source", async () => {
    mocks.getDb.mockReturnValue(dbWithRows([]));
    const response = await accessEditSource(
      new Request("http://localhost/api/shorts/short-b/edit-source"),
      { params: Promise.resolve({ shortId: "short-b" }) },
    );
    expect(response.status).toBe(404);
  });
});

describe("custom-template plan access", () => {
  it("lets a Plus subscriber save a personal template", async () => {
    const config = createDefaultTemplateConfig("dark-minimal");
    const tx = dbWithRows(
      [],
      [{ count: 0 }],
      [{
        id: "14f19366-89b7-4c54-8ec6-c0f2b75584c1",
        name: "플러스 템플릿",
        baseTemplateId: "dark-minimal",
        config,
        version: 1,
        createdAt: "2026-07-20T00:00:00.000Z",
        updatedAt: "2026-07-20T00:00:00.000Z",
      }],
    );
    const db = dbWithRows();
    Object.assign(db, { begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)) });
    mocks.getDb.mockReturnValue(db);

    const response = await createPersonalTemplate(jsonRequest("http://localhost/api/templates", {
      name: "플러스 템플릿",
      baseTemplateId: "dark-minimal",
      config,
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      template: { name: "플러스 템플릿", config: { schemaVersion: 4 } },
    });
  });
});
