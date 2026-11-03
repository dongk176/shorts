import { afterEach, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";
vi.mock("@/lib/admin",()=>({requireAdminUser:vi.fn()}));
vi.mock("@/lib/paypal/configuration-health",()=>({inspectPayPalConfiguration:vi.fn()}));
vi.mock("@/lib/paypal/one-time-config",()=>({oneTimeEnabled:vi.fn(()=>false)}));
vi.mock("@/lib/paypal/one-time-diagnostics",()=>({
  inspectOneTimeLiveConfiguration:vi.fn(),configureOneTimeWebhook:vi.fn(),
}));
import { requireAdminUser } from "@/lib/admin";
import { inspectPayPalConfiguration } from "@/lib/paypal/configuration-health";
import { oneTimeEnabled } from "@/lib/paypal/one-time-config";
import { inspectOneTimeLiveConfiguration } from "@/lib/paypal/one-time-diagnostics";
import { GET } from "./route";
afterEach(()=>{vi.clearAllMocks();vi.mocked(oneTimeEnabled).mockReturnValue(false);});
it.each([401,403])("blocks PayPal reads before unauthorized access (%s)",async status=>{
  vi.mocked(requireAdminUser).mockRejectedValue(new HttpError(status,"Denied"));
  const response=await GET();expect(response.status).toBe(status);expect(inspectPayPalConfiguration).not.toHaveBeenCalled();expect(inspectOneTimeLiveConfiguration).not.toHaveBeenCalled();
});
it("checks the released one-time configuration for an administrator",async()=>{
  vi.mocked(requireAdminUser).mockResolvedValue({id:"admin",authUserId:"admin",email:"admin@example.com",displayName:null});
  vi.mocked(oneTimeEnabled).mockReturnValue(true);
  vi.mocked(inspectOneTimeLiveConfiguration).mockResolvedValue({
    checkedAt:"2026-11-03T00:00:00Z",mode:"one_time",environment:"live",
    returnOrigin:"https://www.easycut.co.kr",databaseFingerprint:"test-only",
    schema:{orders:true,grants:true,refunds:true},webhookValid:true,
    webhookEvents:[],draft:null,realCardApproval:"not_tested",
  });
  const response=await GET();
  expect(response.status).toBe(200);expect(await response.json()).toMatchObject({mode:"one_time",webhookValid:true});
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(inspectOneTimeLiveConfiguration).toHaveBeenCalledOnce();
  expect(inspectPayPalConfiguration).not.toHaveBeenCalled();
});
it("returns private configuration evidence only for an administrator",async()=>{
  vi.mocked(requireAdminUser).mockResolvedValue({id:"admin",authUserId:"admin",email:"admin@example.com",displayName:null});
  vi.mocked(inspectPayPalConfiguration).mockResolvedValue({checkedAt:"2026-11-02T00:00:00Z",environment:"live",enabled:true,catalogValid:true,plans:[],references:[],guestCardEligibility:"not_verified"});
  const response=await GET();expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({catalogValid:true,guestCardEligibility:"not_verified"});
});
