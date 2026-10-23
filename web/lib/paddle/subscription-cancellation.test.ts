import { PGlite } from "../../../test-tools/node_modules/@electric-sql/pglite";
import { readFileSync } from "node:fs";
import type { Sql } from "postgres";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./api",()=>({paddleRequest:vi.fn()}));
vi.mock("./config",()=>({paddleEnvironment:()=>"sandbox"}));
import { paddleRequest } from "./api";
import { cancelPaddleSubscription } from "./service";
const user="00000000-0000-4000-8000-000000000001",sub="00000000-0000-4000-8000-000000000002";
const feedback={reason:"price" as const,detail:"",message:"Thank you",alternativeService:"",alternativeUndecided:false};
let pg:PGlite;
function tag(engine:Pick<PGlite,"query">):Sql {
  const query=async(parts:TemplateStringsArray,...values:unknown[])=>{
    if(parts.join("").includes("pg_advisory_xact_lock")) return [];
    const result=await engine.query<Record<string,unknown>>(parts.reduce((s,p,i)=>s+(i?`$${i}`:"")+p,""),values);
    return result.rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k.replace(/_([a-z])/g,(_,l)=>l.toUpperCase()),v])));
  };
  return Object.assign(query,{begin:(fn:(tx:Sql)=>Promise<unknown>)=>pg.transaction(tx=>fn(tag(tx)))}) as unknown as Sql;
}
beforeEach(async()=>{
  vi.mocked(paddleRequest).mockReset();pg=new PGlite();
  await pg.exec(`create schema shorts_mvp;create role anon;create role authenticated;create role service_role;
  create table shorts_mvp.app_users(id uuid primary key);
  create table shorts_mvp.user_subscriptions(id uuid primary key,user_id uuid,payment_provider text,plan_code text,billing_cycle text,status text,cancel_at_period_end boolean,canceled_at timestamptz,current_period_end timestamptz,next_charge_at timestamptz,updated_at timestamptz);
  create table shorts_mvp.paddle_subscriptions(paddle_id text,customer_id text,subscription_id uuid,user_id uuid,environment text,created_at timestamptz,provider_status text,provider_updated_at timestamptz);
  create table shorts_mvp.paddle_plan_changes(id uuid,paddle_subscription_id text,status text);
  insert into shorts_mvp.app_users values('${user}');
  insert into shorts_mvp.user_subscriptions values('${sub}','${user}','paddle','test','monthly','active',false,null,'2027-01-01',null,null);
  insert into shorts_mvp.paddle_subscriptions values('sub_test','ctm_test','${sub}','${user}','sandbox',now(),'active','2026-10-01');`);
  await pg.exec(readFileSync(new URL("../../../supabase/migrations/20261023095737_subscription_cancellation_feedback.sql",import.meta.url),"utf8"));
});
afterEach(async()=>{await pg.close();});
const subscription={id:"sub_test",customer_id:"ctm_test",status:"active",updated_at:"2026-10-23T00:00:00Z",scheduled_change:null,next_billed_at:"2027-01-01T00:00:00Z"};
it("keeps paid access, records feedback, and never repeats an already scheduled provider cancellation",async()=>{
  const canceled={...subscription,scheduled_change:{action:"cancel",effective_at:"2027-01-01T00:00:00Z"},next_billed_at:null};
  vi.mocked(paddleRequest).mockResolvedValueOnce(subscription).mockResolvedValueOnce(canceled).mockResolvedValueOnce(canceled);
  await cancelPaddleSubscription(user,feedback,tag(pg));
  expect(paddleRequest).toHaveBeenCalledWith('/subscriptions/sub_test/cancel',{effective_from:'next_billing_period'});
  await cancelPaddleSubscription(user,feedback,tag(pg));
  expect(vi.mocked(paddleRequest).mock.calls.filter(([path])=>path.endsWith('/cancel'))).toHaveLength(1);
  const row=(await pg.query<{status:string;cancel_at_period_end:boolean}>("select * from shorts_mvp.user_subscriptions")).rows[0];
  expect(row.status).toBe('active');expect(row.cancel_at_period_end).toBe(true);
  expect((await pg.query("select * from shorts_mvp.subscription_cancellation_feedback")).rows).toHaveLength(1);
  // Provider-portal resumption can leave the old cancellation timestamp locally.
  await pg.exec("update shorts_mvp.user_subscriptions set cancel_at_period_end=false");
  vi.mocked(paddleRequest).mockResolvedValueOnce(subscription).mockResolvedValueOnce(canceled);
  await cancelPaddleSubscription(user,feedback,tag(pg));
  expect((await pg.query("select * from shorts_mvp.subscription_cancellation_feedback")).rows).toHaveLength(2);
});
it("rejects ownership mismatch before any provider call",async()=>{
  await expect(cancelPaddleSubscription('00000000-0000-4000-8000-000000000099',feedback,tag(pg))).rejects.toThrow('No active');
  expect(paddleRequest).not.toHaveBeenCalled();
});
it("does not save or report cancellation when provider confirmation fails",async()=>{
  vi.mocked(paddleRequest).mockResolvedValueOnce(subscription).mockRejectedValueOnce(new Error('timeout'));
  await expect(cancelPaddleSubscription(user,feedback,tag(pg))).rejects.toThrow('timeout');
  expect((await pg.query("select * from shorts_mvp.subscription_cancellation_feedback")).rows).toHaveLength(0);
  expect((await pg.query<{cancel_at_period_end:boolean}>("select cancel_at_period_end from shorts_mvp.user_subscriptions")).rows[0].cancel_at_period_end).toBe(false);
});
