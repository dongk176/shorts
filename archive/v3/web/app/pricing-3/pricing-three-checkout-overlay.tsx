"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ThePayOnePaymentOverlay } from "@/components/thepayone-payment-overlay";
import type { PurchaseProduct } from "./pricing-three-client";

interface PricingThreeCheckoutOverlayProps {
  product: PurchaseProduct;
  initialName: string;
  initialEmail: string;
  onClose: () => void;
  onComplete: () => void;
}

interface CardFormState {
  cardNumber: string;
  expiry: string;
  password: string;
  identity: string;
  phone: string;
}

interface ConsentState {
  serviceStart: boolean;
  examples: boolean;
  resultPolicy: boolean;
  purchaseTerms: boolean;
}

const initialCardForm: CardFormState = {
  cardNumber: "",
  expiry: "",
  password: "",
  identity: "",
  phone: "",
};

const initialConsents: ConsentState = {
  serviceStart: false,
  examples: false,
  resultPolicy: false,
  purchaseTerms: false,
};

function onlyDigits(value: string, maximum: number) {
  return value.replace(/\D/g, "").slice(0, maximum);
}

export function PricingThreeCheckoutOverlay({
  product,
  initialName,
  initialEmail,
  onClose,
  onComplete,
}: PricingThreeCheckoutOverlayProps) {
  const allConsentId = useId();
  const [step, setStep] = useState<"card" | "review">("card");
  const [card, setCard] = useState<CardFormState>(initialCardForm);
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [consents, setConsents] = useState<ConsentState>(initialConsents);
  const isSubscription = product.kind === "subscription";

  const cardReady = card.cardNumber.length === 16
    && card.expiry.length === 4
    && card.password.length === 2
    && [6, 10].includes(card.identity.length)
    && [10, 11].includes(card.phone.length);
  const allConsented = Object.values(consents).every(Boolean);
  const reviewReady = name.trim().length > 1
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    && allConsented;

  const setConsent = (key: keyof ConsentState, checked: boolean) => {
    setConsents((current) => ({ ...current, [key]: checked }));
  };

  if (step === "card") {
    return (
      <ThePayOnePaymentOverlay
        title="카드 정보"
        busy={false}
        primaryLabel="다음: 구매내용 확인"
        primaryDisabled={!cardReady}
        onClose={onClose}
        onSubmit={() => setStep("review")}
      >
        <div className="mt-3 flex items-center justify-between gap-3 text-xs font-bold">
          <span className="text-[#ff9b8d]">1. 결제수단</span>
          <span className="text-neutral-600">2. 최종 확인</span>
        </div>
        <div className="mt-5 grid gap-4">
          <label className="grid min-w-0 gap-2 text-xs font-bold text-neutral-300">
            카드번호
            <input
              data-payment-autofocus
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={card.cardNumber}
              maxLength={16}
              placeholder="숫자 16자리"
              onChange={(event) => {
                setCard((current) => ({
                  ...current,
                  cardNumber: onlyDigits(event.target.value, 16),
                }));
              }}
              className="min-h-12 w-full min-w-0 rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/60"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid min-w-0 gap-2 text-xs font-bold text-neutral-300">
              유효기간
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={card.expiry}
                maxLength={4}
                placeholder="MMYY"
                onChange={(event) => {
                  setCard((current) => ({
                    ...current,
                    expiry: onlyDigits(event.target.value, 4),
                  }));
                }}
                className="min-h-12 w-full min-w-0 rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/60"
              />
            </label>
            <label className="grid min-w-0 gap-2 text-xs font-bold text-neutral-300">
              카드 비밀번호
              <input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={card.password}
                maxLength={2}
                placeholder="앞 2자리"
                onChange={(event) => {
                  setCard((current) => ({
                    ...current,
                    password: onlyDigits(event.target.value, 2),
                  }));
                }}
                className="min-h-12 w-full min-w-0 rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/60"
              />
            </label>
          </div>
          <label className="grid min-w-0 gap-2 text-xs font-bold text-neutral-300">
            생년월일 또는 사업자등록번호
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={card.identity}
              maxLength={10}
              placeholder="개인 6자리 · 법인 10자리"
              onChange={(event) => {
                setCard((current) => ({
                  ...current,
                  identity: onlyDigits(event.target.value, 10),
                }));
              }}
              className="min-h-12 w-full min-w-0 rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/60"
            />
          </label>
          <label className="grid min-w-0 gap-2 text-xs font-bold text-neutral-300">
            휴대전화번호
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              value={card.phone}
              maxLength={11}
              placeholder="- 없이 입력"
              onChange={(event) => {
                setCard((current) => ({
                  ...current,
                  phone: onlyDigits(event.target.value, 11),
                }));
              }}
              className="min-h-12 w-full min-w-0 rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/60"
            />
          </label>
        </div>
      </ThePayOnePaymentOverlay>
    );
  }

  return (
    <ThePayOnePaymentOverlay
      title="구매내용 최종 확인"
      busy={false}
      primaryLabel="결제하기"
      primaryDisabled={!reviewReady}
      secondaryLabel="이전"
      onSecondary={() => setStep("card")}
      onClose={onClose}
      onSubmit={onComplete}
    >
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="grid min-w-0 gap-2 text-xs font-bold text-neutral-300">
          구매자명
          <input
            data-payment-autofocus
            type="text"
            autoComplete="name"
            value={name}
            placeholder="이름"
            onChange={(event) => setName(event.target.value)}
            className="min-h-12 w-full min-w-0 rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/60"
          />
        </label>
        <label className="grid min-w-0 gap-2 text-xs font-bold text-neutral-300">
          이메일
          <input
            type="email"
            autoComplete="email"
            value={email}
            placeholder="name@example.com"
            onChange={(event) => setEmail(event.target.value)}
            className="min-h-12 w-full min-w-0 rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/60"
          />
        </label>
      </div>

      <fieldset className="mt-5 rounded-2xl border border-white/10 bg-white/[.025] p-4">
        <legend className="sr-only">필수 구매 동의</legend>
        <label
          htmlFor={allConsentId}
          className="flex cursor-pointer items-start gap-3 border-b border-white/10 pb-4 text-sm font-black text-white"
        >
          <input
            id={allConsentId}
            type="checkbox"
            checked={allConsented}
            onChange={(event) => {
              const checked = event.target.checked;
              setConsents({
                serviceStart: checked,
                examples: checked,
                resultPolicy: checked,
                purchaseTerms: checked,
              });
            }}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#ff715e]"
          />
          아래 필수 항목에 모두 동의합니다
        </label>

        <div className="mt-4 grid gap-3.5">
          <label className="flex cursor-pointer items-start gap-3 text-xs leading-5 text-neutral-300">
            <input
              type="checkbox"
              checked={consents.serviceStart}
              onChange={(event) => setConsent("serviceStart", event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#ff715e]"
            />
            <span>
              <b className="text-[#ff9b8d]">[필수]</b>{" "}
              {isSubscription
                ? "결제 완료 즉시 60분이 지급되고 디지털 서비스 제공이 시작되며, 해지 전까지 매월 9,900원이 자동결제됨을 확인합니다."
                : "결제 완료 즉시 전체 사용량이 지급되고 디지털 서비스 제공이 시작되며, 모든 사용량은 지급일부터 12개월 동안 유효함을 확인합니다."}
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 text-xs leading-5 text-neutral-300">
            <input
              type="checkbox"
              checked={consents.examples}
              onChange={(event) => setConsent("examples", event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#ff715e]"
            />
            <span>
              <b className="text-[#ff9b8d]">[필수]</b> 결제 전 예시 작업과 지원
              범위를 확인했으며, AI 결과는 원본·설정에 따라 예시와 달라질 수 있음을 이해합니다.
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 text-xs leading-5 text-neutral-300">
            <input
              type="checkbox"
              checked={consents.resultPolicy}
              onChange={(event) => setConsent("resultPolicy", event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#ff715e]"
            />
            <span>
              <b className="text-[#ff9b8d]">[필수]</b> 정상 완료된 AI 작업은
              취향·기대 차이 등 주관적 불만족으로 사용량이 복구되지 않으며, 서버 오류로 결과물이
              생성되지 않은 작업은 차감 사용량이 복구됨을 확인합니다.
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 text-xs leading-5 text-neutral-300">
            <input
              type="checkbox"
              checked={consents.purchaseTerms}
              onChange={(event) => setConsent("purchaseTerms", event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#ff715e]"
            />
            <span>
              <b className="text-[#ff9b8d]">[필수]</b>{" "}
              <Link
                href="/purchase-terms"
                target="_blank"
                className="font-black text-[#ff9b8d] underline underline-offset-2"
              >
                구매약관
              </Link>
              과{" "}
              <Link
                href="/refund"
                target="_blank"
                className="font-black text-[#ff9b8d] underline underline-offset-2"
              >
                취소·환불 정책
              </Link>
              을 확인했습니다.{" "}
              {isSubscription
                ? "월간 구독의 결제·해지 조건을 이해하며 관계 법령상 권리는 제외되지 않음을 확인합니다."
                : "미사용 잔액은 회사의 임의 환불 대상이 아니며 관계 법령상 권리는 제외되지 않음을 이해합니다."}
            </span>
          </label>
        </div>
      </fieldset>
    </ThePayOnePaymentOverlay>
  );
}
