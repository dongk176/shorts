"use client";

import { PaymentMessageOverlay } from "@/components/payment-message-overlay";
import {
  paidProjectActionMessages,
  type PaidProjectAction,
} from "@/lib/project-action-entitlements";

export function PaidProjectFeatureOverlay({
  action,
  open,
  onClose,
}: {
  action: PaidProjectAction;
  open: boolean;
  onClose?: () => void;
}) {
  const label = action === "edit" ? "편집" : "다운로드";
  const title = action === "download"
    ? "다운로드 기능을 이용하려면\n활성 유료 이용권이 필요합니다."
    : paidProjectActionMessages[action];
  const message = action === "download"
    ? ""
    : `${label} 기능을 이용하려면 활성 유료 이용권이 필요합니다.`;
  return (
    <PaymentMessageOverlay
      open={open}
      tone="info"
      title={title}
      message={message}
      actionHref="/pricing"
      actionLabel="요금제 보기"
      onClose={onClose}
      closeLabel="프로젝트 계속 보기"
      showStatus={false}
    />
  );
}
