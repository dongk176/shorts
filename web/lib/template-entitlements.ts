import type { PlanCode } from "@/lib/contracts";
import {
  hasManagedFeatureAccess,
  type FeatureEntitlementBilling,
} from "@/lib/feature-entitlements";
import { HttpError } from "@/lib/http";
import { paidPlanCodes } from "@/lib/contracts";

export const CUSTOM_TEMPLATE_PLAN_MESSAGE = "커스텀 템플릿은 활성 유료 플랜에서 사용할 수 있습니다.";

export function planSupportsCustomTemplates(
  planCode: PlanCode | string | null | undefined,
) {
  return paidPlanCodes.some((code) => code === planCode);
}

export function billingSupportsCustomTemplates(
  billing: FeatureEntitlementBilling,
) {
  return hasManagedFeatureAccess(billing) || billing.activeProducts.some((product) =>
    planSupportsCustomTemplates(product.planCode)
  );
}

export function assertCustomTemplateAccess(
  billing: FeatureEntitlementBilling,
) {
  if (!billingSupportsCustomTemplates(billing)) {
    throw new HttpError(402, CUSTOM_TEMPLATE_PLAN_MESSAGE);
  }
}
