import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { retainedUpgradeCarryoverSeconds } from "@/lib/billing-change";

const activateRoute = readFileSync(
  new URL("../app/api/billing/activate/route.ts", import.meta.url),
  "utf8",
);

describe("paid package replacement activation", () => {
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
