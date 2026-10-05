import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin", () => ({ requireAdminUser: vi.fn() }));
vi.mock("@/lib/admin-native-auth", () => ({ nativeAdminUser: async () => null }));
import { requireAdminUser } from "@/lib/admin";
import { HttpError } from "@/lib/http";
import { authorizeMobile, authorizedMobileCron, mobileBody, mobileError, mobileJSON } from "./admin-mobile-api";
beforeEach(() => { vi.resetAllMocks();vi.unstubAllEnvs();vi.stubEnv("ADMIN_MOBILE_ENABLED","1"); });
describe("mobile authorization boundary", () => {
  it("requires the existing administrator session before any feature access", async () => {
    vi.mocked(requireAdminUser).mockRejectedValue(new HttpError(401,"로그인 필요"));
    await expect(authorizeMobile()).rejects.toMatchObject({status:401});
  });
  it("rejects cross-origin and non-JSON mutations", async () => {
    vi.mocked(requireAdminUser).mockResolvedValue({id:"admin"} as Awaited<ReturnType<typeof requireAdminUser>>);
    await expect(authorizeMobile(new Request("https://www.easycut.co.kr/api/admin/mobile/push",{method:"POST",headers:{origin:"https://evil.test","content-type":"application/json"}}))).rejects.toMatchObject({status:403});
    await expect(authorizeMobile(new Request("https://www.easycut.co.kr/api/admin/mobile/push",{method:"POST",headers:{origin:"https://www.easycut.co.kr","content-type":"text/plain"}}))).rejects.toMatchObject({status:415});
    expect(await authorizeMobile(new Request("https://www.easycut.co.kr/api/admin/mobile/push",{method:"POST",headers:{origin:"https://www.easycut.co.kr","content-type":"application/json"}}))).toMatchObject({id:"admin"});
  });
  it("requires a configured exact cron secret", () => {
    vi.stubEnv("CRON_SECRET","test-secret");
    expect(authorizedMobileCron(new Request("https://example.test",{headers:{authorization:"Bearer test-secret"}}))).toBe(true);
    expect(authorizedMobileCron(new Request("https://example.test",{headers:{authorization:"Bearer wrong"}}))).toBe(false);
    vi.stubEnv("CRON_SECRET","");
    expect(authorizedMobileCron(new Request("https://example.test"))).toBe(false);
  });
  it("marks successful and rejected responses private and uncached", () => {
    for(const response of [mobileJSON({ok:true}),mobileError(new HttpError(403,"권한 없음"))]) {
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("vary")).toBe("Cookie");
    }
  });
  it("rejects oversized and malformed request bodies", async () => {
    await expect(mobileBody(new Request("https://example.test",{method:"POST",body:"x".repeat(8193)}))).rejects.toMatchObject({status:413});
    await expect(mobileBody(new Request("https://example.test",{method:"POST",body:"{"}))).rejects.toBeInstanceOf(SyntaxError);
  });
});
