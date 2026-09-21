import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Sql } from "postgres";
import { PGlite } from "../../../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
vi.mock("server-only", () => ({}));
import { MetaApi } from "./api";
import { MetaStore } from "./store";
import { MetaVault } from "./vault";
import { TikTokMedia } from "@/test-tools/tiktok-local-media";
import { MetaPublishing } from "./service";
import { metaConfig } from "./config";
import { canUseAdminPublishing, metaReviewerShortForProject, requireAdminPublishing, requireMetaAdminPublishing } from "../access";


const A = { userId: "11111111-1111-4111-8111-111111111111", sessionId: "review-session-a" };
const B = { userId: "22222222-2222-4222-8222-222222222222", sessionId: "review-session-b" };
const shortId = "33333333-3333-4333-8333-333333333333", otherShort = "44444444-4444-4444-8444-444444444444";
const jobA = "55555555-5555-4555-8555-555555555555", jobB = "66666666-6666-4666-8666-666666666666";

const configFor = (platform: "instagram" | "threads") => metaConfig(platform, {
  NODE_ENV: "test", META_PUBLISHING_MODE: "admin-review", VERCEL_ENV: "production", VERCEL_PROJECT_ID: "prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw",
  DATABASE_URL: "postgres://postgres.mvcprswvfybudtopepuj:fake@aws-1-ap-northeast-2.pooler.supabase.com/postgres",
  INSTAGRAM_APP_ID: "123", INSTAGRAM_APP_SECRET: "test-secret", THREADS_APP_ID: "456", THREADS_APP_SECRET: "test-secret", META_GRAPH_VERSION: "v25.0",
});
let config = configFor("instagram"), pg: PGlite, store: MetaStore, service: MetaPublishing, media: TikTokMedia, root: string;
let vault: MetaVault;
let containerFails = false, partial = false, status = "FINISHED", loseContainer = false, losePublish = false, revokeFails = false, longFails = false;
let containers = 0, publishes = 0, revokes = 0,  lastUrl = "";
function tag(engine: Pick<PGlite, "query">): Sql {
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((out, part, index) => out+(index ? `$${index}` : "")+part, "");
    const result = await engine.query<Record<string, unknown>>(text, values);
    return result.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), value])));
  };
  return Object.assign(sql, { begin: (fn: (tx: Sql) => Promise<unknown>) => pg.transaction(tx => fn(tag(tx))) }) as unknown as Sql;
}
const fetcher: typeof fetch = async (input, init) => {
  const url = new URL(String(input)), body = new URLSearchParams(String(init?.body || ""));
  expect(init?.redirect).toBe("error"); expect(init?.signal).toBeDefined();
  expect(["api.instagram.com", "graph.instagram.com", "graph.threads.com"]).toContain(url.hostname);
  if (url.pathname.endsWith("/debug_token")) return Response.json({data:{is_valid:true,scopes:partial ? config.scopes.slice(0,1) : config.scopes}});
  if (url.pathname.endsWith("/permissions")) {
    if (init?.method === "DELETE") { revokes++; return revokeFails ? Response.json({error:{code:1}}, {status:500}) : Response.json({success:true}); }
    return Response.json({ data: config.scopes.map((permission,i) => ({permission,status:partial && i === 1 ? "declined" : "granted"})) });
  }
  if (url.pathname === "/oauth/access_token") {
    expect(body.get("redirect_uri")).toBe(config.redirectUri); expect(body.get("client_secret")).toBe("test-secret");
    return new Response('{"access_token":"short-private-token","user_id":17841405793187219,"permissions":'+JSON.stringify(partial ? config.scopes.slice(0,1) : config.scopes)+'}');
  }
  if (url.pathname === "/access_token") return longFails ? Response.json({error:{code:190}}, {status:400}) : Response.json({ access_token:"long-private-token",expires_in:60*86400 });
  if (url.pathname === "/refresh_access_token") { return Response.json({access_token:"rotated-private-token",expires_in:60*86400}); }
  if (url.pathname.endsWith("/me")) return Response.json({ id:"17841405793187219",user_id:"17841405793187219",username:"owner",name:"Owner",account_type:"BUSINESS" });
  if (url.pathname.endsWith("/media") || url.pathname.endsWith("/threads")) {
    containers++; lastUrl = body.get("video_url")!;
    expect(body.get("media_type")).toBe(config.platform === "instagram" ? "REELS" : "VIDEO");
    expect(body.get(config.platform === "instagram" ? "caption" : "text")).toBe("Original test video");
    expect(lastUrl).toMatch(/^https:\/\/www\.easycut\.co\.kr\/api\/social\/(instagram|threads)\/media\/[A-Za-z0-9_-]{43}$/);
    if (containerFails) return Response.json({error:{code:100}}, {status:400});
    if (loseContainer) throw new Error("secret response lost after accept");
    return Response.json({id:"12345678901234567"});
  }
  if (url.pathname.endsWith("_publish")) {
    publishes++; expect(body.get("creation_id")).toBe("12345678901234567");
    if (losePublish) throw new Error("publish accepted but response lost");
    return Response.json({id:"22345678901234567"});
  }
  if (url.searchParams.get("fields") === "permalink") return Response.json({permalink:config.platform === "instagram" ? "https://www.instagram.com/reel/abc/" : "https://www.threads.com/@owner/post/abc"});
  return Response.json({status,status_code:status});
};
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema shorts_mvp;
    create table shorts_mvp.app_users(id uuid primary key, withdrawn_at timestamptz,is_admin boolean);
    create table shorts_mvp.video_jobs(id uuid primary key,user_id uuid,project_number integer,status text,is_example boolean,user_deleted_at timestamptz);
    create table shorts_mvp.generated_shorts(id uuid primary key,job_id uuid,user_id uuid,status text,deleted_at timestamptz,expires_at timestamptz,output_s3_key text,render_version integer);
    set app.meta_admin_review='true';`);
  await pg.exec(fs.readFileSync(path.resolve("../supabase/migrations/202609210002_meta_admin_publishing.sql"),"utf8"));
  root=fs.mkdtempSync(path.join(os.tmpdir(),"easycut-meta-")); fs.mkdirSync(path.join(root,"outputs"));
},30_000);
beforeEach(async () => {
  vi.stubEnv("META_PUBLISHING_MODE", "admin-review");
  vi.stubEnv("TIKTOK_PUBLISHING_MODE", "admin-review");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("VERCEL_PROJECT_ID", "prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw");
  vi.stubEnv("DATABASE_URL", "postgres://postgres.mvcprswvfybudtopepuj:fake@aws-1-ap-northeast-2.pooler.supabase.com/postgres");
  vi.stubEnv("META_REVIEWER_ACCESS", "");
  await pg.exec(`truncate shorts_mvp.app_users,shorts_mvp.generated_shorts,shorts_mvp.video_jobs cascade;
    insert into shorts_mvp.app_users values('${A.userId}',null,true),('${B.userId}',null,false);
    insert into shorts_mvp.video_jobs values('${jobA}','${A.userId}',1,'complete',false,null),('${jobB}','${B.userId}',2,'complete',false,null);
    insert into shorts_mvp.generated_shorts values('${shortId}','${jobA}','${A.userId}','ready',null,null,'outputs/owned.mp4',1),('${otherShort}','${jobB}','${B.userId}','ready',null,null,'outputs/other.mp4',1);`);
  containerFails=false;partial=false;status="FINISHED";loseContainer=false;losePublish=false;revokeFails=false;longFails=false;containers=0;publishes=0;revokes=0;lastUrl="";
  fs.writeFileSync(path.join(root,"outputs/owned.mp4"),Buffer.alloc(64,1));
  setup("instagram");
});
function setup(platform: "instagram" | "threads") {
  config=configFor(platform); store=new MetaStore(tag(pg),config.appKey); vault=new MetaVault(Buffer.alloc(32,9),config.appKey); media=new TikTokMedia(root);
  vi.spyOn(media,"inspect").mockImplementation(async key => { const file=await media.file(key); return {...file,duration:15,hash:await media.fingerprint(file.file)}; });
  service=new MetaPublishing(store,vault,new MetaApi(config,fetcher),media,config,userId => requireMetaAdminPublishing(tag(pg),userId));
}
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => { await pg.close(); fs.rmSync(root,{recursive:true,force:true}); });
async function start() { return new URL(await service.start(A,{returnPath:"/en/projects/1",shortId})).searchParams.get("state")!; }
async function connect() { expect((await service.callback(A,new URLSearchParams({state:await start(),code:"owned"}))).outcome).toBe("connected"); return (await service.list(A,shortId)).connections[0]; }
const intent = (id:string) => ({shortId,connectionId:id,title:"Original test video",rightsConfirmed:true,publishConfirmed:true});
const capability = () => new URL(lastUrl).pathname.split("/").at(-1)!;
async function resetCheck() { await pg.exec("update shorts_mvp.meta_posts set checked_at=null"); }

describe("Meta publishing with real isolated PostgreSQL and provider protocol",() => {
  it.each(["instagram","threads"] as const)("%s reviewer can publish only its assigned owned clip, without admin or TikTok access", async platform => {
    setup(platform);
    await pg.query("update shorts_mvp.app_users set is_admin=false where id=$1",[A.userId]);
    vi.stubEnv("META_REVIEWER_ACCESS",JSON.stringify({userId:A.userId,shortId,expiresAt:new Date(Date.now()+86400_000).toISOString()}));
    expect(await canUseAdminPublishing(tag(pg),A.userId)).toBe(false);
    await expect(requireAdminPublishing(tag(pg),A.userId)).rejects.toMatchObject({code:"TIKTOK_DISABLED"});
    expect(await metaReviewerShortForProject(tag(pg),A.userId,1)).toBe(shortId);
    expect(await metaReviewerShortForProject(tag(pg),A.userId,2)).toBeNull();
    expect(await metaReviewerShortForProject(tag(pg),B.userId,1)).toBeNull();
    const c=await connect();
    await expect(service.create(A,{...intent(c.id),shortId:otherShort})).rejects.toThrow();
    // Even another clip owned by the reviewer is outside the one-video grant.
    await pg.query("update shorts_mvp.generated_shorts set user_id=$1,job_id=$2 where id=$3",[A.userId,jobA,otherShort]);
    await expect(service.preview(A,otherShort)).rejects.toThrow();
    await expect(service.create(A,{...intent(c.id),shortId:otherShort})).rejects.toThrow();
    await expect(service.list(B,shortId)).rejects.toThrow();
    expect(containers).toBe(0);
    const p=await service.create(A,intent(c.id));
    expect((await service.publicMedia(capability())).size).toBe(64);
    expect((await service.check(A,p.id)).status).toBe("complete");
    expect(publishes).toBe(1);
    expect((await service.disconnect(A,c.id)).deleted).toBe(true);
    expect((await service.list(A,shortId)).connections).toEqual([]);
    expect((await pg.query<{is_admin:boolean}>("select is_admin from shorts_mvp.app_users where id=$1",[A.userId])).rows[0].is_admin).toBe(false);
  });
  it.each(["expired","revoked","withdrawn","wrong-video"])("%s reviewer grant prevents delayed callbacks and media delivery",async reason => {
    await pg.query("update shorts_mvp.app_users set is_admin=false where id=$1",[A.userId]);
    const grant={userId:A.userId,shortId,expiresAt:new Date(Date.now()+86400_000).toISOString()};
    vi.stubEnv("META_REVIEWER_ACCESS",JSON.stringify(grant));
    const c=await connect();await service.create(A,intent(c.id));const cap=capability(), state=await start();
    if(reason==="withdrawn") await pg.query("update shorts_mvp.app_users set withdrawn_at=now() where id=$1",[A.userId]);
    else vi.stubEnv("META_REVIEWER_ACCESS",reason==="revoked" ? "" : JSON.stringify({...grant,...(reason==="expired" ? {expiresAt:new Date(Date.now()-1000).toISOString()} : {shortId:otherShort})}));
    await expect(service.preview(A,shortId)).rejects.toThrow();
    await expect(service.publicMedia(cap)).rejects.toThrow();
    const callback=service.callback(A,new URLSearchParams({state,code:"owned"}));
    if(reason==="wrong-video") expect((await callback).outcome).not.toBe("connected");
    else await expect(callback).rejects.toThrow();
    expect(await metaReviewerShortForProject(tag(pg),A.userId,1)).toBeNull();
    expect(publishes).toBe(0);
  });
  it.each(["instagram","threads"] as const)("%s completes one publish and returns a verified permalink",async platform => {
    setup(platform); const c=await connect(), post=await service.create(A,intent(c.id));
    expect(post.status).toBe("processing"); expect(containers).toBe(1); expect(publishes).toBe(0);
    expect((await service.publicMedia(capability())).size).toBe(64);
    const completed=await service.check(A,post.id); expect(completed.status).toBe("complete");expect(completed.url).toContain(platform);
    await service.create(A,intent(c.id)); await service.check(A,post.id);expect(containers).toBe(1);expect(publishes).toBe(1);
    await expect(service.publicMedia(capability())).rejects.toThrow();
  });
  it("binds OAuth to owner/session/app, rejects replay, encrypts grants and preserves numeric IDs",async () => {
    const state=await start();
    await expect(service.callback({...A,sessionId:"different"},new URLSearchParams({state,code:"x"}))).rejects.toThrow();
    expect(await service.callback(A,new URLSearchParams({state,code:"x"}))).toEqual({outcome:"connected",returnPath:"/en/projects/1"});
    await expect(service.callback(A,new URLSearchParams({state,code:"x"}))).rejects.toThrow();
    const row=(await pg.query<{token_ciphertext:string;open_id:string}>("select * from shorts_mvp.meta_connections")).rows[0];
    expect(row.open_id).toBe("17841405793187219");expect(row.token_ciphertext).not.toContain("private-token");
    expect(() => vault.open(row.token_ciphertext,B.userId,"connection:"+row.open_id)).toThrow();
    expect(() => new MetaVault(Buffer.alloc(32,9),"threads:456").open(row.token_ciphertext,A.userId,"connection:"+row.open_id)).toThrow();
    expect(JSON.stringify(await service.list(A,shortId))).not.toMatch(/private-token|ciphertext|openId/);
    const foreign=new MetaStore(tag(pg),"threads:456");expect(await foreign.list(A.userId)).toEqual([]);
  });
  it("rejects ordinary users, foreign videos, missing consent, redirects and altered source before publishing",async () => {
    const c=await connect();
    await expect(service.list(B,otherShort)).rejects.toThrow();
    await expect(service.create(B,intent(c.id))).rejects.toThrow();
    for(const patch of [{shortId:otherShort},{rightsConfirmed:false},{publishConfirmed:false},{unexpected:true}]) await expect(service.create(A,{...intent(c.id),...patch})).rejects.toThrow();
    for(const returnPath of ["//evil.test","/projects/2","/en/projects/1?next=evil"]) await expect(service.start(A,{returnPath,shortId})).rejects.toThrow();
    expect(containers).toBe(0);
    const post=await service.create(A,intent(c.id));await pg.exec("update shorts_mvp.generated_shorts set render_version=2");
    await expect(service.check(A,post.id)).rejects.toThrow();await expect(service.publicMedia(capability())).rejects.toThrow();expect(publishes).toBe(0);
  });
  it("revokes partial grants and failed exchange; cancelled or expired states do not connect",async () => {
    partial=true;expect((await service.callback(A,new URLSearchParams({state:await start(),code:"x"}))).outcome).toBe("META_PERMISSION_REQUIRED");expect(revokes).toBe(1);
    containerFails=false;partial=false;longFails=true;expect((await service.callback(A,new URLSearchParams({state:await start(),code:"x"}))).outcome).not.toBe("connected");expect(revokes).toBe(2);
    expect((await service.callback(A,new URLSearchParams({state:await start(),error:"access_denied"}))).outcome).toBe("cancelled");
    const state=await start();await pg.exec("update shorts_mvp.meta_oauth set expires_at=now()-interval '1 second'");await expect(service.callback(A,new URLSearchParams({state,code:"x"}))).rejects.toThrow();
    expect((await service.list(A,shortId)).connections).toEqual([]);
  });
  it("allows a new explicit attempt only after a definitive failure, keeping history",async () => {
    const c=await connect();containerFails=true;const failed=await service.create(A,intent(c.id));expect(failed.status).toBe("failed");
    containerFails=false;const retry=await service.create(A,intent(c.id));expect(retry.status).toBe("processing");expect(retry.id).not.toBe(failed.id);
    expect(containers).toBe(2);expect((await service.listPosts(A,shortId))).toHaveLength(2);
  });
  it("does not repeat a container or publish when Meta's response is lost",async () => {
    const c=await connect();loseContainer=true;const p=await service.create(A,intent(c.id));expect(p.status).toBe("unknown");
    await service.create(A,intent(c.id));expect(containers).toBe(1);expect(publishes).toBe(0);
    await pg.exec("delete from shorts_mvp.meta_posts");loseContainer=false;losePublish=true;
    const post=await service.create(A,intent(c.id));expect((await service.check(A,post.id)).status).toBe("unknown");
    await resetCheck();await service.check(A,post.id);expect(publishes).toBe(1);
    status="PUBLISHED";await resetCheck();expect((await service.check(A,post.id)).status).toBe("complete");expect(publishes).toBe(1);
  });
  it("processes signed deauthorization once without deleting a later reconnect",async () => {
    const c=await connect();await service.create(A,intent(c.id));
    const issuedAt=Math.floor(Date.now()/1000), receipt="1".repeat(64);
    await store.deauthorized("17841405793187219",issuedAt,receipt);
    expect(await store.hasDeletionReceipt(receipt)).toBe(true);
    expect((await service.list(A,shortId)).connections).toEqual([]);
    expect((await service.listPosts(A,shortId))).toEqual([]);
    await connect();await store.deauthorized("17841405793187219",issuedAt,receipt);
    expect((await service.list(A,shortId)).connections).toHaveLength(1);
    await store.deauthorized("17841405793187219",issuedAt-86400,"2".repeat(64));
    expect((await service.list(A,shortId)).connections).toHaveLength(1);
    await pg.query("update shorts_mvp.meta_callback_receipts set created_at=now()-interval '91 days' where request_hash=$1",[receipt]);
    expect(await store.hasDeletionReceipt(receipt)).toBe(false);
  });
  it("expires delivery capabilities and fences disconnect, role removal and withdrawal",async () => {
    const c=await connect();await service.create(A,intent(c.id));const cap=capability();
    await pg.exec("update shorts_mvp.meta_posts set media_expires_at=now()-interval '1 second'");await expect(service.publicMedia(cap)).rejects.toThrow();
    await pg.exec(`update shorts_mvp.app_users set is_admin=false where id='${A.userId}'`);await expect(service.preview(A,shortId)).rejects.toThrow();
    await pg.exec(`update shorts_mvp.app_users set is_admin=true where id='${A.userId}'`);
    revokeFails=true;expect((await service.disconnect(A,c.id)).revocation).toBe("manual_required");expect((await service.list(A,shortId)).connections).toEqual([]);
    await expect(start()).rejects.toThrow();await expect(service.publicMedia(cap)).rejects.toThrow();
    await pg.exec("update shorts_mvp.meta_owners set disconnect_until=null");await connect();
    await pg.exec(`update shorts_mvp.app_users set withdrawn_at=now() where id='${A.userId}'`);
    expect((await pg.query("select * from shorts_mvp.meta_connections")).rows).toEqual([]);
    expect((await pg.query("select * from shorts_mvp.meta_oauth")).rows).toEqual([]);
  });
});
