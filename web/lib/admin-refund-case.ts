export const adminRefundCaseStatuses = [
  "unprocessed",
  "in_progress",
  "completed",
  "manual_review",
  "closed",
] as const;

export type AdminRefundCaseStatus = typeof adminRefundCaseStatuses[number];

export const adminRefundActions = [
  "policy_refund",
  "manual_amount",
  "none",
] as const;

export type AdminRefundAction = typeof adminRefundActions[number];

export const adminRefundBillingActions = [
  "none",
  "pause_now_keep_until_period_end",
] as const;

export type AdminRefundBillingAction = typeof adminRefundBillingActions[number];

export const adminRefundEntitlementActions = [
  "none",
  "revoke_now",
  "end_at_current_period",
] as const;

export type AdminRefundEntitlementAction =
  typeof adminRefundEntitlementActions[number];

export type AdminRefundPaymentStatus =
  | "not_started"
  | "submitted"
  | "completed"
  | "failed"
  | "manual_review";

export type RefundGuideInput = {
  customerName: string | null;
  email: string;
  orderId: string;
  productName: string;
  approvedAt: string | null;
  amountKrw: number;
  firstJobCompleted: boolean;
  firstCompletedJobAt: string | null;
  monthlyDeductionKrw: number;
  plannedRefundKrw: number;
  status: AdminRefundCaseStatus;
  paymentStatus: AdminRefundPaymentStatus;
  providerReference: string | null;
  billingAction: AdminRefundBillingAction;
  entitlementAction: AdminRefundEntitlementAction;
  entitlementEffectiveAt: string | null;
};

const statusLabels: Record<AdminRefundCaseStatus, string> = {
  unprocessed: "미처리",
  in_progress: "업무 진행 중",
  completed: "업무 처리 완료",
  manual_review: "확인 필요",
  closed: "환불 없이 종결",
};

const paymentStatusLabels: Record<RefundGuideInput["paymentStatus"], string> = {
  not_started: "실제 결제 환불 미처리",
  submitted: "결제사·카드사 환불 요청됨",
  completed: "실제 결제 환불 완료",
  failed: "결제 환불 실패",
  manual_review: "결제 환불 확인 필요",
};

function money(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function date(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function accessMessage(input: RefundGuideInput) {
  if (input.entitlementAction === "revoke_now") {
    return "유료 이용권은 즉시 종료하는 것으로 접수했습니다.";
  }
  if (input.entitlementAction === "end_at_current_period") {
    return `유료 이용권은 ${date(input.entitlementEffectiveAt)}까지 유지한 뒤 종료하는 것으로 접수했습니다.`;
  }
  return "유료 이용권은 별도 변경 없이 유지됩니다.";
}

function billingMessage(input: RefundGuideInput) {
  if (input.billingAction === "pause_now_keep_until_period_end") {
    return "다음 결제가 발생하지 않도록 자동결제를 중지하고, 현재 이용기간까지 사용할 수 있도록 접수했습니다.";
  }
  return "자동결제 상태는 별도 변경하지 않습니다.";
}

export function buildRefundGuide(input: RefundGuideInput) {
  const customer = input.customerName?.trim() || input.email;
  const completion = input.firstJobCompleted
    ? `완료 (${date(input.firstCompletedJobAt)})`
    : "완료 기록 없음";
  const paymentRefundCompleted = input.paymentStatus === "completed";
  const refundLabel = paymentRefundCompleted ? "처리 환불액" : "환불 예정액";

  return [
    "[이지컷] 환불 처리 안내",
    "",
    `안녕하세요, ${customer}님.`,
    "요청하신 결제 및 환불 내용을 아래와 같이 안내드립니다.",
    "",
    "■ 결제 정보",
    `- 상품: ${input.productName}`,
    `- 주문번호: ${input.orderId}`,
    `- 결제일: ${date(input.approvedAt)}`,
    `- 결제금액: ${money(input.amountKrw)}`,
    "",
    "■ 이용 확인",
    `- 첫 작업 완료 여부: ${completion}`,
    input.firstJobCompleted
      ? `- 첫 작업이 완료되어 실제 결제금액 기준 1개월분 ${money(input.monthlyDeductionKrw)}을 공제했습니다.`
      : "- 첫 작업 완료 기록이 없어 1개월분을 공제하지 않았습니다.",
    "",
    "■ 환불 안내",
    `- ${refundLabel}: ${money(input.plannedRefundKrw)}`,
    `- 업무 처리 상태: ${statusLabels[input.status]}`,
    `- 결제 환불 기록: ${paymentStatusLabels[input.paymentStatus]}`,
    input.providerReference
      ? `- 환불 확인번호: ${input.providerReference}`
      : "- 환불 확인번호: 확인 후 별도로 안내",
    "",
    "■ 이용권 및 자동결제",
    `- ${billingMessage(input)}`,
    `- ${accessMessage(input)}`,
    "",
    paymentRefundCompleted || input.paymentStatus === "submitted"
      ? "카드사 반영 시점은 결제수단과 카드사 사정에 따라 달라질 수 있습니다."
      : "실제 결제 환불이 완료되면 확인번호와 카드사 반영 정보를 다시 안내드리겠습니다.",
    "추가 확인이 필요하시면 이 메일에 회신해 주세요.",
    "",
    "감사합니다.",
    "이지컷 드림",
  ].join("\n");
}
