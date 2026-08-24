export type UpdatedCardSummary = {
  cardIssuer: string | null;
  cardLast4: string | null;
};

type PackagePaymentSummary = {
  orderName?: string;
  installmentMonths?: number;
  chargedAmountKrw?: number;
  nextQuotaAt?: string | null;
};

const koreanLongDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "long",
  timeZone: "Asia/Seoul",
});

export function paymentMethodUpdatedMessage(card: UpdatedCardSummary | null) {
  const issuer = card?.cardIssuer?.trim() || "";
  const last4 = card?.cardLast4?.replace(/\D/g, "").slice(-4) || "";

  if (issuer && last4) {
    return `${issuer} · 끝번호 ${last4} 카드로 정기결제 수단이 변경되었습니다.`;
  }
  if (issuer) {
    return `${issuer} 카드로 정기결제 수단이 변경되었습니다.`;
  }
  if (last4) {
    return `끝번호 ${last4} 카드로 정기결제 수단이 변경되었습니다.`;
  }
  return "새 카드로 정기결제 수단이 변경되었습니다.";
}

export function packagePaymentCompletedMessage(summary: PackagePaymentSummary) {
  const productName = summary.orderName?.trim().replace(/^Easy Cut\s+/i, "")
    || "선택한 패키지";
  const installmentMonths = Number(summary.installmentMonths || 0);
  const lines = [productName];

  if (summary.chargedAmountKrw) {
    const paymentMethod = installmentMonths > 0
      ? `${installmentMonths}개월 할부`
      : "일시불";
    lines.push(`${summary.chargedAmountKrw.toLocaleString("ko-KR")}원 · ${paymentMethod}`);
  }

  if (summary.nextQuotaAt) {
    lines.push(
      `다음 기본시간: ${koreanLongDateFormatter.format(new Date(summary.nextQuotaAt))}`,
    );
  }

  return lines.join("\n");
}
