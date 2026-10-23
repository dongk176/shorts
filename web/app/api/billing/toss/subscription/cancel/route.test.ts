import {beforeEach,expect,it,vi} from "vitest";
vi.mock("@/lib/session",()=>({requireAuthenticatedMvpSession:vi.fn()}));
vi.mock("@/lib/toss-billing-service",()=>({setTossSubscriptionCancellation:vi.fn()}));
import {requireAuthenticatedMvpSession} from "@/lib/session";
import {setTossSubscriptionCancellation} from "@/lib/toss-billing-service";
import {POST} from "./route";
const request=(body:unknown,origin="https://www.easycut.co.kr")=>new Request("https://www.easycut.co.kr/api/billing/toss/subscription/cancel",{method:"POST",headers:{origin,"Content-Type":"application/json"},body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();vi.mocked(requireAuthenticatedMvpSession).mockResolvedValue({userId:"owner"} as Awaited<ReturnType<typeof requireAuthenticatedMvpSession>>);});
it("rejects missing and blank Other reasons before billing changes",async()=>{
 for(const body of [{cancelAtPeriodEnd:true},{cancelAtPeriodEnd:true,feedback:{reason:"other",detail:" "}}]) expect((await POST(request(body))).status).toBe(400);
 expect(setTossSubscriptionCancellation).not.toHaveBeenCalled();
});
it("passes the authenticated owner, normalized survey and optional team message",async()=>{
 vi.mocked(setTossSubscriptionCancellation).mockResolvedValue({subscriptionId:"sub",cancelAtPeriodEnd:true,accessUntil:new Date("2027-01-01")});
 expect((await POST(request({cancelAtPeriodEnd:true,feedback:{reason:"price",message:" Thank you "}}))).status).toBe(200);
 expect(setTossSubscriptionCancellation).toHaveBeenCalledWith({userId:"owner",cancelAtPeriodEnd:true,feedback:{reason:"price",detail:"",message:"Thank you",alternativeService:"",alternativeUndecided:false}});
});
it("retains resume without a survey and rejects cross-origin cancellation",async()=>{
 vi.mocked(setTossSubscriptionCancellation).mockResolvedValue({subscriptionId:"sub",cancelAtPeriodEnd:false,accessUntil:new Date("2027-01-01")});
 expect((await POST(request({cancelAtPeriodEnd:false}))).status).toBe(200);
 expect((await POST(request({cancelAtPeriodEnd:true,feedback:{reason:"price"}},"https://evil.test"))).status).toBe(403);
 expect(setTossSubscriptionCancellation).toHaveBeenCalledTimes(1);
});
