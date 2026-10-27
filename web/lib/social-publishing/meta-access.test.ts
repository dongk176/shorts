import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ admin: false, signedIn: true, db: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/session", () => ({ requireAuthenticatedMvpSession: async () => {
  if (!state.signedIn) { const { HttpError } = await import("@/lib/http"); throw new HttpError(401, "Sign in"); }
  return { userId: "11111111-1111-4111-8111-111111111111", id: "signed-session" };
} }));
import { metaConfig } from "./meta/config";
import { canUseAdminPublishing } from "./access";
import { connectionDelete, connectionsGet, oauthCallback, oauthStart, postCheck, postsGet, postsPost, previewGet } from "./meta/handlers";
const production = {
  NODE_ENV: "production", VERCEL_ENV: "production", VERCEL_PROJECT_ID: "prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw",
  DATABASE_URL: "postgres://postgres.mvcprswvfybudtopepuj:test@aws-1-ap-northeast-2.pooler.supabase.com/postgres",
  META_PUBLISHING_MODE: "admin-review",
} as const;
beforeEach(() => {
  vi.clearAllMocks(); state.admin = false; state.signedIn = true;
  vi.stubEnv("TIKTOK_PUBLISHING_MODE", "");
  for (const [key, value] of Object.entries(production)) vi.stubEnv(key, value);
  state.db.mockImplementation(async (strings: TemplateStringsArray) => strings.join("").includes("is_admin=true") && state.admin ? [{ id: "admin" }] : []);
});
afterEach(() => vi.unstubAllEnvs());
describe("administrator publishing rollout boundary", () => {
  it("requires the exact production project, database and canonical origin", () => {
    expect(metaConfig("instagram", production).origin).toBe("https://www.easycut.co.kr");
    for (const override of [{ VERCEL_ENV: "preview" }, { VERCEL_PROJECT_ID: "lab" }, { DATABASE_URL: "postgres://test@localhost/db" }]) {
      expect(() => metaConfig("instagram", { ...production, ...override })).toThrow();
    }
  });
  it("does not expose UI availability with the rollout off and rechecks the database role", async () => {
    vi.stubEnv("META_PUBLISHING_MODE", ""); state.admin = true;
    expect(await canUseAdminPublishing(state.db as never, "admin")).toBe(false);
    expect(state.db).not.toHaveBeenCalled();
    vi.stubEnv("META_PUBLISHING_MODE", "admin-review");
    expect(await canUseAdminPublishing(state.db as never, "admin")).toBe(true);
    state.admin = false;
    expect(await canUseAdminPublishing(state.db as never, "admin")).toBe(false);
  });
  it("rejects ordinary accounts at every authenticated endpoint before reading publishing tables", async () => {
    const req = new Request("https://www.easycut.co.kr/api/social/instagram", { method: "POST", headers: { Origin: "https://www.easycut.co.kr", "Content-Type": "application/json" }, body: "{}" });
    const calls = [() => connectionsGet(req, {params:Promise.resolve({platform:"instagram"})}), () => oauthStart(req, {params:Promise.resolve({platform:"instagram"})}), () => oauthCallback(req, {params:Promise.resolve({platform:"instagram"})}), () => postsGet(req, {params:Promise.resolve({platform:"instagram"})}), () => postsPost(req, {params:Promise.resolve({platform:"instagram"})}),
      () => connectionDelete(req, { params: Promise.resolve({ platform:"instagram", connectionId: "arbitrary" }) }),
      () => postCheck(req, { params: Promise.resolve({ platform:"instagram", postId: "arbitrary" }) }),
      () => previewGet(req, { params: Promise.resolve({ platform:"instagram", shortId: "arbitrary" }) })];
    for (const call of calls) { const res = await call(); expect(res.status).toBe(403); expect(await res.json()).toEqual({ code: "META_DISABLED" }); }
    expect(state.db.mock.calls.every(([strings]) => strings.join("").includes("is_admin=true"))).toBe(true);
  });
  it("requires authentication even if a caller knows a project or connection ID", async () => {
    state.signedIn = false;
    expect((await connectionsGet(new Request("https://www.easycut.co.kr/api/social/instagram"),{params:Promise.resolve({platform:"instagram"})})).status).toBe(401);
    expect(state.db).not.toHaveBeenCalled();
  });
});


describe("Instagram approval gates", () => {
  const publicEnv = {...production, INSTAGRAM_APP_ID:"1116489420856814", INSTAGRAM_PUBLISHING_MODE:"public", INSTAGRAM_APP_REVIEW_APPROVED:"true"};
  it("requires the approved Instagram client and production identities", () => {
    expect(metaConfig("instagram",publicEnv).publicEnabled).toBe(true);
    expect(metaConfig("threads",publicEnv).publicEnabled).toBe(false);
    for(const override of [{INSTAGRAM_APP_ID:"123"},{INSTAGRAM_APP_REVIEW_APPROVED:""},{META_PUBLISHING_MODE:""},{VERCEL_ENV:"preview"},{VERCEL_PROJECT_ID:"lab"},{DATABASE_URL:"postgres://local@localhost/db"}]) {
      expect(()=>metaConfig("instagram",{...publicEnv,...override})).toThrow();
    }
    expect(metaConfig("instagram",{...publicEnv,INSTAGRAM_PUBLISHING_MODE:""}).publicEnabled).toBe(false);
  });
  it("keeps all Threads endpoints private with Instagram public flags",async()=>{
    for(const [key,value] of Object.entries(publicEnv)) vi.stubEnv(key,value);
    const req=new Request("https://www.easycut.co.kr/api/social/threads");
    expect((await connectionsGet(req,{params:Promise.resolve({platform:"threads"})})).status).toBe(403);
    expect(state.db.mock.calls.every(([strings])=>strings.join("").includes("is_admin=true"))).toBe(true);
  });
});
