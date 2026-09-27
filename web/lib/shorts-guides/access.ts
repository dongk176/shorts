import type { BillingSummary } from "@/lib/contracts";
// This new collection is an active-paid-plan benefit. Existing package-only ebooks keep their own policy.
export function canDownloadStrategyGuides(
  billing: Pick<BillingSummary, "hasPaymentHistory" | "activeProducts">,
  now = Date.now(),
) {
  return (
    billing.hasPaymentHistory &&
    billing.activeProducts.some(
      (p) =>
        p.planCode !== "free" &&
        Date.parse(p.currentPeriodStart) <= now &&
        Date.parse(p.currentPeriodEnd) > now,
    )
  );
}
