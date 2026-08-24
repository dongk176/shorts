import { PaymentMessageOverlay, type PaymentMessageTone } from "@/components/payment-message-overlay";

export function BillingResult({
  status,
  title,
  error = false,
  actionHref,
  actionLabel,
  actionPending = false,
  pendingLabel = "처리 중...",
  secondaryHref,
  secondaryLabel,
}: {
  status: string;
  title?: string;
  error?: boolean;
  actionHref?: string;
  actionLabel?: string;
  actionPending?: boolean;
  pendingLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  const href = actionHref || (error ? "/pricing" : "/#workspace");
  const label = actionLabel || (error ? "가격 페이지로 돌아가기" : "Easy Cut으로 이동");
  const tone: PaymentMessageTone = actionPending ? "info" : error ? "error" : "success";
  return (
    <main className="app-shell min-h-screen text-neutral-100">
      <PaymentMessageOverlay
        open
        tone={tone}
        title={title || (error ? "결제를 완료하지 못했습니다" : actionPending ? "결제 결과를 확인하고 있습니다" : "결제가 완료되었습니다")}
        message={status}
        actionHref={href}
        actionLabel={label}
        actionPending={actionPending}
        pendingLabel={pendingLabel}
        secondaryHref={secondaryHref}
        secondaryLabel={secondaryLabel}
      />
    </main>
  );
}
