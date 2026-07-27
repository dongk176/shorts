import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/session", () => ({
  requireAuthenticatedMvpSession: mocks.session,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({
    id: "session-a",
    userId: "user-a",
    user: { id: "auth-a", email: "owner@example.com" },
  });
});

describe("refundable order list", () => {
  it("returns only the authenticated customer's query result", async () => {
    const rows = [{
      id: "1e9b85a4-5fc6-4910-801d-ad137ce54b8c",
      orderId: "EC-PMU-ORDER",
      orderName: "STARTER 6개월",
      amountKrw: 119_400,
      remainingRefundableAmountKrw: 119_400,
      hasOpenRefundInquiry: false,
    }];
    const db = vi.fn().mockResolvedValue(rows);
    mocks.getDb.mockReturnValue(db);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ items: rows });
    expect(db.mock.calls[0]?.slice(1)).toContain("user-a");
  });

  it("requires authentication", async () => {
    mocks.session.mockRejectedValue(new HttpError(401, "로그인이 필요합니다."));

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
