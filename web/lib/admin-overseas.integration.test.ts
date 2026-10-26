import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
import type { Sql } from "postgres";
vi.mock("server-only",()=>({}));
const auth = vi.hoisted(()=>vi.fn());
vi.mock("@/lib/admin-overseas-auth",()=>({requireOverseasAdminUser:auth}));
vi.mock("@/lib/db",()=>({getDb:()=>sql}));
import { loadAdminOverseas } from "./admin-overseas";
import { overseasFilters } from "./admin-overseas-contract";

type Fragment = {strings:TemplateStringsArray; values:unknown[]};
let pg:PGlite;
let reads=0;
function compile(fragment:Fragment, values:unknown[]=[]): {text:string;values:unknown[]} {
  let text=fragment.strings[0];
  fragment.values.forEach((value,index)=>{
    if (value && typeof value==="object" && "strings" in value) text+=compile(value as Fragment,values).text;
    else {values.push(value);text+=`$${values.length}`;}
    text+=fragment.strings[index+1];
  });
  return {text,values};
}
const sql = ((strings:TemplateStringsArray,...values:unknown[])=>({strings,values,
  then: (resolve:(rows:unknown[])=>void,reject:(error:unknown)=>void)=>{
    reads++;
    const query=compile({strings,values});
    return pg.query<Record<string,unknown>>(query.text,query.values).then(({rows})=>resolve(rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),v])))),reject);
  },
})) as unknown as Sql;
const uid = (n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
async function member(n:number,language:string|null="en",name="Alex",country:string|null=null) {
  await pg.query("insert into shorts_mvp.app_users values($1,$2,$3,now(),null,false,$4)",[uid(n),`person${n}@example.com`,name,country]);
  if(language!==null) await pg.query("insert into shorts_mvp.video_jobs values($1,$1,'A video',$2,'completed',now())",[uid(n),language]);
}
beforeAll(async()=>{
  pg=new PGlite();
  await pg.exec(`create schema shorts_mvp;
    create table shorts_mvp.admin_role_assignments(user_id uuid,role text);
    create table shorts_mvp.app_users(id uuid primary key,email text,display_name text,created_at timestamptz,withdrawn_at timestamptz,is_admin boolean,country_code text);
    create table shorts_mvp.video_jobs(id uuid primary key,user_id uuid,video_title text,output_language text,status text,created_at timestamptz);
    create table shorts_mvp.customer_inquiries(id uuid primary key,user_id uuid,contact_email text,locale text,message text,page_path text,status text,created_at timestamptz);
    create table shorts_mvp.billing_orders(user_id uuid,provider text);
    create table shorts_mvp.billing_payment_methods(user_id uuid,provider text);
    create table shorts_mvp.user_subscriptions(user_id uuid,payment_provider text);
    create table shorts_mvp.project_feedback_responses(user_id uuid,improvement_text text);
    create table shorts_mvp.subscription_cancellation_feedback(user_id uuid,detail text,message text,alternative_service text);
    create table shorts_mvp.paddle_subscriptions(paddle_id text primary key,user_id uuid,environment text,provider_status text);
    create table shorts_mvp.paddle_payments(transaction_id text primary key,paddle_subscription_id text,user_id uuid,currency text,amount_minor bigint,created_at timestamptz,plan_code text);
    create table shorts_mvp.paddle_adjustments(transaction_id text,amount_minor bigint,action text,status text);`);
});
afterAll(async()=>{await pg.close();});
beforeEach(async()=>{
  auth.mockReset();auth.mockResolvedValue({id:uid(999)});reads=0;
  await pg.exec(`truncate shorts_mvp.admin_role_assignments,shorts_mvp.app_users,shorts_mvp.video_jobs,shorts_mvp.customer_inquiries,shorts_mvp.billing_orders,shorts_mvp.billing_payment_methods,shorts_mvp.user_subscriptions,shorts_mvp.project_feedback_responses,shorts_mvp.subscription_cancellation_feedback,shorts_mvp.paddle_subscriptions,shorts_mvp.paddle_payments,shorts_mvp.paddle_adjustments;`);
});
describe("overseas administrator isolation",()=>{
  it("rejects unauthorized reads before touching data",async()=>{
    auth.mockRejectedValue(new Error("forbidden"));await expect(loadAdminOverseas({})).rejects.toThrow("forbidden");expect(reads).toBe(0);
  });
  it("keeps mixed Korean and unknown accounts out of every tab, metric and search",async()=>{
    await member(1);await member(2,"ja");await member(3,null);
    await member(4,"en","Kim","KR");await member(5,"en","한글 이름");
    for(let n=6;n<=16;n++) await member(n);
    await pg.exec(`insert into shorts_mvp.billing_orders values('${uid(6)}','toss');
      insert into shorts_mvp.billing_payment_methods values('${uid(7)}','thepayone');
      insert into shorts_mvp.user_subscriptions values('${uid(8)}','nicepay');
      insert into shorts_mvp.video_jobs values('${uid(99)}','${uid(9)}','Other','ko','completed',now());
      insert into shorts_mvp.customer_inquiries values('${uid(10)}','${uid(10)}','person10@example.com','ko','Korean locale','/','new',now());
      insert into shorts_mvp.customer_inquiries values('${uid(11)}',null,'PERSON11@example.com','en','한국어 문의','/en','new',now());
      insert into shorts_mvp.project_feedback_responses values('${uid(12)}','불편합니다');
      insert into shorts_mvp.subscription_cancellation_feedback values('${uid(13)}','한국어',null,null);
      update shorts_mvp.app_users set email='member@example.co.kr' where id='${uid(14)}';
      update shorts_mvp.app_users set is_admin=true where id='${uid(15)}';
      update shorts_mvp.app_users set withdrawn_at=now() where id='${uid(16)}';`);
    for(const tab of ["overview","members","billing","projects"]){
      const result=await loadAdminOverseas({tab});expect(result.metrics.members).toBe(2);expect(result.metrics.projects).toBe(2);
      expect(result.rows.every(row=>[uid(1),uid(2)].includes(row.id))).toBe(true);
      expect((await loadAdminOverseas({tab,q:"person6"})).total).toBe(0);
    }
  });
  it("requires positive international evidence and excludes sandbox-only users",async()=>{
    await member(1,null);await member(2,null);await member(3,null);
    await pg.exec(`insert into shorts_mvp.paddle_subscriptions values('live','${uid(1)}','live','active'),('test','${uid(2)}','sandbox','active');
      insert into shorts_mvp.customer_inquiries values('${uid(3)}','${uid(3)}','person3@example.com','ja','Please help me','/ja','new',now());`);
    const result=await loadAdminOverseas({tab:"members"});expect(result.metrics).toEqual({members:2,activeSubscriptions:1,projects:0,recentProjects:0});expect(result.rows.map(row=>row.email)).toContain("person3@example.com");
  });
  it("scopes native currency totals, refunds, chargebacks and payment details",async()=>{
    await member(1);await member(2,"ko");
    await pg.exec(`insert into shorts_mvp.paddle_subscriptions values('good','${uid(1)}','live','active'),('bad','${uid(2)}','live','active'),('test','${uid(1)}','sandbox','active');
      insert into shorts_mvp.paddle_payments values('usd','good','${uid(1)}','USD',399,now(),'paddle_lite'),('yen','good','${uid(1)}','JPY',590,now(),'paddle_lite'),('hidden','bad','${uid(2)}','JPY',100000,now(),'paddle_lite'),('sandbox','test','${uid(1)}','USD',100000,now(),'paddle_lite');
      insert into shorts_mvp.paddle_adjustments values('usd',100,'refund','approved'),('usd',50,'refund','pending_approval'),('yen',999,'chargeback','approved');`);
    const result=await loadAdminOverseas({tab:"billing"});expect(result.total).toBe(2);expect(result.metrics.activeSubscriptions).toBe(1);
    expect(result.sales).toEqual([{currency:"USD",gross:399,refunded:100,chargeback:0,pending:50,today:399,orders:1},{currency:"JPY",gross:590,refunded:0,chargeback:590,pending:0,today:590,orders:1}]);
  });
  it("paginates after exclusion and treats wildcard search literally",async()=>{
    for(let n=1;n<=34;n++)await member(n);
    const first=await loadAdminOverseas({tab:"members"});const next=await loadAdminOverseas({tab:"members",page:"2"});
    expect(first.total).toBe(34);expect(first.rows).toHaveLength(30);expect(next.rows).toHaveLength(4);expect(new Set([...first.rows,...next.rows].map(row=>row.id)).size).toBe(34);
    expect((await loadAdminOverseas({page:"9999"})).filters.page).toBe(2);
    expect((await loadAdminOverseas({q:"%"})).total).toBe(0);
    expect((await loadAdminOverseas({q:"' or true --"})).total).toBe(0);
    expect(overseasFilters({tab:"settings",page:"-1",scope:"all"})).toMatchObject({tab:"overview",page:1});
  });
});
