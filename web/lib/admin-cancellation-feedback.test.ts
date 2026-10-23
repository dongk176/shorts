import { readFileSync } from "node:fs";
import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite";
import type { Sql } from "postgres";
import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/lib/admin",()=>({requireAdminUser:vi.fn()}));
import {requireAdminUser} from "@/lib/admin";
import {cancellationFilters,loadAdminCancellationFeedback} from "./admin-cancellation-feedback";
import {AdminCancellationFeedbackDashboard} from "@/app/admin/easycutcutcutcutcutcut/admin-cancellation-feedback";
let pg:PGlite|undefined;
afterEach(async()=>{await pg?.close();pg=undefined;vi.resetAllMocks();});
it("normalizes filters and rejects oversized or invalid paging",()=>{
 expect(cancellationFilters({reason:"invented",period:"-1",page:"1e20",q:" hi "})).toEqual({reason:"all",days:"30",page:1,query:"hi"});
 expect(cancellationFilters({reason:["other"],period:"all",page:"2"}).page).toBe(2);
 expect(cancellationFilters({q:"x".repeat(200)}).query).toHaveLength(100);
});
it("denies non-admins before any survey query",async()=>{
 vi.mocked(requireAdminUser).mockRejectedValue(new Error("Forbidden"));const query=vi.fn();
 await expect(loadAdminCancellationFeedback({},query as unknown as Sql)).rejects.toThrow("Forbidden");expect(query).not.toHaveBeenCalled();
});
it("queries stored answers with literal search, bounded pagination and matching aggregates",async()=>{
 vi.mocked(requireAdminUser).mockResolvedValue({id:"admin",authUserId:"auth",email:"admin@example.test",displayName:null});
 pg=new PGlite();
 await pg.exec(`create schema shorts_mvp;create role anon;create role authenticated;create role service_role;
 create table shorts_mvp.app_users(id uuid primary key,email text,display_name text);
 create table shorts_mvp.user_subscriptions(id uuid primary key);
 create table shorts_mvp.plans(code text primary key,display_name text);
 insert into shorts_mvp.app_users values('00000000-0000-4000-8000-000000000001','member@example.test','Member');
 insert into shorts_mvp.user_subscriptions values('00000000-0000-4000-8000-000000000002');
 insert into shorts_mvp.plans values('plan','Pro');`);
 await pg.exec(readFileSync(new URL('../../supabase/migrations/20261023095737_subscription_cancellation_feedback.sql',import.meta.url),'utf8'));
 await pg.exec(`insert into shorts_mvp.subscription_cancellation_feedback(user_id,subscription_id,payment_provider,plan_code,billing_cycle,reason,message,canceled_at,access_until)
 select '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','toss','plan','monthly','price',case when i=1 then '100% <script>alert(1)</script>' else null end,now()-i*interval '1 second',now()+interval '1 month' from generate_series(1,31) i;
 insert into shorts_mvp.subscription_cancellation_feedback(user_id,subscription_id,payment_provider,plan_code,billing_cycle,reason,alternative_service,canceled_at,access_until,created_at)
 values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','paddle','plan','monthly','alternative','Competitor',now()-interval '60 days',now(),now()-interval '60 days');`);
 type Fragment={text:string;values:unknown[];then:(resolve:(rows:unknown)=>unknown,reject:(error:unknown)=>unknown)=>Promise<unknown>};
 const tag=(parts:TemplateStringsArray,...args:unknown[]):Fragment=>{
  let text="";const values:unknown[]=[];
  parts.forEach((part,i)=>{text+=part;if(i>=args.length)return;const v=args[i];if(v && typeof v==='object' && 'text' in v){const nested=v as Fragment;text+=nested.text.replace(/\$(\d+)/g,(_,n)=>`$${Number(n)+values.length}`);values.push(...nested.values);}else{values.push(v);text+=`$${values.length}`;}});
  return {text,values,then:(resolve,reject)=>pg!.query<Record<string,unknown>>(text,values).then(r=>resolve(r.rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k.replace(/_([a-z])/g,(_,l)=>l.toUpperCase()),v])))),reject)};
 };
 const db=tag as unknown as Sql;
 const first=await loadAdminCancellationFeedback({},db);expect(first.total).toBe(31);expect(first.messages).toBe(1);expect(first.rows).toHaveLength(30);expect(first.pages).toBe(2);expect(first.rows[0].planName).toBe('Pro');
 const last=await loadAdminCancellationFeedback({page:'999'},db);expect(last.filters.page).toBe(2);expect(last.rows).toHaveLength(1);
 const literal=await loadAdminCancellationFeedback({q:'%'},db);expect(literal.total).toBe(1);
 const alternative=await loadAdminCancellationFeedback({period:'all',reason:'alternative',q:'Competitor'},db);expect(alternative.total).toBe(1);expect(alternative.alternatives).toBe(1);
 const html=renderToStaticMarkup(AdminCancellationFeedbackDashboard({data:literal}));expect(html).toContain('운영진에게 전하고 싶은 말');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>alert(1)');
});
