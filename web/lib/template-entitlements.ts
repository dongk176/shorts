import type { BillingSummary, PlanCode } from "@/lib/contracts";
import { HttpError } from "@/lib/http";

export const CUSTOM_TEMPLATE_PLAN_MESSAGE =
  "커스텀 템플릿은 스탠다드 또는 프로 플랜에서 사용할 수 있습니다.";

export function planSupportsCustomTemplates(
  planCode: PlanCode | string | null | undefined,
) {
  return planCode === "standard" || planCode === "pro";
}

export function billingSupportsCustomTemplates(
  billing: Pick<BillingSummary, "canCreateJobs" | "planCode">,
) {
  return billing.canCreateJobs && planSupportsCustomTemplates(billing.planCode);
}

export function assertCustomTemplateAccess(
  billing: Pick<BillingSummary, "canCreateJobs" | "planCode">,
) {
  if (!billingSupportsCustomTemplates(billing)) {
    throw new HttpError(403, CUSTOM_TEMPLATE_PLAN_MESSAGE);
  }
}
