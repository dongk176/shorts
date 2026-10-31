import { describe,expect,it,vi } from "vitest";
import { subscriptionProduct,summarizeSubscriptionBilling,type SubscriptionBillingRow } from "./admin-subscription-billing-contract";
vi.mock("server-only",()=>({}));
const { query } = vi.hoisted(()=>({query:vi.fn()}));
vi.mock("@/lib/db",()=>({getDb:()=>query}));
import { loadAdminSubscriptionBilling } from "./admin-subscription-billing";
const rows: SubscriptionBillingRow[]=[
 {date:"2026-11-01",productCode:"easycut_pro_v2",productName:"이지컷 프로",months:1,amount:9900,count:1},
 {date:"2026-11-01",productCode:"toss_easycut_pro_1m",productName:"이지컷 프로 1개월",months:1,amount:19800,count:2},
 {date:"2026-11-30",productCode:"toss_starter_6m",productName:"스타터 패키지 6개월",months:6,amount:119400,count:1},
 {date:"2026-12-01",productCode:"toss_easycut_pro_6m",productName:"이지컷 프로 6개월",months:6,amount:53400,count:1},
];
describe("scheduled subscription payments",()=>{
 it("groups legacy and current codes under one product without dropping either amount",()=>{
  expect(subscriptionProduct(rows[0])).toEqual(subscriptionProduct(rows[1]));
  expect(summarizeSubscriptionBilling(rows,"easycut_pro","2026-11-01","2026-11-01")).toEqual({amount:29700,count:3});
 });
 it("includes both date boundaries and keeps full contract payments instead of monthly equivalents",()=>{
  expect(summarizeSubscriptionBilling(rows,"all","2026-11-01","2026-11-30")).toEqual({amount:149100,count:4});
 });
 it("filters contract duration independently from product and supports no scheduled payments",()=>{
  expect(summarizeSubscriptionBilling(rows,"easycut_pro","","","6")).toEqual({amount:53400,count:1});
  expect(summarizeSubscriptionBilling(rows,"starter","2026-11-01","2026-11-29")).toEqual({amount:0,count:0});
 });
 it("loads future charge schedules, applying scheduled plan changes and excluding canceled or paused schedules",async()=>{
  query.mockResolvedValue([{date:"2026-11-30",productCode:"toss_starter_6m",productName:"스타터 패키지 6개월",months:6,amount:"119400",count:1}]);
  const result=await loadAdminSubscriptionBilling();
  expect(result.rows[0]).toEqual(rows[2]);
  const sql=query.mock.calls[0][0].join("");
  expect(sql).toContain("s.next_charge_at");
  expect(sql).toContain("not s.cancel_at_period_end");
  expect(sql).toContain("s.provider_schedule_status='active'");
  expect(sql).toContain("s.billing_review_status='clear'");
  expect(sql).toContain("coalesce(s.scheduled_plan_code,s.plan_code)");
  expect(sql).not.toContain("billing_orders");
  const catalog=JSON.parse(query.mock.calls[0][1]);
  expect(catalog.find((p: {code:string})=>p.code==='toss_starter_6m')).toEqual({code:'toss_starter_6m',amount:119400,months:6});
 });
});
