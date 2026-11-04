import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
const db = new PGlite();
const oldOperation = randomUUID();
const owner = randomUUID(), other = randomUUID(), project = randomUUID(), grant = randomUUID();
beforeAll(async () => {
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema shorts_mvp;
 create table shorts_mvp.app_users(id uuid primary key,manual_service_access_until timestamptz);
 create table shorts_mvp.user_subscriptions(user_id uuid,status text,current_period_start timestamptz,current_period_end timestamptz);
 create table shorts_mvp.enterprise_service_entitlements(app_user_id uuid,usage_grant_id uuid,starts_at timestamptz,ends_at timestamptz);
 create table shorts_mvp.ranking_projects(id uuid primary key,user_id uuid,deleted_at timestamptz,expires_at timestamptz);
 create table shorts_mvp.ranking_operations(id uuid primary key,project_id uuid,action text,status text);
 create table shorts_mvp.usage_reservations(id uuid primary key default gen_random_uuid(),mvp_session_id uuid not null,job_id uuid not null unique,user_id uuid,source_duration_seconds integer not null check(source_duration_seconds between 1 and 3600),status text not null default 'reserved',created_at timestamptz default now(),consumed_at timestamptz,released_at timestamptz);
 create table shorts_mvp.usage_grants(id uuid primary key,user_id uuid,kind text,product_code text,total_seconds integer,reserved_seconds integer default 0,consumed_seconds integer default 0,valid_from timestamptz default now()-interval '1 day',expires_at timestamptz default now()+interval '1 day',status text default 'active',funding_source text,created_at timestamptz default now(),updated_at timestamptz default now(),check(reserved_seconds>=0 and consumed_seconds>=0 and total_seconds>=reserved_seconds+consumed_seconds));
 create table shorts_mvp.usage_grant_allocations(reservation_id uuid references shorts_mvp.usage_reservations(id),grant_id uuid,allocated_seconds integer,status text default 'reserved',updated_at timestamptz default now(),unique(reservation_id,grant_id));`);
 await db.exec(await readFile(new URL('./__fixtures__/ranking-usage-baseline.sql',import.meta.url),'utf8'));
 await db.exec(`create trigger usage_reservations_apply_grants after update of status on shorts_mvp.usage_reservations for each row execute function shorts_mvp.apply_usage_reservation_transition();`);
 await db.exec(await readFile('../supabase/migrations/20261027084819_ranking_fixed_usage.sql','utf8'));
 await db.query("insert into shorts_mvp.app_users values($1,null),($2,null)",[owner,other]);
 await db.query("insert into shorts_mvp.ranking_projects values($1,$2,null,now()+interval '1 day')",[project,owner]);
 await db.query("insert into shorts_mvp.usage_grants(id,user_id,kind,product_code,total_seconds,funding_source) values($1,$2,'addon','onboarding_welcome_20min_v1',3000,'complimentary')",[grant,owner]);
 await db.query("insert into shorts_mvp.ranking_operations values($1,$2,'render','running')",[oldOperation,project]);
 await reserve(oldOperation);
 await db.exec(await readFile('../supabase/migrations/20261104183438_ranking_three_minute_usage.sql','utf8'));
},30000);
afterAll(async()=>db.close());
async function operation(action='render') {const id=randomUUID();await db.query("insert into shorts_mvp.ranking_operations values($1,$2,$3,'running')",[id,project,action]);return id;}
async function reserve(id:string,user=owner,enterprise=false) {return db.query("select shorts_mvp.reserve_ranking_render_usage($1,$2,$3)",[id,user,enterprise]);}
async function status(id:string,value:string) {await db.query("update shorts_mvp.ranking_operations set status=$2 where id=$1",[id,value]);}
async function balance() {return (await db.query<{reserved_seconds:number;consumed_seconds:number}>("select reserved_seconds,consumed_seconds from shorts_mvp.usage_grants where id=$1",[grant])).rows[0];}
it('preserves a reservation accepted at the old five-minute price',async()=>{
 expect((await db.query("select source_duration_seconds from shorts_mvp.usage_reservations where ranking_operation_id=$1",[oldOperation])).rows).toEqual([{source_duration_seconds:300}]);
 const before=await balance();await reserve(oldOperation);expect(await balance()).toEqual(before);
 await status(oldOperation,'succeeded');
 expect(await balance()).toEqual({reserved_seconds:before.reserved_seconds-300,consumed_seconds:before.consumed_seconds+300});
});
it('reserves 180 once across concurrent duplicate calls and consumes once on success',async()=>{
 const before=await balance(),id=await operation();await Promise.all([reserve(id),reserve(id)]);
 expect(await balance()).toEqual({...before,reserved_seconds:before.reserved_seconds+180});
 await status(id,'succeeded');await status(id,'succeeded');
 expect(await balance()).toEqual({...before,consumed_seconds:before.consumed_seconds+180});
 await db.query('delete from shorts_mvp.ranking_operations where id=$1',[id]);
 expect((await db.query("select status from shorts_mvp.usage_reservations where ranking_operation_id=$1",[id])).rows).toEqual([{status:'consumed'}]);
});
it('releases failure exactly once; a fresh successful retry charges only once',async()=>{
 const before=await balance(),id=await operation();await reserve(id);await status(id,'failed');await status(id,'failed');expect(await balance()).toEqual(before);
 const retry=await operation();await reserve(retry);await status(retry,'succeeded');expect(await balance()).toEqual({...before,consumed_seconds:before.consumed_seconds+180});
});
it('rejects other owners, previews and imports without allocating usage',async()=>{
 const before=await balance();await expect(reserve(await operation(),other)).rejects.toThrow('Invalid ranking');
 for(const action of ['preview','import']) await expect(reserve(await operation(action))).rejects.toThrow('Invalid ranking');
 expect(await balance()).toEqual(before);
});
it('does not retroactively charge existing renders and releases an unfinished purged operation',async()=>{
 const before=await balance();await status(await operation(),'succeeded');expect(await balance()).toEqual(before);
 const id=await operation();await reserve(id);await db.query('delete from shorts_mvp.ranking_operations where id=$1',[id]);expect(await balance()).toEqual(before);
});
it('retains required longform job/session fields and enforces fixed ranking price',async()=>{
 await expect(db.query("insert into shorts_mvp.usage_reservations(user_id,source_duration_seconds) values($1,300)",[owner])).rejects.toThrow();
 await expect(db.query("insert into shorts_mvp.usage_reservations(user_id,source_duration_seconds,ranking_operation_id) values($1,299,$2)",[owner,randomUUID()])).rejects.toThrow();
 const id=randomUUID();await db.query("insert into shorts_mvp.usage_reservations(id,user_id,job_id,mvp_session_id,source_duration_seconds) values($1,$2,$3,$4,60)",[id,owner,randomUUID(),randomUUID()]);
 await db.query("select shorts_mvp.reserve_usage_grants($1,$2,60)",[owner,id]);await db.query("update shorts_mvp.usage_reservations set status='released' where id=$1",[id]);
});
it('uses enterprise entitlement grants and blocks public execution',async()=>{
 const id=await operation();await expect(reserve(id,owner,true)).rejects.toThrow('기업 서비스 기간');
 await db.query("insert into shorts_mvp.enterprise_service_entitlements values($1,$2,now()-interval '1 day',now()+interval '1 day')",[owner,grant]);
 const before=await balance();await reserve(id,owner,true);await status(id,'failed');expect(await balance()).toEqual(before);
 expect((await db.query("select has_function_privilege('authenticated','shorts_mvp.reserve_ranking_render_usage(uuid,uuid,boolean)','EXECUTE') as allowed")).rows).toEqual([{allowed:false}]);
});
it('rolls back insufficient admission and prevents two jobs spending the last three minutes',async()=>{
 const before=await balance();await db.query('update shorts_mvp.usage_grants set total_seconds=consumed_seconds+179 where id=$1',[grant]);
 const id=await operation();await expect(reserve(id)).rejects.toThrow('부족');expect(await balance()).toEqual(before);
 expect((await db.query('select id from shorts_mvp.usage_reservations where ranking_operation_id=$1',[id])).rows).toHaveLength(0);
 await db.query('update shorts_mvp.usage_grants set total_seconds=consumed_seconds+180 where id=$1',[grant]);
 const a=await operation(),b=await operation();const results=await Promise.allSettled([reserve(a),reserve(b)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await balance()).reserved_seconds).toBe(180);
 await status(a,'failed');await status(b,'failed');expect(await balance()).toEqual(before);
});
