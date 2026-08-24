import {
  hasManagedFeatureAccess,
  type FeatureEntitlementBilling,
} from "@/lib/feature-entitlements";
import { HttpError } from "@/lib/http";

export type PaidProjectAction = "edit" | "download";

export const paidProjectActionMessages: Record<PaidProjectAction, string> = {
  edit: "편집은 유료 회원만 이용할 수 있습니다.",
  download: "다운로드는 유료 회원만 이용할 수 있습니다.",
};

export function billingSupportsPaidProjectActions(
  billing: FeatureEntitlementBilling,
) {
  return hasManagedFeatureAccess(billing) || billing.activeProducts.length > 0;
}

export function assertPaidProjectActionAccess(
  billing: FeatureEntitlementBilling,
  action: PaidProjectAction,
) {
  if (!billingSupportsPaidProjectActions(billing)) {
    throw new HttpError(
      402,
      paidProjectActionMessages[action],
      "PAID_PROJECT_ACTION_REQUIRED",
    );
  }
}
