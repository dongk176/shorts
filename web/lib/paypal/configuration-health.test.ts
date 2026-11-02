import { afterEach, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
vi.mock("server-only",()=>({}));
vi.mock("./api",async importOriginal=>{
  const actual=await importOriginal<typeof import("./api")>();
  return {...actual,paypalRequest:vi.fn(),paypalEnabled:()=>true,paypalEnvironment:()=>"live",paypalPlanId:(code:string)=>"P-"+code};
});
import { inspectPayPalConfiguration } from "./configuration-health";
import { paypalRequest, PayPalProviderError } from "./api";
import { paypalPlans } from "./catalog";
afterEach(()=>vi.clearAllMocks());
it("checks the real catalog and missing references through GETs without accepting 404 as cancellation",async()=>{
  vi.mocked(paypalRequest).mockImplementation(async path=>{
    if(path.includes('/subscriptions/'))throw new PayPalProviderError(404,'a123456789abc',true);
    const plan=paypalPlans.find(p=>path.endsWith('P-'+p.code))!;
    return {id:'P-'+plan.code,product_id:plan.code.startsWith('starter_')?'PROD-2W975416W47409145':plan.code.startsWith('expert_')?'PROD-4M935244FP7175734':'PROD-9EP98164RL252920V',status:'ACTIVE',billing_cycles:[{tenure_type:'REGULAR',frequency:{interval_unit:'MONTH',interval_count:plan.months},total_cycles:0,pricing_scheme:{fixed_price:{currency_code:'USD',value:(plan.amount/100).toFixed(2)}}}]};
  });
  const fakeDb=vi.fn().mockResolvedValue([{providerSubscriptionId:'I-123456789012'}]) as unknown as Sql;
  const result=await inspectPayPalConfiguration(fakeDb);
  expect(result.catalogValid).toBe(true);expect(result.plans).toHaveLength(7);
  expect(result.references).toEqual([{id:'I-123456789012',verified:false,providerStatus:404,debugId:'a123456789abc'}]);
  expect(result.guestCardEligibility).toBe('not_verified');
  expect(vi.mocked(paypalRequest).mock.calls.every(call=>call.length===1)).toBe(true);
});
