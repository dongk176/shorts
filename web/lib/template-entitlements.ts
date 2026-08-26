import {
  hasManagedFeatureAccess,
  type FeatureEntitlementBilling,
} from "@/lib/feature-entitlements";
import { HttpError } from "@/lib/http";

export const CUSTOM_TEMPLATE_PLAN_MESSAGE = "커스텀 템플릿은 활성 유료 플랜에서 사용할 수 있습니다.";

export function billingSupportsCustomTemplates(
  billing: FeatureEntitlementBilling,
) {
  return hasManagedFeatureAccess(billing) || billing.activeProducts.length > 0;
}

export function assertCustomTemplateAccess(
  billing: FeatureEntitlementBilling,
) {
  if (!billingSupportsCustomTemplates(billing)) {
    throw new HttpError(402, CUSTOM_TEMPLATE_PLAN_MESSAGE);
  }
}
