import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./runtime", () => ({ accountContext: vi.fn() }));
import { accountContext } from "./runtime";
import { connectionsGet, connectionDelete, eligibilityPost, oauthStart, oauthCallback, uploadsGet, uploadsPost, uploadResume } from "./handlers";
import { HttpError } from "@/lib/http";

const actor = { userId: "11111111-1111-4111-8111-111111111111", sessionId: "authenticated-server-session" };
const origin = "http://localhost:3001";
const uploads = { attribution: vi.fn(async()=>null), cleanup: vi.fn(), capabilities: vi.fn(()=>({nonPrivateUploads:false})), list: vi.fn(), create: vi.fn(), run: vi.fn() };
const service = { list: vi.fn(), start: vi.fn(), disconnect: vi.fn(), disconnectStatus: vi.fn(), disconnectState: vi.fn(), callback: vi.fn(), eligibility: vi.fn() };
const request = (path: string, method = "GET", body?: unknown, from = origin) => new Request(origin + path, { method, headers: method === "GET" ? {} : { origin: from, "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
beforeEach(() => {
  vi.resetAllMocks();
  uploads.capabilities.mockReturnValue({nonPrivateUploads:false});
  vi.mocked(accountContext).mockResolvedValue({ service, uploads, actor, origin } as never);
  service.list.mockResolvedValue([]); service.start.mockResolvedValue("https://accounts.google.com/o/oauth2/v2/auth");
  service.disconnect.mockResolvedValue({deleted:true,revocation:"revoked"});
  service.disconnectStatus.mockResolvedValue("none");
  service.disconnectState.mockResolvedValue({status:"none",retryAfterSeconds:0});
  service.callback.mockResolvedValue({ returnPath: "/projects/1", outcome: "connected" });
});
describe("connection API authentication boundary", () => {
  it("exposes a reconnect countdown after deletion and reload without treating successful revocation as pending", async () => {
    service.disconnectState.mockResolvedValue({status:"revoked",retryAfterSeconds:58});
    const deleted = await connectionDelete(request("/api/youtube/accounts/id", "DELETE", {confirmAllConnections:true}), {params:Promise.resolve({connectionId:"id"})});
    expect(await deleted.json()).toEqual({deleted:true,revocation:"revoked",reconnectAfterSeconds:58});
    const reloaded = await connectionsGet(request("/api/youtube/accounts"));
    expect(await reloaded.json()).toEqual({connections:[],disconnectStatus:"revoked",reconnectAfterSeconds:58});
  });
  it("returns a structured cooldown and remaining delay when another tab attempts to reconnect", async () => {
    service.start.mockRejectedValue(new HttpError(409,"32초 뒤 다시 연결할 수 있습니다.","YOUTUBE_RECONNECT_COOLDOWN",32));
    const response = await oauthStart(request("/api/youtube/accounts/oauth/start","POST",{returnPath:"/settings"}));
    expect(response.status).toBe(409);expect(response.headers.get("Retry-After")).toBe("32");
    expect((await response.json()).code).toBe("YOUTUBE_RECONNECT_COOLDOWN");
  });
  it("derives owner from the authenticated server session and marks responses private", async () => {
    const response = await connectionsGet(request("/api/youtube/accounts?userId=attacker"));
    expect(response.status).toBe(200);expect(service.list).toHaveBeenCalledWith(actor, undefined);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const deleted = await connectionDelete(request("/api/youtube/accounts/id", "DELETE", {confirmAllConnections:true}), { params: Promise.resolve({ connectionId: "id" }) });
    expect(deleted.status).toBe(200);expect(service.disconnect).toHaveBeenCalledWith(actor, "id");
  });
  it("rejects anonymous access before any connection data operation", async () => {
    vi.mocked(accountContext).mockRejectedValue(new HttpError(401, "로그인이 필요합니다."));
    expect((await connectionsGet(request("/api/youtube/accounts"))).status).toBe(401);
    expect((await oauthStart(request("/api/youtube/accounts/oauth/start", "POST", { returnPath: "/settings" }))).status).toBe(401);
    expect(service.list).not.toHaveBeenCalled();expect(service.start).not.toHaveBeenCalled();
  });
  it("blocks cross-origin connect, disconnect, and eligibility requests", async () => {
    expect((await oauthStart(request("/api/youtube/accounts/oauth/start", "POST", {}, "https://evil.test"))).status).toBe(403);
    expect((await connectionDelete(request("/api/youtube/accounts/id", "DELETE", {}, "https://evil.test"), { params: Promise.resolve({ connectionId: "id" }) })).status).toBe(403);
    expect((await eligibilityPost(request("/api/youtube/accounts/eligibility", "POST", {}, "https://evil.test"))).status).toBe(403);
    expect(accountContext).not.toHaveBeenCalled();
  });
  it("callback uses configured origin, never reflects untrusted Host or provider content", async () => {
    const response = await oauthCallback(new Request(origin + "/api/youtube/accounts/oauth/callback?state=x&error=secret", { headers: { host: "evil.test" } }));
    expect(response.status).toBe(303);expect(response.headers.get("location")).toBe(origin + "/projects/1?youtubeAccount=connected");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("invalid input cannot request another owner or arbitrary upload URL", async () => {
    const r = await eligibilityPost(request("/api/youtube/accounts/eligibility", "POST", { shortId: actor.userId, connectionId: actor.userId, userId: "someone-else", videoUrl: "https://evil.test" }));
    expect(r.status).toBe(400);expect(service.eligibility).not.toHaveBeenCalled();
  });
});

it("upload and resume APIs require login and same-origin JSON before running",async()=>{
 expect((await uploadsPost(request('/api/youtube/accounts/uploads','POST',{},'https://evil.test'))).status).toBe(403);
 expect((await uploadResume(request('/api/youtube/accounts/uploads/id/resume','POST',{},'https://evil.test'),{params:Promise.resolve({uploadId:actor.userId})})).status).toBe(403);
 expect(uploads.create).not.toHaveBeenCalled();expect(uploads.run).not.toHaveBeenCalled();
 vi.mocked(accountContext).mockRejectedValue(new HttpError(401,'Login required'));
 expect((await uploadsGet(request('/api/youtube/accounts/uploads?shortId='+actor.userId))).status).toBe(401);
 expect((await uploadsPost(request('/api/youtube/accounts/uploads','POST',{}))).status).toBe(401);
});
it("upload handlers use the authenticated actor and never accept owner from query",async()=>{
 uploads.list.mockResolvedValue([]);uploads.create.mockResolvedValue({id:'created'});uploads.run.mockResolvedValue({id:'existing'});
 expect((await uploadsGet(request('/api/youtube/accounts/uploads?shortId='+actor.userId+'&userId=attacker'))).status).toBe(200);
 expect(uploads.list).toHaveBeenCalledWith(actor,actor.userId);
 const response=await uploadsPost(request('/api/youtube/accounts/uploads','POST',{title:'test'}));
 expect(response.headers.get('cache-control')).toBe('private, no-store');expect(uploads.create).toHaveBeenCalledWith(actor,{title:'test'});
 await uploadResume(request('/api/youtube/accounts/uploads/id/resume','POST',{}),{params:Promise.resolve({uploadId:actor.userId})});
 expect(uploads.run).toHaveBeenCalledWith(actor,actor.userId);
});

it("requires explicit all-connections deletion confirmation", async () => {
 const r = await connectionDelete(request("/api/youtube/accounts/id", "DELETE", {}), { params: Promise.resolve({ connectionId: "id" }) });
 expect(r.status).toBe(400); expect(service.disconnect).not.toHaveBeenCalled();
});
