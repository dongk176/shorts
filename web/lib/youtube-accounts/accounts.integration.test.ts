import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { YoutubeAccountUploads } from "./uploads";
import type { Sql } from "postgres";
import { PGlite } from "../../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
vi.mock("server-only", () => ({}));
import { YoutubeAccountStore } from "./store";
import { TokenVault } from "./crypto";
import { YoutubeAccounts } from "./service";
import { YoutubeAccountGoogle } from "./google";
import { YoutubeRetention } from "./retention";
import { withYoutubeWithdrawal } from "./withdrawal";
import { sourceAttribution } from "./attribution-server";
import { SCOPES } from "./contracts";

const A = { userId: "11111111-1111-4111-8111-111111111111", sessionId: "session-a" };
const B = { userId: "22222222-2222-4222-8222-222222222222", sessionId: "session-b" };
const JA = "33333333-3333-4333-8333-333333333333", JB = "44444444-4444-4444-8444-444444444444";
const SA = "55555555-5555-4555-8555-555555555555", SB = "66666666-6666-4666-8666-666666666666", MISMATCH = "77777777-7777-4777-8777-777777777777";
const CHANNEL_A = "UCaaaaaaaaaaaaaaaaaaaaaa", CHANNEL_B = "UCbbbbbbbbbbbbbbbbbbbbbb";
let uploadRoot: string;
let pg: PGlite, service: YoutubeAccounts, store: YoutubeAccountStore;
let selectedChannel = CHANNEL_A, providerFails = false, paid = true, googleCalls = 0;
const vault = new TokenVault({ v1: Buffer.alloc(32, 7) }, "v1");
type Engine = Pick<PGlite, "query">;
function tag(engine: Engine): Sql {
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, "");
    const params = values.map(value => Array.isArray(value) ? `{${value.map(item => `"${String(item).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')}}` : value);
    const result = await engine.query<Record<string, unknown>>(query, params);
    return result.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), value])));
  };
  return Object.assign(sql, { begin: (fn: (tx: Sql) => Promise<unknown>) => pg.transaction(tx => fn(tag(tx))) }) as unknown as Sql;
}
beforeAll(async () => {
  uploadRoot=fs.mkdtempSync(path.join(os.tmpdir(),"youtube-account-uploads-"));
  fs.mkdirSync(path.join(uploadRoot,"outputs"));
  fs.writeFileSync(path.join(uploadRoot,"outputs/a.mp4"),Buffer.alloc(64));
  fs.writeFileSync(path.join(uploadRoot,"outputs/b.mp4"),Buffer.alloc(64));
  pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema shorts_mvp; grant usage on schema shorts_mvp to anon,authenticated,service_role;
    create table shorts_mvp.app_users(id uuid primary key, withdrawn_at timestamptz);
    create table shorts_mvp.video_jobs(id uuid primary key,user_id uuid,project_number integer,status text,is_example boolean,user_deleted_at timestamptz,source_type text default 'youtube',youtube_video_id text,video_title text,channel_name text,youtube_metadata_verified_at timestamptz,created_at timestamptz default now());
    create table shorts_mvp.youtube_catalog(video_id text,metadata jsonb,availability text,verified_at timestamptz,metadata_pending_at timestamptz);
    create table shorts_mvp.generated_shorts(id uuid primary key,job_id uuid,user_id uuid,status text,deleted_at timestamptz,expires_at timestamptz,output_s3_key text,render_version integer);
    set app.youtube_review_release='20260922';`);
  await pg.exec(fs.readFileSync(path.resolve(process.cwd(), "../supabase/migrations/202609220001_youtube_reviewer_accounts.sql"), "utf8"));
}, 30_000);
beforeEach(async () => {
  await pg.exec(`truncate shorts_mvp.app_users,shorts_mvp.video_jobs,shorts_mvp.generated_shorts cascade;
    insert into shorts_mvp.app_users(id) values ('${A.userId}'),('${B.userId}');
    insert into shorts_mvp.video_jobs(id,user_id,project_number,status,is_example) values ('${JA}','${A.userId}',1,'completed',false),('${JB}','${B.userId}',2,'completed',false);
    insert into shorts_mvp.generated_shorts values
      ('${SA}','${JA}','${A.userId}','ready',null,null,'outputs/a.mp4',1),
      ('${SB}','${JB}','${B.userId}','ready',null,null,'outputs/b.mp4',1),
      ('${MISMATCH}','${JB}','${A.userId}','ready',null,null,'outputs/wrong-owner.mp4',1);`);
  selectedChannel = CHANNEL_A; providerFails = false; paid = true; googleCalls = 0;
  store = new YoutubeAccountStore(tag(pg));
  const google = new YoutubeAccountGoogle({ clientId: "test", clientSecret: "test", redirectUri: "http://localhost:3001/api/youtube/accounts/oauth/callback" }, async (url, init) => {
    googleCalls++; expect(init?.redirect).toBe("error"); expect(init?.signal).toBeDefined();
    if (providerFails) return Response.json({ error: "invalid_grant", error_description: "sensitive-provider-content" }, { status: 400 });
    if (String(url).endsWith("/revoke")) return new Response(null, {status:200});
    return String(url).includes('/token') ? Response.json({ access_token: "test-access", refresh_token: "test-secret-refresh", scope: SCOPES.join(" ") }) : Response.json({ items: [{ id: selectedChannel, snippet: { title: "My test channel" } }] });
  });
  service = new YoutubeAccounts(store, vault, google, async () => { if (!paid) throw Error("Paid access required"); });
});
afterAll(async () => {await pg?.close();fs.rmSync(uploadRoot,{recursive:true,force:true});});
const start = async (actor = A, extra = {}) => new URL(await service.start(actor, { returnPath: "/settings", ...extra })).searchParams.get("state")!;
const callback = (state: string, actor = A, error = false) => service.callback(actor, new URLSearchParams(error ? { state, error: "access_denied" } : { state, code: "fake-code" }));
async function connect(actor = A) { expect((await callback(await start(actor), actor)).outcome).toBe("connected"); return (await service.list(actor))[0]; }

describe("authenticated per-user connections against embedded PostgreSQL", () => {
  it("persists encrypted per-user channels; list and eligibility expose no tokens or source URLs", async () => {
    const connection = await connect();
    expect(await service.list(B)).toEqual([]);
    const raw = (await pg.query<{ token_ciphertext: string }>("select token_ciphertext from shorts_mvp.youtube_account_links")).rows[0].token_ciphertext;
    expect(raw).not.toContain("test-secret-refresh");
    expect(vault.open(raw, A.userId, `channel:${CHANNEL_A}`)).toBe("test-secret-refresh");
    expect(() => vault.open(raw, B.userId, `channel:${CHANNEL_A}`)).toThrow();
    expect(() => vault.open(raw, A.userId, `channel:${CHANNEL_B}`)).toThrow();
    const result = await service.eligibility(A, SA, connection.id);
    expect(result.eligible).toBe(true); expect(JSON.stringify(result)).not.toMatch(/cipher|secret|outputs\//);
    expect(await new YoutubeAccountStore(tag(pg)).list(A.userId)).toEqual(await service.list(A));
  });
  it("blocks another user's links, videos, mismatched project ownership, guest sessions and injected actor", async () => {
    const connection = await connect();
    await expect(service.disconnect(B, connection.id)).rejects.toMatchObject({ status: 404 });
    await expect(service.eligibility(B, SB, connection.id)).rejects.toMatchObject({ status: 404 });
    await expect(service.eligibility(A, SB, connection.id)).rejects.toMatchObject({ status: 404 });
    await expect(service.eligibility(A, MISMATCH, connection.id)).rejects.toMatchObject({ status: 404 });
    await expect(service.list({ ...A, sessionId: "" })).rejects.toMatchObject({ status: 401 });
    await expect(service.start(A, { returnPath: "/settings", userId: B.userId } as never)).rejects.toThrow();
  });
  it("binds state to app account and session, rejects replay, keeps rightful callback usable", async () => {
    const state = await start();
    await expect(callback(state, B)).rejects.toThrow();
    await expect(callback(state, { ...A, sessionId: "other-browser" })).rejects.toThrow();
    expect(googleCalls).toBe(0);
    expect((await callback(state)).outcome).toBe("connected");
    await expect(callback(state)).rejects.toThrow();expect(googleCalls).toBe(2);
  });
  it("consumes cancelled requests, rejects expired states and newer login attempts invalidate older ones", async () => {
    const cancelled = await start();expect((await callback(cancelled, A, true)).outcome).toBe("cancelled");
    await expect(callback(cancelled)).rejects.toThrow();
    const expired = await start();await pg.exec("update shorts_mvp.youtube_account_oauth set expires_at=now()-interval '1 second'");
    await expect(callback(expired)).rejects.toThrow();
    const old = await start(), current = await start();await expect(callback(old)).rejects.toThrow();
    expect((await callback(current)).outcome).toBe("connected");
  });
  it("deletes all owned links, fences reconnect, and reconnect creates a fresh identity", async () => {
    const connection = await connect();
    expect(await service.disconnect(A, connection.id)).toEqual({deleted:true,revocation:"revoked"});
    const cooldown = await service.disconnectState(A);
    expect(cooldown.status).toBe("revoked");expect(cooldown.retryAfterSeconds).toBeGreaterThan(0);expect(cooldown.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(await service.list(A)).toEqual([]);
    expect((await pg.query("select * from shorts_mvp.youtube_account_links")).rows).toEqual([]);
    await expect(service.eligibility(A, SA, connection.id)).rejects.toThrow();
    await expect(start()).rejects.toMatchObject({status:409,code:"YOUTUBE_RECONNECT_COOLDOWN",retryAfterSeconds:expect.any(Number)});
    await pg.exec("update shorts_mvp.youtube_account_owners set disconnect_until=now()-interval '1 second'");
    expect(await service.disconnectState(A)).toEqual({status:"revoked",retryAfterSeconds:0});
    const fresh=await connect();expect(fresh.id).not.toBe(connection.id);
    expect(await service.disconnectState(A)).toEqual({status:"none",retryAfterSeconds:0});
  });
  it("a callback already exchanging tokens cannot resurrect a disconnected link", async () => {
    const connection = await connect();const state = await start(A, { connectionId: connection.id });
    const { hash } = await import("./crypto");const pending = await store.consume(A, hash(state));
    await service.disconnect(A, connection.id);
    await expect(store.finish(pending, [{ channelId: CHANNEL_A, channelTitle: "late", ciphertext: "late" }], SCOPES)).rejects.toMatchObject({ status: 409 });
    expect(await service.list(A)).toEqual([]);
  });
  it("revokes a grant issued by a callback that loses a race with deletion", async () => {
    const c=await connect();const state=await start();let lateRevocations=0;
    const google=new YoutubeAccountGoogle({clientId:'test',clientSecret:'test',redirectUri:'http://localhost'},async url=>{
      if(String(url).endsWith('/token'))return Response.json({access_token:'late-access',refresh_token:'late-refresh',scope:SCOPES.join(' ')});
      if(String(url).endsWith('/revoke')){lateRevocations++;return new Response(null,{status:200});}
      await service.disconnect(A,c.id);
      return Response.json({items:[{id:CHANNEL_A,snippet:{title:'Late channel'}}]});
    });
    const late=new YoutubeAccounts(store,vault,google,async()=>{});
    expect((await late.callback(A,new URLSearchParams({state,code:'fake'}))).outcome).toBe('failed');
    expect(lateRevocations).toBe(1);expect(await service.list(A)).toEqual([]);
  });
  it("provider failure preserves old connection; project return is owned and allowlisted", async () => {
    const existing = await connect();providerFails = true;
    const result = await callback(await start(A, { shortId: SA, returnPath: "/projects/1" }));
    expect(result).toEqual({ returnPath: "/projects/1", outcome: "failed" });
    expect(await service.list(A)).toEqual([existing]);
    for (const returnPath of ["//evil.test", "/\\evil.test", "/projects/1?next=x", "https://evil.test", "/projects/%31"]) await expect(start(A, { returnPath })).rejects.toThrow();
    await expect(start(A, { shortId: SA, returnPath: "/projects/2" })).rejects.toThrow();
  });
  it("returns channel-management OAuth to the exact local page without widening redirects", async () => {
    expect(await callback(await start(A, { returnPath: "/publish/channels" }))).toEqual({ returnPath: "/publish/channels", outcome: "connected" });
    for (const returnPath of ["/publish/channels?next=https://evil.test", "/publish/channels/elsewhere", "/publish/channels#redirect"])
      await expect(start(A, { returnPath })).rejects.toThrow();
    await expect(start(A, { shortId: SA, returnPath: "/publish/channels" })).rejects.toThrow();
  });
  it("retains entitlement, ready/expiry/deletion/example checks before publishing", async () => {
    const connection = await connect();paid = false;
    await expect(service.eligibility(A, SA, connection.id)).rejects.toThrow();paid = true;
    for (const mutation of ["status='rerendering'", "expires_at=now()-interval '1 second'", "deleted_at=now()", "output_s3_key=null"]) {
      await pg.exec(`update shorts_mvp.generated_shorts set ${mutation} where id='${SA}'`);
      await expect(service.eligibility(A, SA, connection.id)).rejects.toThrow();
      await pg.exec(`update shorts_mvp.generated_shorts set status='ready',expires_at=null,deleted_at=null,output_s3_key='outputs/a.mp4' where id='${SA}'`);
    }
    await pg.exec(`update shorts_mvp.video_jobs set is_example=true where id='${JA}'`);
    await expect(service.eligibility(A, SA, connection.id)).rejects.toThrow();
  });
  it("purges every owned channel and publication but preserves another user's data and source files", async () => {
    const c=await connect();selectedChannel=CHANNEL_B;await connect();await connect(B);
    await pg.query(`insert into shorts_mvp.youtube_account_uploads(id,user_id,connection_id,short_id,render_version,connection_version,title,state_ciphertext,status,video_id) values ('88888888-8888-4888-8888-888888888888',$1,$2,$3,1,1,'private title','private resumable state','complete','private-video')`,[A.userId,c.id,SA]);
    await start();
    const b=await service.list(B);
    await service.disconnect(A,c.id);
    for (const table of ['youtube_account_links','youtube_account_oauth','youtube_account_uploads']) {
      expect((await pg.query(`select * from shorts_mvp.${table} where user_id=$1`,[A.userId])).rows).toEqual([]);
    }
    expect(await service.list(B)).toEqual(b);
    expect((await pg.query("select id from shorts_mvp.generated_shorts where id=$1",[SA])).rows).toHaveLength(1);
    expect(fs.existsSync(path.join(uploadRoot,'outputs/a.mp4'))).toBe(true);
  });
  it("provider failure cannot retain local credentials, and manual revocation status survives reload", async () => {
    const c=await connect();providerFails=true;
    expect(await service.disconnect(A,c.id)).toEqual({deleted:true,revocation:'manual_required'});
    expect(await service.list(A)).toEqual([]);
    expect(await new YoutubeAccountStore(tag(pg)).disconnectStatus(A.userId)).toBe('manual_required');
    expect(JSON.stringify(await service.disconnectStatus(A))).not.toContain('sensitive-provider-content');
  });
  it("deletes before the provider responds, fences new consent, and recovers unknown revocation as manual action", async () => {
    const c=await connect();let release!:()=>void;let entered!:()=>void;
    const ready=new Promise<void>(resolve=>{entered=resolve;});
    const blocked=new YoutubeAccountGoogle({clientId:'test',clientSecret:'test',redirectUri:'http://localhost'},async()=>{
      entered();await new Promise<void>(resolve=>{release=resolve;});return new Response(null,{status:200});
    });
    const removing=new YoutubeAccounts(store,vault,blocked,async()=>{}).disconnect(A,c.id);
    await ready;
    expect(await service.list(A)).toEqual([]);await expect(start()).rejects.toMatchObject({status:409});
    expect(await service.disconnectStatus(A)).toBe('pending');
    await pg.exec("update shorts_mvp.youtube_account_owners set disconnect_until=now()-interval '1 second'");
    expect(await service.disconnectStatus(A)).toBe('manual_required');
    release();expect((await removing).revocation).toBe('revoked');
  });
  it("browser roles cannot read even encrypted tokens through direct database access", async () => {
    await connect();await pg.exec("set role authenticated");
    try { await expect(pg.query("select * from shorts_mvp.youtube_account_links")).rejects.toMatchObject({ code: "42501" }); }
    finally { await pg.exec("reset role"); }
  });
});

describe("per-user resumable publishing",()=>{
 function uploader(hook?: (url:string)=>Promise<void>, allowNonPrivateUploads=false, actualPrivacy="private"){
  const calls:string[]=[];const bodies:unknown[]=[];
  const uploads=new YoutubeAccountUploads(tag(pg),store,service,vault,{clientId:"test",clientSecret:"test",allowNonPrivateUploads},uploadRoot,async(url,init)=>{
   const u=String(url);calls.push(u);await hook?.(u);
   if(u.includes("/token"))return Response.json({access_token:"secret-access"});
   if(u.includes("/channels?"))return Response.json({items:[{id:CHANNEL_A,snippet:{title:"Test"}}]});
   if(u.includes("uploadType=resumable")){bodies.push(JSON.parse(String(init?.body)));return new Response(null,{status:200,headers:{location:"https://www.googleapis.com/upload/youtube/session-1"}});}
   if(u.includes("/session-1"))return init?.headers && (init.headers as Record<string,string>)["Content-Length"]==="0"?new Response(null,{status:308}):Response.json({id:"test-video"});
   return Response.json({items:[{status:{privacyStatus:actualPrivacy,uploadStatus:"processed"},snippet:{channelId:CHANNEL_A},processingDetails:{processingStatus:"succeeded"}}]});
  });return {uploads,calls,bodies};
 }
 const input=(connectionId:string)=>({shortId:SA,connectionId,title:"My private video",description:"",madeForKids:false,synthetic:false});
 it("pins recovery to the rendered version and rejects a stale compose before upload",async()=>{
  const c=await connect(),{uploads,calls}=uploader();
  expect(await uploads.renderVersion(A,SA)).toBe(1);
  await expect(uploads.renderVersion(B,SA)).rejects.toThrow();
  await expect(uploads.create(A,{...input(c.id),expectedRenderVersion:0})).rejects.toMatchObject({status:409});
  expect(calls).toEqual([]);expect(await uploads.list(A,SA)).toEqual([]);
  const result=await uploads.create(A,{...input(c.id),expectedRenderVersion:1});
  expect((await uploads.list(A,SA))[0]).toMatchObject({id:result.id,connectionId:c.id,renderVersion:1});
 });
 it("uploads owned output, encrypts progress, prevents duplicates and hides it from B",async()=>{
  const c=await connect(),{uploads,calls}=uploader();
  const result=await uploads.create(A,input(c.id));expect(result.status).toBe("complete");expect(result.videoId).toBe("test-video");
  expect((await uploads.create(A,input(c.id))).id).toBe(result.id);
  expect(calls.filter(u=>u.includes("uploadType=resumable"))).toHaveLength(1);
  await expect(uploads.run(B,result.id)).rejects.toMatchObject({status:404});
  await expect(uploads.list(B,SA)).rejects.toThrow();expect(await uploads.list(B,SB)).toEqual([]);
  await expect(uploads.create(B,{...input(c.id),shortId:SB})).rejects.toThrow();
  const raw=(await pg.query<{state_ciphertext:string}>("select state_ciphertext from shorts_mvp.youtube_account_uploads")).rows[0].state_ciphertext;
  expect(raw).not.toContain("session-1");expect(JSON.stringify(result)).not.toMatch(/cipher|token|session-1|outputs\//);
 });
 it.each(['public','unlisted'] as const)("blocks %s before storing or contacting Google when disabled",async privacy=>{
  const c=await connect(),{uploads,calls}=uploader();
  await expect(uploads.create(A,{...input(c.id),privacy})).rejects.toMatchObject({status:403});
  expect(calls).toEqual([]);expect(await uploads.list(A,SA)).toEqual([]);
 });
 it.each(['private','unlisted','public'] as const)("preserves requested %s through upload and records the observed result",async privacy=>{
  const c=await connect(),{uploads,bodies}=uploader(undefined,true,privacy);
  const result=await uploads.create(A,{...input(c.id),privacy});
  expect(bodies).toMatchObject([{status:{privacyStatus:privacy}}]);
  expect(result).toMatchObject({status:'complete',requestedPrivacy:privacy,actualPrivacy:privacy});
  expect(result.privacyCheckedAt).toBeTruthy();
  expect((await uploads.list(A,SA))[0]).toMatchObject({requestedPrivacy:privacy,actualPrivacy:privacy});
 });
 it("records a private result for a public request without claiming public visibility or retrying",async()=>{
  const c=await connect(),{uploads,calls}=uploader(undefined,true,'private');
  const result=await uploads.create(A,{...input(c.id),privacy:'public'});
  expect(result).toMatchObject({status:'complete',requestedPrivacy:'public',actualPrivacy:'private'});
  expect(calls.filter(u=>u.includes('uploadType=resumable'))).toHaveLength(1);
  expect(calls.some(u=>u.includes('videos/update'))).toBe(false);
  await expect(uploads.create(A,{...input(c.id),privacy:'unlisted'})).rejects.toMatchObject({status:409});
  expect(calls.filter(u=>u.includes('uploadType=resumable'))).toHaveLength(1);
 });
 it("does not treat missing or invalid YouTube visibility as complete",async()=>{
  const c=await connect(),{uploads}=uploader(undefined,true,'unknown');
  expect(await uploads.create(A,input(c.id))).toMatchObject({status:'interrupted',actualPrivacy:null});
 });
 it("cannot resume a nonprivate transfer after the server gate is disabled",async()=>{
  const c=await connect();const first=uploader(async()=>{throw Error('network down');},true);
  const result=await first.uploads.create(A,{...input(c.id),privacy:'public'});
  const second=uploader();await expect(second.uploads.run(A,result.id)).rejects.toMatchObject({status:403});
  expect(second.calls).toEqual([]);
 });
 it("verifies migrated completed uploads without creating a second YouTube video",async()=>{
  const c=await connect();const first=uploader();const result=await first.uploads.create(A,input(c.id));
  await pg.query('update shorts_mvp.youtube_account_uploads set actual_privacy=null,privacy_checked_at=null where id=$1',[result.id]);
  const second=uploader();expect(await second.uploads.run(A,result.id)).toMatchObject({status:'complete',actualPrivacy:'private'});
  expect(second.calls.some(u=>u.includes('uploadType=resumable'))).toBe(false);
  expect(second.calls.some(u=>u.includes('/session-1'))).toBe(false);
 });
 it("rejects source escape and cross-user project before Google requests",async()=>{
  const c=await connect(),{uploads,calls}=uploader();
  await expect(uploads.create(A,{...input(c.id),shortId:SB})).rejects.toThrow();
  await pg.exec(`update shorts_mvp.generated_shorts set output_s3_key='outputs/../../outside.mp4' where id='${SA}'`);
  await expect(uploads.create(A,input(c.id))).rejects.toThrow();expect(calls).toEqual([]);
 });
 it("stops after disconnect between network steps",async()=>{
  const c=await connect();let revoked=false;
  const {uploads,calls}=uploader(async u=>{if(u.includes('/channels?')&&!revoked){revoked=true;await service.disconnect(A,c.id);}});
  await expect(uploads.create(A,input(c.id))).rejects.toMatchObject({status:404});
  expect(calls.some(u=>u.includes("uploadType=resumable"))).toBe(false);
  expect(await uploads.list(A,SA)).toEqual([]);expect(calls).toHaveLength(2);
 });
 it("aborts an in-flight request after deletion without recreating upload state",async()=>{
  const c=await connect();let entered!:()=>void;let aborted=false;
  const ready=new Promise<void>(resolve=>{entered=resolve;});
  const uploads=new YoutubeAccountUploads(tag(pg),store,service,vault,{clientId:'test',clientSecret:'test'},uploadRoot,async(_url,init)=>{
   entered();return new Promise<Response>((_resolve,reject)=>{
    init?.signal?.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'));},{once:true});
   });
  });
  const running=expect(uploads.create(A,input(c.id))).rejects.toMatchObject({status:404});
  await ready;await service.disconnect(A,c.id);await running;
  expect(aborted).toBe(true);
  expect((await pg.query('select * from shorts_mvp.youtube_account_uploads')).rows).toEqual([]);
 });
 it("requires explicit resume after reconnecting the same channel",async()=>{
  const c=await connect();let interrupted=false;
  const first=uploader(async u=>{if(u.includes('/channels?')&&!interrupted){interrupted=true;throw Error('network down');}});
  const result=await first.uploads.create(A,input(c.id));expect(result.status).toBe('interrupted');
  await connect();
  const second=uploader();expect((await second.uploads.run(A,result.id)).status).toBe('complete');
  expect(second.calls.filter(u=>u.includes('uploadType=resumable'))).toHaveLength(1);
 });
 it("rejects same-size changed output before resuming",async()=>{
  const c=await connect();const first=uploader(async()=>{throw Error('network down');});
  const result=await first.uploads.create(A,input(c.id));
  fs.writeFileSync(path.join(uploadRoot,'outputs/a.mp4'),Buffer.alloc(64,1));
  try{const second=uploader();expect((await second.uploads.run(A,result.id)).status).toBe('interrupted');expect(second.calls).toEqual([]);}
  finally{fs.writeFileSync(path.join(uploadRoot,'outputs/a.mp4'),Buffer.alloc(64));}
 });
 it("refuses a second live lease and never restarts uncertain sessions",async()=>{
  const c=await connect();const first=uploader(async u=>{if(u.includes('uploadType=resumable'))throw Error('response lost');});
  const result=await first.uploads.create(A,input(c.id));expect(result.status).toBe('interrupted');
  const second=uploader();expect((await second.uploads.run(A,result.id)).status).toBe('interrupted');
  expect(second.calls.some(u=>u.includes('uploadType=resumable'))).toBe(false);
  await pg.exec(`update shorts_mvp.youtube_account_uploads set lease_until=now()+interval '5 minutes' where id='${result.id}'`);
  await expect(second.uploads.run(A,result.id)).rejects.toMatchObject({status:409});
 });
});

describe("retention and account withdrawal", () => {
  function retention(fetcher?: typeof fetch) {
    const google = new YoutubeAccountGoogle({clientId:'test',clientSecret:'test',redirectUri:'http://localhost'},fetcher ?? (async url => String(url).includes('/token') ? Response.json({access_token:'access'}) : String(url).includes('/channels?') ? Response.json({items:[{id:CHANNEL_A,snippet:{title:'Updated channel'}}]}) : new Response(null,{status:200})));
    return new YoutubeRetention(tag(pg),store,service,vault,google);
  }
  async function oldUpload(connectionId: string) {
    await pg.query(`insert into shorts_mvp.youtube_account_uploads(id,user_id,connection_id,short_id,render_version,connection_version,title,state_ciphertext,status,video_id,actual_privacy,privacy_checked_at,created_at)
      values ('88888888-8888-4888-8888-888888888888',$1,$2,$3,1,1,'sensitive title','encrypted-session','complete','private-video','private',now(),now()-interval '29 days')`,[A.userId,connectionId,SA]);
  }
  it("erases old upload details and expired OAuth requests without contacting Google; preserves duplicate protection",async()=>{
    const c=await connect();await oldUpload(c.id);await start();
    await pg.exec("update shorts_mvp.youtube_account_oauth set expires_at=now()-interval '1 second'");
    const fetcher=vi.fn();const result=await retention(fetcher).run();
    expect(result).toMatchObject({erasedUploadDetails:1,expiredAuthorizations:1,checked:0});expect(fetcher).not.toHaveBeenCalled();
    const row=(await pg.query('select * from shorts_mvp.youtube_account_uploads')).rows[0];
    expect(row).toMatchObject({status:'expired',title:'',state_ciphertext:'',video_id:null,actual_privacy:null,requested_privacy:null,privacy_checked_at:null,lease_id:null});
    const uploads=new YoutubeAccountUploads(tag(pg),store,service,vault,{clientId:'test',clientSecret:'test'},uploadRoot,fetcher);
    await expect(uploads.create(A,{shortId:SA,connectionId:c.id,title:'again',description:'',madeForKids:false,synthetic:false})).rejects.toMatchObject({status:410});
    expect(fetcher).not.toHaveBeenCalled();
    expect(await retention().run()).toMatchObject({erasedUploadDetails:0});
  });
  it("does not expose or resume expired metadata even before the scheduled job runs",async()=>{
    const c=await connect();await oldUpload(c.id);const fetcher=vi.fn();
    const uploads=new YoutubeAccountUploads(tag(pg),store,service,vault,{clientId:'test',clientSecret:'test'},uploadRoot,fetcher);
    expect((await uploads.list(A,SA))[0]).toMatchObject({status:'expired',videoId:null,actualPrivacy:null});
    expect(JSON.stringify(await uploads.list(A,SA))).not.toContain('sensitive title');
    await expect(uploads.run(A,'88888888-8888-4888-8888-888888888888')).rejects.toMatchObject({status:410});expect(fetcher).not.toHaveBeenCalled();
  });
  it("refreshes due channel metadata and authorization while preserving inactivity time",async()=>{
    await connect();await pg.exec("update shorts_mvp.youtube_account_links set next_check_at=now()-interval '1 second',verified_at=now()-interval '2 days',last_used_at=now()-interval '2 days'");
    expect(await retention().run()).toMatchObject({checked:1,refreshed:1});
    const row=(await pg.query<{channel_title:string;idle:boolean;fresh:boolean}>("select channel_title,last_used_at<now()-interval '1 day' as idle,verified_at>now()-interval '1 minute' as fresh from shorts_mvp.youtube_account_links")).rows[0];
    expect(row).toEqual({channel_title:'Updated channel',idle:true,fresh:true});
    expect(await retention().run()).toMatchObject({checked:0});
  });
  it("definitive invalid_grant deletes only the affected app user's publishing data",async()=>{
    await connect();await connect(B);await start();
    await pg.query("update shorts_mvp.youtube_account_links set next_check_at=now()-interval '1 second' where user_id=$1",[A.userId]);
    const job=retention(async()=>Response.json({error:'invalid_grant'},{status:400}));
    expect(await job.run()).toMatchObject({removed:1});
    expect(await service.list(A)).toEqual([]);expect(await service.list(B)).toHaveLength(1);
    expect((await pg.query('select * from shorts_mvp.youtube_account_oauth')).rows).toEqual([]);
  });
  it("transient provider failures do not delete or extend metadata lifetime",async()=>{
    await connect();await pg.exec("update shorts_mvp.youtube_account_links set next_check_at=now()-interval '1 second',verified_at=now()-interval '2 days'");
    const result=await retention(async()=>Response.json({error:'backendError'},{status:503})).run();
    expect(result).toMatchObject({retry:1,removed:0,refreshed:0});
    expect((await pg.query("select verified_at<now()-interval '1 day' as old from shorts_mvp.youtube_account_links")).rows[0]).toEqual({old:true});
    expect(await service.list(A)).toHaveLength(1);
  });
  it("a successful refresh never schedules the next check past the inactivity deletion deadline",async()=>{
    await connect();await pg.exec("update shorts_mvp.youtube_account_links set next_check_at=now()-interval '1 second',last_used_at=now()-interval '28 days 23 hours 50 minutes'");
    expect(await retention().run()).toMatchObject({refreshed:1});
    expect((await pg.query("select next_check_at<=last_used_at+interval '29 days' as bounded from shorts_mvp.youtube_account_links")).rows[0]).toEqual({bounded:true});
  });
  it.each(['verified_at','last_used_at'])("erases a connection at the %s hard limit even during provider outage",async column=>{
    await connect();await pg.exec(`update shorts_mvp.youtube_account_links set ${column}=now()-interval '29 days',next_check_at=now()-interval '1 second'`);
    const fetcher=vi.fn();expect(await retention(fetcher).run()).toMatchObject({removed:1});expect(fetcher).not.toHaveBeenCalled();expect(await service.list(A)).toEqual([]);
  });
  it("a stale provider result cannot delete a newly reconnected grant",async()=>{
    await connect();await pg.exec("update shorts_mvp.youtube_account_links set next_check_at=now()-interval '1 second'");
    expect(await retention(async()=>{await connect();return Response.json({error:'invalid_grant'},{status:400});}).run()).toMatchObject({superseded:1,removed:0});
    expect(await service.list(A)).toHaveLength(1);
  });
  it("withdrawal deletes publishing data atomically before provider revocation and fences late callbacks",async()=>{
    const c=await connect();await oldUpload(c.id);await connect(B);const pending=await start();
    const seen:string[]=[];
    const google=new YoutubeAccountGoogle({clientId:'test',clientSecret:'test',redirectUri:'http://localhost'},async()=>{
      expect((await pg.query('select id from shorts_mvp.youtube_account_links where user_id=$1',[A.userId])).rows).toEqual([]);
      seen.push('revoke');return new Response(null,{status:200});
    });
    const revoker=new YoutubeAccounts(store,vault,google,async()=>{});
    expect(await withYoutubeWithdrawal(tag(pg),A.userId,{store,service:revoker},async tx=>{await tx`update shorts_mvp.app_users set withdrawn_at=now() where id=${A.userId}`;})).toBe('revoked');
    expect(seen).toEqual(['revoke']);expect(await service.list(B)).toHaveLength(1);
    await expect(callback(pending)).rejects.toThrow();await expect(start()).rejects.toThrow();
    expect((await pg.query('select * from shorts_mvp.youtube_account_uploads')).rows).toEqual([]);
  });
  it("a failed withdrawal transaction retains all publishing data and never revokes Google",async()=>{
    await connect();const before=googleCalls;
    await expect(withYoutubeWithdrawal(tag(pg),A.userId,{store,service},async()=>{throw Error('rollback');})).rejects.toThrow('rollback');
    expect(await service.list(A)).toHaveLength(1);expect(googleCalls).toBe(before);
  });
  it("provider failure cannot undo completed withdrawal or retain credentials",async()=>{
    await connect();providerFails=true;
    expect(await withYoutubeWithdrawal(tag(pg),A.userId,{store,service},async tx=>{await tx`update shorts_mvp.app_users set withdrawn_at=now() where id=${A.userId}`;})).toBe('manual_required');
    expect((await pg.query('select * from shorts_mvp.youtube_account_links')).rows).toEqual([]);
  });
  it("a direct soft withdrawal also purges data; restoring the account cannot restore tokens",async()=>{
    await connect();await pg.query('update shorts_mvp.app_users set withdrawn_at=now() where id=$1',[A.userId]);
    expect((await pg.query('select * from shorts_mvp.youtube_account_links')).rows).toEqual([]);
    await pg.query('update shorts_mvp.app_users set withdrawn_at=null where id=$1',[A.userId]);
    expect(await service.list(A)).toEqual([]);
  });
  it("expiry aborts an in-flight upload and cannot restore erased encrypted state",async()=>{
    const c=await connect();let entered!:()=>void;let aborted=false;
    const ready=new Promise<void>(resolve=>{entered=resolve;});
    const uploads=new YoutubeAccountUploads(tag(pg),store,service,vault,{clientId:'test',clientSecret:'test'},uploadRoot,async(_url,init)=>{
      entered();return new Promise<Response>((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));},{once:true});});
    });
    const running=uploads.create(A,{shortId:SA,connectionId:c.id,title:'test',description:'',madeForKids:false,synthetic:false});
    await ready;await pg.exec("update shorts_mvp.youtube_account_uploads set created_at=now()-interval '29 days'");
    expect(await retention().run()).toMatchObject({erasedUploadDetails:1});
    expect(await running).toMatchObject({status:'expired',videoId:null});expect(aborted).toBe(true);
    expect((await pg.query('select state_ciphertext,lease_id from shorts_mvp.youtube_account_uploads')).rows[0]).toEqual({state_ciphertext:'',lease_id:null});
  });
  it("withdrawal during a maintenance request cannot recreate a channel",async()=>{
    await connect();await pg.exec("update shorts_mvp.youtube_account_links set next_check_at=now()-interval '1 second'");
    const result=await retention(async()=>{await pg.query('update shorts_mvp.app_users set withdrawn_at=now() where id=$1',[A.userId]);return Response.json({error:'invalid_grant'},{status:400});}).run();
    expect(result).toMatchObject({superseded:1,removed:0});expect((await pg.query('select * from shorts_mvp.youtube_account_links')).rows).toEqual([]);
  });
});

describe("hosted reviewer source boundary", () => {
  it("awaits administrator role checks and still enforces source ownership", async () => {
    let allowed = true;
    const guarded = new YoutubeAccountStore(tag(pg), async () => {
      await Promise.resolve();
      if (!allowed) throw Error("Admin access removed");
    });
    expect((await guarded.source(A.userId, SA)).id).toBe(SA);
    await expect(guarded.source(A.userId, SB)).rejects.toMatchObject({ status: 404 });
    await expect(guarded.source(A.userId, MISMATCH)).rejects.toMatchObject({ status: 404 });
    allowed = false;
    await expect(guarded.source(A.userId, SA)).rejects.toThrow("Admin access removed");
    await expect(guarded.start(A, { returnPath: "/projects/1", shortId: SA }, "b".repeat(64), "encrypted")).rejects.toThrow("Admin access removed");
    expect((await pg.query("select * from shorts_mvp.youtube_account_oauth")).rows).toEqual([]);
  });

  it("rejects other owned clips, wrong users and soft-deleted projects before publication", async () => {
    const guarded = new YoutubeAccountStore(tag(pg), (userId, shortId) => { if (userId !== A.userId || shortId !== SA) throw new Error("Review grant denied"); });
    expect((await guarded.source(A.userId,SA)).id).toBe(SA);
    await expect(guarded.source(B.userId,SB)).rejects.toThrow();
    await expect(guarded.source(A.userId,SB)).rejects.toThrow();
    await pg.exec(`update shorts_mvp.video_jobs set user_deleted_at=now() where id='${JA}'`);
    await expect(guarded.source(A.userId,SA)).rejects.toMatchObject({status:404});
  });
  it("rechecks the grant when an OAuth callback returns after access was removed", async () => {
    let allowed = true;
    const guarded = new YoutubeAccountStore(tag(pg), () => { if (!allowed) throw Error("Expired review access"); });
    const state = 'a'.repeat(64);
    await guarded.start(A,{returnPath:'/projects/1',shortId:SA},state,'encrypted');
    const pending = await guarded.consume(A,state);
    allowed = false;
    await expect(guarded.finish(pending,[{channelId:CHANNEL_A,channelTitle:'Test',ciphertext:'cipher'}],SCOPES)).rejects.toThrow();
    expect(await guarded.list(A.userId)).toEqual([]);
  });
});

it("loads attribution only for the owner's source and ignores stale catalogue licenses", async () => {
  await pg.exec(`truncate shorts_mvp.youtube_catalog; update shorts_mvp.video_jobs set youtube_video_id='F-Dp78NJwlU',video_title='Original',channel_name='Source channel',youtube_metadata_verified_at=now() where id='${JA}';
    insert into shorts_mvp.youtube_catalog values ('F-Dp78NJwlU','{"title":"Original","channelName":"Source channel","license":"creativeCommon"}','public',now(),null);`);
  expect(await sourceAttribution(tag(pg), A.userId, SA)).toMatchObject({title:"Original",author:"Source channel",ccBy:true,url:"https://www.youtube.com/watch?v=F-Dp78NJwlU"});
  expect(await sourceAttribution(tag(pg), B.userId, SA)).toBeNull();
  vi.stubEnv("YOUTUBE_API_KEY", "");
  try {
    await pg.exec("update shorts_mvp.youtube_catalog set verified_at=now()-interval '31 days'");
    expect(await sourceAttribution(tag(pg), A.userId, SA)).toMatchObject({ccBy:false});
  } finally { vi.unstubAllEnvs(); }
});
