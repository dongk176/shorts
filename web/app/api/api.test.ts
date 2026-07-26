import { beforeEach, describe, expect, it, vi } from "vitest";

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
  delete process.env.RANGE_EDITING_ENABLED;
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
  mocks.billing.mockResolvedValue({
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

  it("requires an owned, non-example, unexpired project with a timeline", async () => {
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
    expect(query).toContain("s.edit_timeline_s3_key is not null");
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

  it("ignores legacy range fields and creates a full-source job", async () => {
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

    expect(response.status).toBe(202);
    expect(mocks.wakeDispatcher).toHaveBeenCalledOnce();
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
});

describe("plan API", () => {
  it("rejects direct plan mutations", async () => {
    const response = await selectPlan();
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ detail: expect.stringContaining("결제 승인") });
  });
});

describe("short ownership, expiry, and edit validation", () => {
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

  it("does not issue a Signed URL for missing or expired shorts", async () => {
    mocks.getDb.mockReturnValue(dbWithRows([]));
    const response = await accessShort(
      new Request("http://localhost/api/shorts/short-expired/access"),
      { params: Promise.resolve({ shortId: "short-expired" }) },
    );
    expect(response.status).toBe(404);
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
