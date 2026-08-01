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

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminUser.mockResolvedValue({
    id: "850a1122-2dc5-481f-9c1b-147d6e5addaa",
    email: "admin@example.com",
  });
});

describe("administrator member search API", () => {
  it("requires an authenticated administrator", async () => {
    mocks.requireAdminUser.mockRejectedValue(new HttpError(401, "로그인이 필요합니다."));

    const response = await GET(
      new Request("https://www.easycut.co.kr/api/admin/members/search?q=test"),
    );

    expect(response.status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("searches by email or display name and returns current remaining usage", async () => {
    let statement = "";
    const db = vi.fn((strings: TemplateStringsArray) => {
      statement = strings.join("?");
      return Promise.resolve([{
        id: "f0c30f0b-99a1-45a1-a9b9-e7ca4f60d087",
        email: "member@example.com",
        displayName: "테스트 회원",
        usageLimitSeconds: 7_200,
        usageConsumedSeconds: 1_800,
        usageReservedSeconds: 600,
      }]);
    });
    mocks.getDb.mockReturnValue(db);

    const response = await GET(
      new Request("https://www.easycut.co.kr/api/admin/members/search?q=%ED%85%8C%EC%8A%A4%ED%8A%B8"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results).toEqual([{
      id: "f0c30f0b-99a1-45a1-a9b9-e7ca4f60d087",
      email: "member@example.com",
      displayName: "테스트 회원",
      usageRemainingSeconds: 4_800,
    }]);
    expect(statement).toContain("coalesce(account.email,'')");
    expect(statement).toContain("coalesce(account.display_name,'')");
    expect(statement).toContain("account.withdrawn_at is null");
    expect(statement).toContain("limit 20");
  });

  it("does not query the database for fewer than two characters", async () => {
    const response = await GET(
      new Request("https://www.easycut.co.kr/api/admin/members/search?q=a"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: [] });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
