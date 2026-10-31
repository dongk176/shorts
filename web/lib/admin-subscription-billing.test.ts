import { describe,expect,it,vi } from "vitest";
import { summarizeSubscriptionBilling } from "./admin-subscription-billing-contract";
vi.mock("server-only",()=>({}));
const { query } = vi.hoisted(()=>({query:vi.fn()}));
vi.mock("@/lib/db",()=>({getDb:()=>query}));
import { loadAdminSubscriptionBilling } from "./admin-subscription-billing";
const rows=[
 {date:"2026-10-01",productCode:"pro",productName:"프로",gross:9900,refunded:0,count:1},
 {date:"2026-10-31",productCode:"starter",productName:"스타터",gross:119400,refunded:19400,count:1},
 {date:"2026-09-30",productCode:"pro",productName:"프로",gross:9900,refunded:9900,count:1},
];
describe("active subscription payments",()=>{
 it("includes both date boundaries, retaining actual prepaid amounts and refunds",()=>{
  expect(summarizeSubscriptionBilling(rows,"all","2026-10-01","2026-10-31")).toEqual({gross:129300,refunded:19400,count:2});
 });
 it("filters by the purchased product and supports all-time and zero results",()=>{
  expect(summarizeSubscriptionBilling(rows,"pro","","")).toEqual({gross:19800,refunded:9900,count:2});
  expect(summarizeSubscriptionBilling(rows,"starter","2026-10-01","2026-10-30")).toEqual({gross:0,refunded:0,count:0});
 });
 it("maps database aggregate numbers and uses only approved subscription payments in active entitlement periods",async()=>{
  query.mockResolvedValue([{date:"2026-10-31",productCode:"starter",productName:"스타터",gross:"119400",refunded:"19400",count:1}]);
  const result=await loadAdminSubscriptionBilling();
  expect(result.rows[0]).toEqual(rows[1]);
  const sql=query.mock.calls[0][0].join("");
  expect(sql).toContain("s.current_period_end>now()");
  expect(sql).toContain("o.approved_at is not null");
  expect(sql).toContain("o.subscription_id");
  expect(sql).toContain("o.product_code");
  expect(sql).not.toContain("monthly_price_krw");
 });
});
