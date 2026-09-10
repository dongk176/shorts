import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { retainedUpgradeCarryoverSeconds } from "@/lib/billing-change";

const activateRoute = readFileSync(
  new URL("../app/api/billing/activate/route.ts", import.meta.url),
  "utf8",
);

describe("paid package replacement activation", () => {
  it("attempts the old Pro refund after charging the package", () => {
    const chargeIndex = activateRoute.indexOf("const payment = isManualPackage");
    const refundIndex = activateRoute.indexOf("const refund = await refundThePayOnePayment({");
    const activationIndex = activateRoute.indexOf("set plan_code=${plan.code}");

    expect(chargeIndex).toBeGreaterThan(-1);
    expect(refundIndex).toBeGreaterThan(chargeIndex);
    expect(activationIndex).toBeGreaterThan(refundIndex);
    expect(activateRoute).toContain("amount: refundAmount");
    expect(activateRoute).toContain("refund_status='full'");
    expect(activateRoute).toContain("proration_refund_status='succeeded'");
  });


  it("does not carry refunded Easycut Pro allowance into the package grant", () => {
    expect(retainedUpgradeCarryoverSeconds({
      replacesEasycutPro: true,
      currentBaseUnconsumedSeconds: 60,
    })).toBe(0);
    expect(activateRoute).toContain(
      "const retainedBaseSeconds = retainedUpgradeCarryoverSeconds({",
    );
    expect(activateRoute).toContain(
      "currentBaseUnconsumedSeconds: retainedBaseSeconds",
    );
    expect(activateRoute).toContain("carriedSeconds: retainedBaseSeconds");
  });

  it("keeps the unused base allowance for ordinary paid-plan upgrades", () => {
    expect(retainedUpgradeCarryoverSeconds({
      replacesEasycutPro: false,
      currentBaseUnconsumedSeconds: 60.9,
    })).toBe(60);
  });
});
