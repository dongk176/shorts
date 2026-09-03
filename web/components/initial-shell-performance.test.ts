import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layoutSource = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const usageSource = readFileSync(new URL("./usage-provider.tsx", import.meta.url), "utf8");
const paymentSource = readFileSync(
  new URL("./payment-method-remediation-gate.tsx", import.meta.url),
  "utf8",
);
const adminPageSource = readFileSync(
  new URL("../app/admin/easycutcutcutcutcutcut/page.tsx", import.meta.url),
  "utf8",
);

describe("non-blocking initial shells", () => {
  it("does not block the root layout on application database billing reads", () => {
    expect(layoutSource).not.toContain("getUsageSnapshot");
    expect(layoutSource).not.toContain("getPaymentMethodAction");
    expect(layoutSource).not.toContain("getDb");
    expect(layoutSource).toContain("await getAuthenticatedUser()");
  });

  it("deduplicates and throttles usage refresh outside administrator pages", () => {
    expect(usageSource).toContain('pathname.startsWith("/admin/")');
    expect(usageSource).toContain("inFlight.current");
    expect(usageSource).toContain("< 30_000");
    expect(usageSource).toContain("120_000");
    expect(usageSource).toContain("controller.abort(), 8_000");
  });

  it("defers payment remediation and billing details away from shell rendering", () => {
    expect(paymentSource).toContain("isAdminPath");
    expect(paymentSource).toContain("controller.abort(), 8_000");
    expect(adminPageSource).not.toContain("loadAdminBillingOrders");
    expect(adminPageSource).not.toContain("billing_payment_method_remediations");
    expect(adminPageSource).toContain("<AdminBillingDashboard");
  });
});
