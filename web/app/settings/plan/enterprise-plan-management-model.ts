export type EnterpriseManagedProduct = {
  id: string;
  paymentRequestId: string;
  paymentRequestTitle: string;
  paymentRequestToken: string;
  paymentRequestStatus: string;
  paymentRequestExpired: boolean;
  sortOrder: number;
  name: string;
  amountKrw: number;
  paymentStatus: string;
  paidAt: string | null;
  entitlementGranted: boolean;
  serviceStartDate: string;
  serviceEndDate: string;
  includedMinutes: number;
  vatTreatment: "included" | "not_applicable";
  paymentDueDate: string;
};

export type EnterpriseProductStage =
  | "active"
  | "upcoming"
  | "ended"
  | "payment_required"
  | "payment_review"
  | "payment_expired"
  | "access_pending";

export function enterpriseProductStage(
  product: EnterpriseManagedProduct,
  today: string,
): EnterpriseProductStage {
  if (product.paymentRequestExpired && product.paymentRequestStatus !== "paid") {
    return "payment_expired";
  }
  if (product.paymentStatus === "confirming" || product.paymentStatus === "manual_review") {
    return "payment_review";
  }
  if (product.paymentStatus !== "paid" || product.paymentRequestStatus !== "paid") {
    return "payment_required";
  }
  if (!product.entitlementGranted) return "access_pending";
  if (today < product.serviceStartDate) return "upcoming";
  if (today > product.serviceEndDate) return "ended";
  return "active";
}

export function enterpriseProductStageLabel(stage: EnterpriseProductStage) {
  if (stage === "active") return "이용 중";
  if (stage === "upcoming") return "이용 예정";
  if (stage === "ended") return "이용 종료";
  if (stage === "payment_review") return "결제 확인 중";
  if (stage === "payment_expired") return "결제 기한 만료";
  if (stage === "access_pending") return "이용 권한 확인 중";
  return "결제 필요";
}

export function enterprisePaymentStatusLabel(status: string) {
  if (status === "paid") return "결제 완료";
  if (status === "confirming") return "결제 결과 확인 중";
  if (status === "manual_review") return "결제 확인 필요";
  return "결제 대기";
}
