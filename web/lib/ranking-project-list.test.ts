import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./db", () => ({ getDb: () => state.query }));
import { loadRankingProjectList } from "./ranking-project-list";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("ranking projects on the ordinary project page", () => {
  it("never queries ranking data for signed-out users or when disabled", async () => {
    vi.stubEnv("RANKING_SHORTS_ENABLED", "0");
    expect(await loadRankingProjectList("auth-user")).toEqual([]);
    vi.stubEnv("RANKING_SHORTS_ENABLED", "1");
    expect(await loadRankingProjectList(null)).toEqual([]);
    expect(state.query).not.toHaveBeenCalled();
  });
  it("binds the authenticated identity and filters current admin ownership, deletion and expiry", async () => {
    vi.stubEnv("RANKING_SHORTS_ENABLED", "1");
    state.query.mockResolvedValue([]);
    expect(await loadRankingProjectList("authenticated-owner")).toEqual([]);
    const [strings, identity] = state.query.mock.calls[0];
    const sql = strings.join("?");
    expect(identity).toBe("authenticated-owner");
    expect(sql).toContain("p.user_id=u.id");
    expect(sql).toContain("u.auth_user_id=? and u.is_admin=true");
    expect(sql).toContain("p.deleted_at is null and p.expires_at>now()");
    expect(sql).toContain("project_id=p.id and action='render'");
    expect(sql).toContain("order by created_at desc,id desc limit 1");
    expect(sql).toContain("limit 20");
  });
  it("serializes only card metadata and exposes duration only from the latest successful render", async () => {
    vi.stubEnv("RANKING_SHORTS_ENABLED", "1");
    state.query.mockResolvedValue([{ id: "project", title: "완성 영상", createdAt: new Date("2026-10-24T00:00:00Z"), status: "succeeded", operationId: "render", duration: "3.021333", ignoredSecret: "not returned" }]);
    expect(await loadRankingProjectList("owner")).toEqual([{ id: "project", title: "완성 영상", createdAt: "2026-10-24T00:00:00.000Z", status: "succeeded", operationId: "render", duration: 3.021333 }]);
  });
});
