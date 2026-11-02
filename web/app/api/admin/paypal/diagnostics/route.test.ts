import { afterEach, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";
vi.mock("@/lib/admin",()=>({requireAdminUser:vi.fn()}));
vi.mock("@/lib/paypal/configuration-health",()=>({inspectPayPalConfiguration:vi.fn()}));
import { requireAdminUser } from "@/lib/admin";
import { inspectPayPalConfiguration } from "@/lib/paypal/configuration-health";
import { GET } from "./route";
afterEach(()=>vi.clearAllMocks());
it.each([401,403])("blocks PayPal reads before unauthorized access (%s)",async status=>{
  vi.mocked(requireAdminUser).mockRejectedValue(new HttpError(status,"Denied"));
  const response=await GET();expect(response.status).toBe(status);expect(inspectPayPalConfiguration).not.toHaveBeenCalled();
});
it("returns private configuration evidence only for an administrator",async()=>{
  vi.mocked(requireAdminUser).mockResolvedValue({id:"admin",authUserId:"admin",email:"admin@example.com",displayName:null});
  vi.mocked(inspectPayPalConfiguration).mockResolvedValue({checkedAt:"2026-11-02T00:00:00Z",environment:"live",enabled:true,catalogValid:true,plans:[],references:[],guestCardEligibility:"not_verified"});
  const response=await GET();expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({catalogValid:true,guestCardEligibility:"not_verified"});
});
