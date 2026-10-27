import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ admin: vi.fn(), owner: vi.fn(), query: vi.fn(), begin: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ begin: state.begin }) }));
vi.mock("@/lib/ranking-access", async (original) => ({ ...await original<typeof import("@/lib/ranking-access")>(), requireRankingUser: state.admin, requireRankingProject: state.owner }));
import { HttpError } from "@/lib/http";
import { DELETE } from "./route";
const request = () => new Request("https://www.easycut.co.kr/api/ranking-shorts/project", { method: "DELETE" });
const params = { params: Promise.resolve({ projectId: "project" }) };
beforeEach(() => {
  vi.resetAllMocks();
  state.admin.mockResolvedValue({ id: "owner" });
  state.owner.mockResolvedValue({ id: "project" });
  state.begin.mockImplementation((fn) => fn(state.query));
  state.query.mockResolvedValue([]);
});
describe("ranking card deletion boundary", () => {
  it("rejects non-admin access without starting a transaction", async () => {
    state.admin.mockRejectedValue(new HttpError(403, "관리자 권한이 필요합니다."));
    expect((await DELETE(request(), params)).status).toBe(403);
    expect(state.begin).not.toHaveBeenCalled();
  });
  it("rejects another owner's project without touching it", async () => {
    state.owner.mockRejectedValue(new HttpError(404, "작업을 찾을 수 없습니다."));
    expect((await DELETE(request(), params)).status).toBe(404);
    expect(state.begin).not.toHaveBeenCalled();
  });
  it("rechecks active work inside the transaction before removing a project", async () => {
    state.query.mockResolvedValueOnce([{ id: "project" }]).mockResolvedValueOnce([{ id: "running" }]);
    expect((await DELETE(request(), params)).status).toBe(409);
    expect(state.query).toHaveBeenCalledTimes(2);
  });
  it("removes an owned inactive project through the existing soft-delete path", async () => {
    const response = await DELETE(request(), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(state.owner).toHaveBeenCalledWith("project", "owner");
    expect(state.query).toHaveBeenCalledTimes(3);
  });
});
