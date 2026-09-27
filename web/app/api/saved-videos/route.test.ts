import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";
const mocks = vi.hoisted(() => ({ session: vi.fn(), list: vi.fn(), save: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireAuthenticatedMvpSession: mocks.session }));
vi.mock("@/lib/saved-videos-server", () => ({ listSavedVideos: mocks.list, saveVideo: mocks.save, removeSavedVideo: mocks.remove }));
import { GET, POST, DELETE } from "./route";
const id = "a".repeat(64);
const request = (method: string, body: unknown, origin = "https://www.easycut.co.kr") => new Request("https://www.easycut.co.kr/api/saved-videos", { method, headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ userId: "member-a" }); mocks.list.mockResolvedValue([]); mocks.save.mockResolvedValue({ id }); });
describe("saved videos account boundary", () => {
  it("returns a private, uncached member list", async () => {
    const result = await GET();
    expect(await result.json()).toEqual({ items: [] });
    expect(mocks.list).toHaveBeenCalledWith("member-a");
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it.each(["GET", "POST", "DELETE"])("rejects anonymous %s before database access", async method => {
    mocks.session.mockRejectedValue(new HttpError(401,"로그인이 필요합니다."));
    const result = method === "GET" ? await GET() : method === "POST" ? await POST(request(method,{videoId:"abcdefghijk"})) : await DELETE(request(method,{id}));
    expect(result.status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("saves only the ID against the authenticated account", async () => {
    expect((await POST(request("POST",{videoId:"abcdefghijk"}))).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith("member-a","abcdefghijk");
  });
  it("cannot choose another user's account or inject metadata", async () => {
    expect((await POST(request("POST",{videoId:"abcdefghijk",userId:"member-b",title:"fake"}))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("scopes removal to the authenticated member", async () => {
    expect((await DELETE(request("DELETE",{id}))).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith("member-a",id);
  });
  it.each(["POST","DELETE"])("rejects cross-origin %s", async method => {
    const result = await (method === "POST" ? POST(request(method,{videoId:"abcdefghijk"},"https://other.example")) : DELETE(request(method,{id},"https://other.example")));
    expect(result.status).toBe(403); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it.each(["abc", "https://www.youtube.com/watch?v=abcdefghijk", "../anything"])("rejects malformed video ID %s",async videoId => {
    expect((await POST(request("POST",{videoId}))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("preserves actionable capacity and unavailable errors", async () => {
    mocks.save.mockRejectedValue(new HttpError(409,"full","SAVED_VIDEO_LIMIT"));
    const result=await POST(request("POST",{videoId:"abcdefghijk"}));
    expect(result.status).toBe(409);expect(await result.json()).toMatchObject({code:"SAVED_VIDEO_LIMIT"});
  });
});
