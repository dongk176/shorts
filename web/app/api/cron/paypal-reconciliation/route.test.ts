import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/paypal/service", () => ({ reconcilePayPal: vi.fn() }));
import { reconcilePayPal } from "@/lib/paypal/service";
import { GET } from "./route";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it("does not access PayPal without exact cron authentication", async () => {
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
  for (const authorization of ["", "Bearer wrong", "Basic test-cron-secret"]) {
    expect((await GET(new Request("https://test/api/cron/paypal-reconciliation", { headers: { authorization } }))).status).toBe(401);
  }
  expect(reconcilePayPal).not.toHaveBeenCalled();
});
it("runs independent recovery and signals partial failures for monitoring", async () => {
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
  vi.mocked(reconcilePayPal).mockResolvedValue({checked: 2, failed: 1, deferred: 0, durationMs: 100});
  const response=await GET(new Request("https://test/api/cron/paypal-reconciliation", {headers:{authorization:"Bearer test-cron-secret"}}));
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({checked:2,failed:1});
  vi.mocked(reconcilePayPal).mockResolvedValue({checked:2,failed:0});
  expect((await GET(new Request("https://test/api/cron/paypal-reconciliation", {headers:{authorization:"Bearer test-cron-secret"}}))).status).toBe(200);
});
