import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/session", () => ({
  requireAuthenticatedMvpSession: mocks.session,
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({
    id: "session-id",
    userId: "user-id",
  });
});

describe("project result viewed API", () => {
  it("marks an owned completed project as viewed", async () => {
    const db = vi.fn().mockResolvedValue([{
      resultViewedAt: new Date("2026-07-30T00:00:00.000Z"),
    }]);
    mocks.getDb.mockReturnValue(db);

    const response = await POST(
      new Request("http://localhost/api/projects/17/viewed", { method: "POST" }),
      { params: Promise.resolve({ projectNumber: "17" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ viewed: true });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(String(db.mock.calls[0][0])).toContain(
      "result_viewed_at=coalesce(result_viewed_at,clock_timestamp())",
    );
    expect(String(db.mock.calls[0][0])).toContain("and not is_example");
    expect(String(db.mock.calls[0][0])).toContain("and status='completed'");
  });

  it("does not mark a missing, incomplete, or unowned project", async () => {
    mocks.getDb.mockReturnValue(vi.fn().mockResolvedValue([]));

    const response = await POST(
      new Request("http://localhost/api/projects/17/viewed", { method: "POST" }),
      { params: Promise.resolve({ projectNumber: "17" }) },
    );

    expect(response.status).toBe(404);
  });

  it("rejects an invalid project number before accessing the session", async () => {
    const response = await POST(
      new Request("http://localhost/api/projects/not-a-number/viewed", { method: "POST" }),
      { params: Promise.resolve({ projectNumber: "not-a-number" }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
