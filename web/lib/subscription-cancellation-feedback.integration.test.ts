import { readFileSync } from "node:fs";
import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite";
import type { Sql } from "postgres";
import { expect, it } from "vitest";
import { saveCancellationFeedback } from "./subscription-cancellation-feedback";

it("stores confirmed reasons and team messages atomically, enforces ownership and retry deduplication", async () => {
  const pg = new PGlite();
  const owner="00000000-0000-4000-8000-000000000001", other="00000000-0000-4000-8000-000000000002", sub="00000000-0000-4000-8000-000000000003";
  try {
    await pg.exec(`create schema shorts_mvp;create role anon;create role authenticated;create role service_role;
      create table shorts_mvp.app_users(id uuid primary key);
      create table shorts_mvp.user_subscriptions(id uuid primary key,user_id uuid,payment_provider text,plan_code text,billing_cycle text,cancel_at_period_end boolean,canceled_at timestamptz,current_period_end timestamptz);
      insert into shorts_mvp.app_users values('${owner}'),('${other}');
      insert into shorts_mvp.user_subscriptions values('${sub}','${owner}','toss','test_plan','monthly',false,null,'2027-01-01');`);
    await pg.exec(readFileSync(new URL("../../supabase/migrations/20261023095737_subscription_cancellation_feedback.sql",import.meta.url),"utf8"));
    const db = (async (parts:TemplateStringsArray,...values:unknown[]) => {
      const result = await pg.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:"")+p,""),values);
      return result.rows;
    }) as unknown as Sql;
    const feedback={reason:"price" as const,detail:"",message:"Please add a smaller plan",alternativeService:"",alternativeUndecided:false};
    await expect(saveCancellationFeedback(db,owner,sub,feedback)).rejects.toThrow("confirmed");
    await pg.exec(`update shorts_mvp.user_subscriptions set cancel_at_period_end=true,canceled_at='2026-10-23';`);
    await expect(saveCancellationFeedback(db,other,sub,feedback)).rejects.toThrow("confirmed");
    await saveCancellationFeedback(db,owner,sub,feedback);
    await saveCancellationFeedback(db,owner,sub,{...feedback,message:"Duplicate"});
    const rows=(await pg.query<{message:string}>("select * from shorts_mvp.subscription_cancellation_feedback")).rows;
    expect(rows).toHaveLength(1);expect(rows[0].message).toBe(feedback.message);
    await pg.exec("begin;update shorts_mvp.user_subscriptions set canceled_at='2026-10-24';");
    await saveCancellationFeedback(db,owner,sub,feedback);
    await pg.exec("rollback;");
    expect((await pg.query("select * from shorts_mvp.subscription_cancellation_feedback")).rows).toHaveLength(1);
    const access=(await pg.query<{anon:boolean;authenticated:boolean}>("select has_table_privilege('anon','shorts_mvp.subscription_cancellation_feedback','SELECT') as anon,has_table_privilege('authenticated','shorts_mvp.subscription_cancellation_feedback','INSERT') as authenticated")).rows[0];
    expect(access).toEqual({anon:false,authenticated:false});
  } finally { await pg.close(); }
});
