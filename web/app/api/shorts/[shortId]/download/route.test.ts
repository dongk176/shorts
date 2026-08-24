import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  getDb: vi.fn(),
  billing: vi.fn(),
  downloadUrl: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireAuthenticatedMvpSession: mocks.session }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/billing", () => ({ getBillingSummary: mocks.billing }));
vi.mock("@/lib/aws", () => ({ getShortDownloadUrl: mocks.downloadUrl }));

import { GET } from "./route";

describe("short download route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({
      id: "session-a",
      userId: "user-a",
    });
    mocks.billing.mockResolvedValue({
      activeProducts: [{ planCode: "plus" }],
    });
    mocks.downloadUrl.mockResolvedValue(
      "https://cdn.example.com/outputs/short.mp4?download=1&signature=test",
    );
  });

  it("redirects an owned ready output to a fresh attachment URL", async () => {
    const db = vi.fn().mockResolvedValue([{
      outputS3Key: "outputs/session/job/short/v1.mp4",
      expiresAt: new Date(Date.now() + 60_000),
      hookTitle: "핵심 장면",
    }]);
    mocks.getDb.mockReturnValue(db);

    const response = await GET(
      new Request("http://localhost/api/shorts/short-a/download"),
      { params: Promise.resolve({ shortId: "short-a" }) },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("cdn.example.com");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.downloadUrl).toHaveBeenCalledWith(
      "outputs/session/job/short/v1.mp4",
      "핵심 장면.mp4",
      expect.any(Number),
    );
    expect(String(db.mock.calls[0][0])).toContain("j.is_example=false");
    expect(String(db.mock.calls[0][0])).toContain("s.status='ready'");
  });

  it("does not sign a missing or unauthorized output", async () => {
    mocks.getDb.mockReturnValue(vi.fn().mockResolvedValue([]));

    const response = await GET(
      new Request("http://localhost/api/shorts/missing/download"),
      { params: Promise.resolve({ shortId: "missing" }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.downloadUrl).not.toHaveBeenCalled();
  });
});
