import assert from "node:assert/strict";
import test from "node:test";
import { validateBillingAudit } from "./audit-production-billing.mjs";

const healthy = {
  plan: { code: "easycut_pro_v2", monthlyPriceKrw: 9_900, isActive: true },
  successfulInitialPro: { orders: 478, minAmount: 9_900, maxAmount: 9_900 },
  registrationTrackIds: { registrations: 12, invalidLength: 0 },
  packageReplacements: { orders: 5, refundMismatches: 0, activationMismatches: 0 },
  newManualReviews: { orders: 0 },
};

test("accepts the proven production billing invariants without exposing user data", () => {
  assert.equal(validateBillingAudit(healthy), healthy);
});

test("fails on price, track ID, replacement, or manual-review drift", () => {
  assert.throws(
    () => validateBillingAudit({
      ...healthy,
      registrationTrackIds: { registrations: 1, invalidLength: 1 },
    }),
    /31자/,
  );
  assert.throws(
    () => validateBillingAudit({
      ...healthy,
      packageReplacements: { orders: 5, refundMismatches: 1, activationMismatches: 0 },
    }),
    /전액환불/,
  );
  assert.throws(
    () => validateBillingAudit({ ...healthy, newManualReviews: { orders: 1 } }),
    /manual_review/,
  );
});
