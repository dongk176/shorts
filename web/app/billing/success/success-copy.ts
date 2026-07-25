export type UpdatedCardSummary = {
  cardIssuer: string | null;
  cardLast4: string | null;
};

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
