import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  getDb: vi.fn(),
  usage: vi.fn(),
  recentJobs: vi.fn(),
  analyze: vi.fn(),
  submitInitial: vi.fn(),
  submitRerender: vi.fn(),
  deleteObjects: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireMvpSession: mocks.session }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/usage")>()),
  getUsageSnapshot: mocks.usage,
}));
vi.mock("@/lib/data", () => ({
  getRecentJobs: mocks.recentJobs,
  getPlans: vi.fn(),
}));
vi.mock("@/lib/youtube", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/youtube")>()),
  analyzeYoutubeUrl: mocks.analyze,
}));
vi.mock("@/lib/aws", () => ({
  submitInitialJob: mocks.submitInitial,
  submitRerender: mocks.submitRerender,
  deleteShortObjects: mocks.deleteObjects,
}));

import { GET as getJob } from "./jobs/[jobId]/route";
import { POST as createJob } from "./jobs/route";
import { POST as selectPlan } from "./mvp/plan/route";
import { GET as accessShort } from "./shorts/[shortId]/access/route";
import { POST as rerenderShort } from "./shorts/[shortId]/rerender/route";
import { PATCH as patchShort } from "./shorts/[shortId]/route";

const usage = {
  usedSeconds: 60,
  reservedSeconds: 0,
  limitSeconds: 6000,
  remainingSeconds: 5940,
  periodStart: "2026-06-30T15:00:00.000Z",
  nextResetAt: "2026-07-31T15:00:00.000Z",
  enforcementEnabled: false,
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ id: "session-a", selectedPlanCode: "plus" });
  mocks.usage.mockResolvedValue(usage);
});

describe("job API security and idempotency", () => {
  it("rejects creation when rights confirmation is missing", async () => {
    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
      templateId: "dark-red",
      clipLengthOption: "sec_30",
      rightsConfirmed: false,
      requestId: "4a2ea3f0-49a9-4b2f-98ff-134d392511d0",
    }));
    expect(response.status).toBe(400);
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("returns an existing request without a second Batch submission", async () => {
    mocks.getDb.mockReturnValue(dbWithRows([{ id: "job-existing", status: "queued" }]));
    const response = await createJob(jsonRequest("http://localhost/api/jobs", {
      youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
      templateId: "dark-red",
      clipLengthOption: "sec_31_60",
      rightsConfirmed: true,
      requestId: "4a2ea3f0-49a9-4b2f-98ff-134d392511d0",
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jobId: "job-existing",
      status: "queued",
      usage,
    });
    expect(mocks.submitInitial).not.toHaveBeenCalled();
  });

  it("does not expose another session's job", async () => {
    mocks.recentJobs.mockResolvedValue([]);
    const response = await getJob(
      new Request("http://localhost/api/jobs/job-b"),
      { params: Promise.resolve({ jobId: "job-b" }) },
    );
    expect(response.status).toBe(404);
    expect(mocks.recentJobs).toHaveBeenCalledWith(expect.anything(), "session-a", "job-b");
  });
});

describe("plan API", () => {
  it("changes only the MVP session plan and preserves the usage snapshot", async () => {
    mocks.getDb.mockReturnValue(dbWithRows([]));
    const response = await selectPlan(jsonRequest("http://localhost/api/mvp/plan", {
      planCode: "pro",
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ selectedPlanCode: "pro", usage });
    expect(mocks.usage).toHaveBeenCalledWith(expect.anything(), "session-a");
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

  it("rejects rerendering a short not owned by the session", async () => {
    mocks.getDb.mockReturnValue(dbWithRows([]));
    const response = await rerenderShort(
      new Request("http://localhost/api/shorts/short-b/rerender", { method: "POST" }),
      { params: Promise.resolve({ shortId: "short-b" }) },
    );
    expect(response.status).toBe(404);
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
});
