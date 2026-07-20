import type { BillingSummary, PlanCode } from "@/lib/contracts";

export const CUSTOM_TEMPLATE_PLAN_MESSAGE = "커스텀 템플릿은 모든 플랜에서 사용할 수 있습니다.";

export function planSupportsCustomTemplates(
  planCode: PlanCode | string | null | undefined,
) {
  void planCode;
  return true;
}

export function billingSupportsCustomTemplates(
  billing: Pick<BillingSummary, "canCreateJobs" | "planCode">,
) {
  void billing;
  return true;
}

export function assertCustomTemplateAccess(
  billing: Pick<BillingSummary, "canCreateJobs" | "planCode">,
) {
  void billing;
}
