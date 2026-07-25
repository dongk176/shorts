"use client";

import { useSearchParams } from "next/navigation";
import { BillingResult } from "../success/result";

export function BillingFailClient() {
  const params = useSearchParams();
  const code = (params.get("code") || "PAYMENT_FAILED").slice(0, 80);
  const canceled = code === "PAY_PROCESS_CANCELED";
  return (
    <BillingResult
      status={canceled
        ? "결제는 승인되지 않았습니다. 원할 때 다시 시도할 수 있습니다."
        : "카드 정보와 이용 한도를 확인한 뒤 다시 시도해 주세요. 문제가 계속되면 고객센터로 문의해 주세요."}
      title={canceled ? "결제가 취소되었습니다" : "결제를 완료하지 못했습니다"}
      error
      actionHref="/pricing"
      actionLabel="다시 결제하기"
      secondaryHref={canceled ? undefined : "/support"}
      secondaryLabel={canceled ? undefined : "고객센터 문의"}
    />
  );
}
