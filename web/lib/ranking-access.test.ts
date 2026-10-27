import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./supabase/server", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("./db", () => ({ getDb: vi.fn() }));
import { getAuthenticatedUser } from "./supabase/server";
import { getDb } from "./db";
import { HttpError } from "./http";
import {
  requireRankingUser,
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
  vi.mocked(getDb).mockReturnValue(vi.fn().mockResolvedValue([user]) as unknown as ReturnType<typeof getDb>);
});
describe("authenticated ranking beta boundaries", () => {
  it("keeps the whole feature closed when the release gate is off", async () => {
    vi.stubEnv("RANKING_SHORTS_ENABLED", "0");
    await expect(requireRankingUser()).rejects.toMatchObject({ status: 404 });
    expect(getAuthenticatedUser).not.toHaveBeenCalled();
  });
  it.each([401, 403])(
    "denies unauthenticated or invalid accounts (%i)",
    async (status) => {
      vi.mocked(getAuthenticatedUser).mockRejectedValue(
        new HttpError(status, "denied"),
      );
      await expect(requireRankingUser()).rejects.toMatchObject({ status });
    },
  );
  it("rejects cross-site and missing-origin writes even for an administrator", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({id:"auth",email:user.email} as Awaited<ReturnType<typeof getAuthenticatedUser>>);
    for (const headers of [
      {},
      { origin: "https://attacker.example" },
      { origin: "https://www.easycut.co.kr", "sec-fetch-site": "cross-site" },
    ] as Record<string, string>[])
      await expect(
        requireRankingUser(
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

it("allows an ordinary authenticated account without granting administrative powers",async()=>{
 vi.mocked(getAuthenticatedUser).mockResolvedValue({id:"auth",email:user.email} as Awaited<ReturnType<typeof getAuthenticatedUser>>);
 expect(await requireRankingUser()).toMatchObject({id:user.id,authUserId:"auth"});
 const query=vi.mocked(getDb).mock.results[0].value;
 expect(query.mock.calls[0][0].join("?")).not.toContain("is_admin");
});
it("rejects Supabase anonymous sessions",async()=>{
 vi.mocked(getAuthenticatedUser).mockResolvedValue({id:"auth",is_anonymous:true} as Awaited<ReturnType<typeof getAuthenticatedUser>>);
 await expect(requireRankingUser()).rejects.toMatchObject({status:401});
 expect(getDb).not.toHaveBeenCalled();
});
it("rejects a valid login without a linked application account",async()=>{
 vi.mocked(getAuthenticatedUser).mockResolvedValue({id:"auth"} as Awaited<ReturnType<typeof getAuthenticatedUser>>);
 vi.mocked(getDb).mockReturnValue(vi.fn().mockResolvedValue([]) as unknown as ReturnType<typeof getDb>);
 await expect(requireRankingUser()).rejects.toMatchObject({status:403});
});
