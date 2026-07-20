import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  authenticatedSession: vi.fn(),
  getDb: vi.fn(),
  usage: vi.fn(),
  recentJobs: vi.fn(),
  projectByNumber: vi.fn(),
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
import { POST as rerenderShort } from "./shorts/[shortId]/rerender/route";
import { PATCH as patchShort } from "./shorts/[shortId]/route";

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
  mocks.session.mockResolvedValue({
    id: "session-a",
    selectedPlanCode: "plus",
    userId: "user-a",
    user: { id: "auth-a", email: "owner@example.com", displayName: null, avatarUrl: null },
  });
  mocks.usage.mockResolvedValue(usage);
  mocks.publicState.mockResolvedValue({ plans: [], generatedShortCount: 4321 });
  mocks.publicExamples.mockResolvedValue([{ id: "example-job", isExample: true }]);
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
      requestId: "4a2ea3f0-49a9-4b2f-98ff-134d392511d9",
    }));
    expect(response.status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("creates a job without a per-job rights confirmation", async () => {
    mocks.getDb.mockReturnValue(dbForSuccessfulJobCreation());
    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
      analysisId,
      templateId: "dark-red",
      requestId: "4a2ea3f0-49a9-4b2f-98ff-134d392511d0",
    }));
    expect(response.status).toBe(202);
    expect(mocks.authenticatedSession).toHaveBeenCalledOnce();
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
      requestId: "4a2ea3f0-49a9-4b2f-98ff-134d392511e0",
    }));

    expect(response.status).toBe(202);
    expect(tx).toHaveBeenCalledTimes(6);
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
      requestId: "4a2ea3f0-49a9-4b2f-98ff-134d392511d4",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      detail: "이 영상은 국가별 시청이 제한된 영상입니다.",
    });
    expect(mocks.submitInitial).not.toHaveBeenCalled();
  });

  it("ignores legacy range fields and creates a full-source job", async () => {
    mocks.getDb.mockReturnValue(dbForSuccessfulJobCreation());
    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
      analysisId,
      templateId: "dark-red",
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
      videoAspectRatio: "5:4",
      requestId: "4a2ea3f0-49a9-4b2f-98ff-134d392511d4",
    }));

    expect(response.status).toBe(202);
  });

  it("rejects an unsupported video aspect ratio before touching the database", async () => {
    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      analysisId,
      templateId: "dark-red",
      videoAspectRatio: "3:2",
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
        likeCount: 1_312,
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
