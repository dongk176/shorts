import type { BillingSummary } from "@/lib/contracts";

export type FeatureEntitlementBilling = Pick<BillingSummary, "activeProducts">
  & Partial<Pick<BillingSummary, "hasManagedFeatureAccess">>;

export function hasManagedFeatureAccess(
  billing: Partial<Pick<BillingSummary, "hasManagedFeatureAccess">>,
) {
  return billing.hasManagedFeatureAccess === true;
}
