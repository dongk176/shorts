import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
import type { Sql } from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getShortsForJobs } from "./data";
let database: PGlite;
const owner="11111111-1111-4111-8111-111111111111", job="22222222-2222-4222-8222-222222222222";
const short="33333333-3333-4333-8333-333333333333", request="44444444-4444-4444-8444-444444444444";
beforeAll(async()=>{
 database=new PGlite();
 await database.exec(`create schema shorts_mvp;
 create table shorts_mvp.app_users(id uuid primary key,is_admin boolean);
 create table shorts_mvp.video_jobs(id uuid,user_id uuid,is_example boolean,midform_request jsonb,template_snapshot jsonb);
 create table shorts_mvp.generated_shorts(id uuid,user_id uuid,job_id uuid,render_version int);
 create table shorts_mvp.runtime_feature_flags(flag_key text,enabled boolean);
 create table shorts_mvp.admin_short_silence_tasks(short_id uuid,request_id uuid,state text,cut_count int,removed_seconds numeric);
 create table shorts_mvp.editor_render_requests(id uuid,status text);
 insert into shorts_mvp.app_users values('${owner}',false);
 insert into shorts_mvp.video_jobs values('${job}','${owner}',false,null,'{"shortsSilenceRemoval":{"version":1,"preset":"aggressive"}}');
 insert into shorts_mvp.generated_shorts values('${short}','${owner}','${job}',1);
 insert into shorts_mvp.runtime_feature_flags values('admin_shorts_silence',true),('public_shorts_silence',false);`);
});
afterAll(async()=>{await database?.close();});
afterEach(()=>vi.unstubAllEnvs());
function db(){
 return Object.assign(async (strings:TemplateStringsArray|string[])=>{
  if(!("raw" in strings))return strings;
  const query=strings.join("?");
  if(query.includes("select id, job_id, clip_index"))return [{id:short,jobId:job,status:"ready",renderVersion:1,
    templateSnapshot:{shortsSilenceRemoval:{version:1,preset:"aggressive"}},durationSeconds:10}];
  const actual=query.replace("in ?",`in ('${short}')`);
  const result=await database.query(actual);
  return result.rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),value])));
 },{json:(v:unknown)=>v}) as unknown as Sql;
}
describe("ordinary member silence result visibility on the real state query",()=>{
 it("keeps opted-in ordinary results waiting even with new public admission stopped",async()=>{
  vi.stubEnv("ADMIN_SHORTS_SILENCE_ENABLED","true");vi.stubEnv("RANKING_VERCEL_SNAPSHOT_ID","snapshot");
  const result=await getShortsForJobs(db(),[job]);
  expect(result.get(job)?.[0]).toMatchObject({status:"rerendering",silenceRemoval:{status:"waiting",cutCount:0}});
 });
 it("returns completed cut counts for the same non-admin owner",async()=>{
  vi.stubEnv("ADMIN_SHORTS_SILENCE_ENABLED","true");vi.stubEnv("RANKING_VERCEL_SNAPSHOT_ID","snapshot");
  await database.exec(`insert into shorts_mvp.admin_short_silence_tasks values('${short}','${request}','rendering',3,1.5);
    insert into shorts_mvp.editor_render_requests values('${request}','succeeded');update shorts_mvp.generated_shorts set render_version=2;`);
  const result=await getShortsForJobs(db(),[job]);
  expect(result.get(job)?.[0].silenceRemoval).toEqual({status:"completed",cutCount:3,removedSeconds:1.5});
 });
 it("does not attach silence state from a mismatched job owner",async()=>{
  vi.stubEnv("ADMIN_SHORTS_SILENCE_ENABLED","true");vi.stubEnv("RANKING_VERCEL_SNAPSHOT_ID","snapshot");
  await database.exec("update shorts_mvp.video_jobs set user_id='55555555-5555-4555-8555-555555555555'");
  const result=await getShortsForJobs(db(),[job]);expect(result.get(job)?.[0].silenceRemoval).toBeUndefined();
 });
});
