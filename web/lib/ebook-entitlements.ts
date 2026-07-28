import type { BillingSummary } from "@/lib/contracts";
import { HttpError } from "@/lib/http";

export const downloadableEbookSlugs = [
  "monetization-7",
  "multi-platform",
  "copyright-survival",
  "monetization-playbook",
  "viral-formula",
  "low-views-diagnosis",
  "title-300",
] as const;
export type DownloadableEbookSlug = typeof downloadableEbookSlugs[number];

export function billingSupportsEbookDownloads(
  billing: Pick<BillingSummary, "activeProducts">,
) {
  return billing.activeProducts.some((product) =>
    product.billingCycle === "yearly"
    && (
      product.planCode.startsWith("starter_")
      || product.planCode.startsWith("expert_")
    )
  );
}

export function assertEbookDownloadAccess(
  billing: Pick<BillingSummary, "activeProducts">,
) {
  if (!billingSupportsEbookDownloads(billing)) {
    throw new HttpError(403, "전자책 다운로드는 활성 기간 패키지에서 이용할 수 있습니다.");
  }
}
