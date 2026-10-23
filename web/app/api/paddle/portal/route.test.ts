import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/session",()=>({requireAuthenticatedMvpSession:vi.fn()}));
vi.mock("@/lib/paddle/service",()=>({createPaddlePortal:vi.fn(),cancelPaddleSubscription:vi.fn()}));
import {requireAuthenticatedMvpSession} from "@/lib/session";
import {createPaddlePortal,cancelPaddleSubscription} from "@/lib/paddle/service";
import {POST} from "./route";
const request=(body:unknown,origin="https://www.easycut.co.kr")=>new Request("https://www.easycut.co.kr/api/paddle/portal",{method:"POST",headers:{origin,"Content-Type":"application/json"},body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();vi.mocked(requireAuthenticatedMvpSession).mockResolvedValue({userId:"owner"} as Awaited<ReturnType<typeof requireAuthenticatedMvpSession>>);});
it("preserves billing portal access",async()=>{
 vi.mocked(createPaddlePortal).mockResolvedValue("https://customer-portal.paddle.com/test");
 expect((await POST(request({}))).status).toBe(200);expect(createPaddlePortal).toHaveBeenCalledWith("owner");expect(cancelPaddleSubscription).not.toHaveBeenCalled();
});
it("requires the survey and uses server-side ownership",async()=>{
 expect((await POST(request({action:"cancel"}))).status).toBe(400);
 expect((await POST(request({action:"cancel",feedback:{reason:"other",detail:" "}}))).status).toBe(400);
 expect(cancelPaddleSubscription).not.toHaveBeenCalled();
 vi.mocked(cancelPaddleSubscription).mockResolvedValue({ok:true});
 expect((await POST(request({action:"cancel",feedback:{reason:"price",message:"For the team"}}))).status).toBe(200);
 expect(cancelPaddleSubscription).toHaveBeenCalledWith("owner",expect.objectContaining({reason:"price",message:"For the team"}));
});
it("rejects cross-origin requests before changing subscriptions",async()=>{
 expect((await POST(request({action:"cancel",feedback:{reason:"price"}},"https://evil.test"))).status).toBe(403);expect(cancelPaddleSubscription).not.toHaveBeenCalled();
});
