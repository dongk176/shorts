"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BillingResult } from "./result";
import { paymentMethodUpdatedMessage, type UpdatedCardSummary } from "./success-copy";

export function BillingSuccessClient() {
  const params = useSearchParams();
  const [sessionCheck, setSessionCheck] = useState<"checking" | "authenticated" | "anonymous" | "unavailable">("checking");
  const [orderState, setOrderState] = useState<"idle" | "pending" | "succeeded" | "failed" | "manual_review">(
    params.get("status") === "pending" ? "pending" : "idle",
  );
  const [updatedCard, setUpdatedCard] = useState<UpdatedCardSummary | null>(null);
  const [orderDetail, setOrderDetail] = useState<{
    kind?: string;
    productCode?: string;
    orderName?: string;
    refund?: { mode: string; amountKrw: number; processingBusinessDays: number };
    installmentMonths?: number;
  } | null>(null);
  const status = params.get("status");
  const checkoutId = params.get("checkoutId");
  const message = orderState === "pending"
    ? "결제 승인 결과를 확인하고 있습니다. 이 화면을 잠시 유지해 주세요."
    : orderState === "manual_review"
      ? "결제는 접수되었으며 주문 정보를 확인하고 있습니다. 확인이 완료되면 이용 내역에 반영됩니다."
      : orderState === "failed"
        ? "결제 승인을 완료하지 못했습니다. 가격 페이지에서 다시 시도해 주세요."
    : orderDetail?.refund?.mode === "manual_partial" && orderDetail.refund.amountKrw > 0
      ? `${orderDetail.refund.amountKrw.toLocaleString("ko-KR")}원은 영업일 +3일 이내에 원 결제수단으로 부분환불 처리됩니다. 카드사 반영 시점은 다를 수 있습니다.${Number(orderDetail.installmentMonths || 0) > 0 ? ` 이번 결제는 ${orderDetail.installmentMonths}개월 할부입니다.` : ""}`
    : orderDetail?.refund?.mode === "automatic_full" && orderDetail.refund.amountKrw > 0
      ? `기존 플랜 결제 ${orderDetail.refund.amountKrw.toLocaleString("ko-KR")}원은 즉시 전액취소되었고 새 플랜이 적용되었습니다.`
    : status === "addon_granted" || (orderState === "succeeded" && orderDetail?.kind === "addon")
    ? "추가 처리시간이 계정에 충전되었습니다."
    : orderState === "succeeded"
      && (
        orderDetail?.productCode?.startsWith("starter_")
        || orderDetail?.productCode?.startsWith("expert_")
      )
      ? `${orderDetail.orderName || "선택한 패키지"} 결제가 완료되었습니다.`
    : status === "payment_method_updated"
      ? paymentMethodUpdatedMessage(updatedCard)
      : "구독이 시작되었습니다. 지금부터 Easy Cut의 모든 플랜 기능을 이용할 수 있습니다.";

  useEffect(() => {
    let active = true;
    void fetch("/api/mvp/state", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("SESSION_CHECK_FAILED");
        const value = await response.json() as {
          user?: unknown;
          billing?: {
            cardIssuer?: unknown;
            cardLast4?: unknown;
          };
        };
        if (active) {
          setSessionCheck(value.user ? "authenticated" : "anonymous");
          if (value.user && value.billing) {
            setUpdatedCard({
              cardIssuer: typeof value.billing.cardIssuer === "string" ? value.billing.cardIssuer : null,
              cardLast4: typeof value.billing.cardLast4 === "string" ? value.billing.cardLast4 : null,
            });
          }
        }
      })
      .catch(() => {
        if (active) setSessionCheck("unavailable");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!checkoutId) return;
    let active = true;
    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      try {
        const response = await fetch(`/api/billing/orders/${encodeURIComponent(checkoutId)}`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error("ORDER_STATUS_FAILED");
        const value = await response.json() as {
          kind?: string;
          productCode?: string;
          orderName?: string;
          status?: string;
          refund?: { mode: string; amountKrw: number; processingBusinessDays: number };
          installmentMonths?: number;
        };
        if (!active) return;
        setOrderDetail({
          kind: value.kind,
          productCode: value.productCode,
          orderName: value.orderName,
          refund: value.refund,
          installmentMonths: value.installmentMonths,
        });
        if (value.status === "succeeded") return setOrderState("succeeded");
        if (value.status === "failed" || value.status === "expired" || value.status === "canceled") {
          return setOrderState("failed");
        }
        if (value.status === "manual_review" || value.status === "unknown") {
          return setOrderState("manual_review");
        }
      } catch {
        // A transient status-read failure does not change the provider payment outcome.
      }
      if (active && attempts < 80 && (orderState === "pending" || orderState === "idle")) window.setTimeout(() => { void poll(); }, 1_500);
      else if (active) setOrderState("manual_review");
    };
    void poll();
    return () => { active = false; };
  }, [checkoutId, orderState]);

  return (
    <BillingResult
      status={message}
      title={status === "payment_method_updated" ? "결제 카드가 변경되었습니다" : undefined}
      error={orderState === "failed"}
      actionPending={sessionCheck === "checking" || orderState === "pending"}
      pendingLabel={orderState === "pending" ? "결제 상태 확인 중..." : "로그인 상태 확인 중..."}
      actionHref={sessionCheck === "anonymous" ? "/auth/sign-in?next=%2F" : "/#workspace"}
      actionLabel={sessionCheck === "anonymous" ? "다시 로그인하고 이동" : "Easy Cut으로 이동"}
    />
  );
}
