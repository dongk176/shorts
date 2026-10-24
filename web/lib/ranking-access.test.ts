import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./admin", () => ({ requireAdminUser: vi.fn() }));
vi.mock("./db", () => ({ getDb: vi.fn() }));
import { requireAdminUser } from "./admin";
import { getDb } from "./db";
import { HttpError } from "./http";
import {
  requireRankingAdmin,
  requireRankingOrigin,
  requireRankingProject,
  rankingBody,
} from "./ranking-access";
const user = {
  id: "c5f6c25f-1669-47ad-9892-37d712dca9f2",
  authUserId: "auth",
  email: "admin@example.test",
  displayName: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("RANKING_SHORTS_ENABLED", "1");
});
describe("administrator ranking boundaries", () => {
  it("keeps the whole feature closed when the release gate is off", async () => {
    vi.stubEnv("RANKING_SHORTS_ENABLED", "0");
    await expect(requireRankingAdmin()).rejects.toMatchObject({ status: 404 });
    expect(requireAdminUser).not.toHaveBeenCalled();
  });
  it.each([401, 403])(
    "denies guests and non-administrators (%i)",
    async (status) => {
      vi.mocked(requireAdminUser).mockRejectedValue(
        new HttpError(status, "denied"),
      );
      await expect(requireRankingAdmin()).rejects.toMatchObject({ status });
    },
  );
  it("rejects cross-site and missing-origin writes even for an administrator", async () => {
    vi.mocked(requireAdminUser).mockResolvedValue(user);
    for (const headers of [
      {},
      { origin: "https://attacker.example" },
      { origin: "https://www.easycut.co.kr", "sec-fetch-site": "cross-site" },
    ] as Record<string, string>[])
      await expect(
        requireRankingAdmin(
          new Request("https://www.easycut.co.kr/api/ranking-shorts", {
            method: "POST",
            headers,
          }),
        ),
      ).rejects.toMatchObject({ status: 403 });
  });
  it("accepts same-origin writes and read-only media requests", () => {
    expect(() =>
      requireRankingOrigin(
        new Request("https://www.easycut.co.kr/api/ranking-shorts", {
          method: "POST",
          headers: { origin: "https://www.easycut.co.kr" },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      requireRankingOrigin(
        new Request("https://www.easycut.co.kr/api/ranking-shorts"),
      ),
    ).not.toThrow();
  });
  it("applies ownership and expiry filtering before returning a project", async () => {
    const query = vi.fn().mockResolvedValue([]);
    vi.mocked(getDb).mockReturnValue(
      query as unknown as ReturnType<typeof getDb>,
    );
    await expect(
      requireRankingProject(user.id, "another-owner"),
    ).rejects.toMatchObject({ status: 404 });
    expect(query.mock.calls[0].slice(1)).toEqual([user.id, "another-owner"]);
  });
  it("rejects oversized JSON input", async () => {
    const req = new Request("https://www.easycut.co.kr/api/ranking-shorts", {
      method: "POST",
      body: JSON.stringify({ title: "x".repeat(40000) }),
    });
    await expect(rankingBody(req)).rejects.toMatchObject({ status: 413 });
  });
});
