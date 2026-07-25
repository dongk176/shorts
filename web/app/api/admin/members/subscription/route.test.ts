import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({
  requireAdminUser: mocks.requireAdminUser,
}));
vi.mock("@/lib/db", () => ({
  getDb: mocks.getDb,
}));

import { POST } from "./route";

function request() {
  return new Request("https://www.easycut.co.kr/api/admin/members/subscription", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://www.easycut.co.kr",
    },
    body: JSON.stringify({
      requestId: "1245836e-d0ca-4f60-8f40-ae138c703bef",
      userId: "f0c30f0b-99a1-45a1-a9b9-e7ca4f60d087",
      subscriptionId: "af0ac715-dbb0-4548-9af2-f3b79ee82c27",
      targetStatus: "active",
      reason: "결제 확인 완료",
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("administrator member subscription API authorization", () => {
  it("requires an authenticated administrator", async () => {
    mocks.requireAdminUser.mockRejectedValue(new HttpError(401, "로그인이 필요합니다."));
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("does not allow a signed-in non-administrator", async () => {
    mocks.requireAdminUser.mockRejectedValue(new HttpError(403, "관리자 권한이 필요합니다."));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
