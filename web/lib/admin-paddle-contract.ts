export type PaddleSalesTotal = {
  currency: "USD" | "JPY";
  grossMinor: number;
  refundedMinor: number;
  chargebackMinor: number;
  pendingRefundMinor: number;
  netMinor: number;
  paidOrders: number;
  todayGrossMinor: number;
  todayPaidOrders: number;
};

export function formatAdminCurrency(amountMinor: number, currency: string = "KRW") {
  const divisor = currency === "USD" ? 100 : 1;
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency, currencyDisplay: "code" }).format(amountMinor / divisor);
}

export function paddleAdminProduct(code: string) {
  if (code === "paddle_lite") return "이지컷 프로 · 월간";
  if (code === "paddle_creator") return "스타터 · 월간 (이전 요금제)";
  if (code === "paddle_pro") return "전문가 · 월간 (이전 요금제)";
  const match = /^paddle_(creator|pro)_(3|6|12)m$/.exec(code);
  return match ? `${match[1] === "creator" ? "스타터" : "전문가"} ${match[2]}개월` : code;
}
