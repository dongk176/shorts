import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
it("admits ordinary-account work without exposing routes or using reserved longform capacity", async () => {
 const db=new PGlite();
 const owner="00000000-0000-4000-8000-000000000001", project="00000000-0000-4000-8000-000000000002", operation="00000000-0000-4000-8000-000000000003";
 try {
  await db.exec(`create role anon;create role authenticated;create schema shorts_mvp;create schema shorts_ranking_runtime;
   create table shorts_mvp.app_users(id uuid primary key,is_admin boolean);
   create table shorts_mvp.ranking_projects(id uuid primary key,user_id uuid,deleted_at timestamptz,expires_at timestamptz);
   create table shorts_mvp.ranking_operations(id uuid primary key,project_id uuid,status text,task_id text,executor text);
   create table shorts_mvp.ingestion_route_slots(route_id text primary key,enabled boolean,egress_class text,leased_job_id uuid,ranking_operation_id uuid,ranking_lease_expires_at timestamptz,cooldown_until timestamptz,quality_reset_at timestamptz,last_leased_at timestamptz);
   create table shorts_mvp.ranking_route_attempts(route_id text,created_at timestamptz,result text);
   create function shorts_mvp.ingestion_route_quality(text) returns table(quality_tier int,success_rate float) language sql as 'select 1,1.0::float';`);
  await db.exec(await readFile('../supabase/migrations/20261027072203_ranking_public_beta_routes.sql','utf8'));
  await db.query("insert into shorts_mvp.app_users values($1,false)",[owner]);
  await db.query("insert into shorts_mvp.ranking_projects values($1,$2,null,now()+interval '1 day')",[project,owner]);
  await db.query("insert into shorts_mvp.ranking_operations values($1,$2,'running','task','vercel')",[operation,project]);
  await db.exec("insert into shorts_mvp.ingestion_route_slots(route_id,enabled,egress_class) select 'r'||n,true,'webshare_isp' from generate_series(1,3) n");
  const claim=async(task='task')=>(await db.query<{route:string|null}>("select shorts_ranking_runtime.claim_route_beta($1,$2,array['r1','r2','r3'],array[]::text[]) as route",[operation,task])).rows[0].route;
  expect(await claim('wrong-task')).toBeNull();expect(await claim()).toBe('r1');expect(await claim()).toBe('r1');
  await db.exec("update shorts_mvp.ingestion_route_slots set ranking_operation_id=null,ranking_lease_expires_at=null;delete from shorts_mvp.ingestion_route_slots where route_id='r3'");
  expect(await claim()).toBeNull();
  expect((await db.query<{allowed:boolean}>("select has_function_privilege('authenticated','shorts_ranking_runtime.claim_route_beta(uuid,text,text[],text[])','EXECUTE') as allowed")).rows[0].allowed).toBe(false);
  await db.exec("update shorts_mvp.ranking_projects set deleted_at=now()");expect(await claim()).toBeNull();
 } finally {await db.close();}
},30000);
