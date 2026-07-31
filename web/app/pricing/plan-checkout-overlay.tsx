"use client";

import { PaymentMessageOverlay } from "@/components/payment-message-overlay";
import { CardIssuerSelect } from "@/components/card-issuer-select";
import { InstallmentBenefitsAccordion } from "@/components/installment-benefits-accordion";
import { InstallmentSelect } from "@/components/installment-select";
import {
  ManualCardKindSelect,
  type ManualCardKind,
} from "@/components/manual-card-kind-select";
import { PurchaseTermsConsent } from "@/components/purchase-terms-consent";
import { SelectedPaymentCard } from "@/components/selected-payment-card";
import { ThePayOnePaymentOverlay } from "@/components/thepayone-payment-overlay";
import {
  billingPostJson,
  BillingClientError,
  purchaseAddonWithManualCard,
  purchasePlanWithSavedCard,
} from "@/lib/billing-client";
import { MANUAL_INSTALLMENT_MAX_MONTHS } from "@/lib/installment-policy";
import type { InstallmentOffer } from "@/lib/installments";
import type { PricingV2PlanProduct } from "@/lib/pricing-v2";
import { userFacingErrorMessage } from "@/lib/public-error";
import { useEffect, useRef, useState } from "react";

type CheckoutMode = "subscribe" | "change_subscription" | "purchase_addon";

export type AddonCheckoutProduct = {
  code: string;
  kind: "addon";
  displayName: string;
  billingCycle: "yearly";
  durationMonths: 0;
  monthlyPriceKrw: number;
  totalPriceKrw: number;
  minutes: number;
  validityDays: number;
};

type CheckoutProduct = PricingV2PlanProduct | AddonCheckoutProduct;

type CheckoutForm = {
  cardNumberParts: string[];
  expiryMonth: string;
  expiryYear: string;
  cardPassword: string;
  identityNumber: string;
  payerName: string;
  payerEmail: string;
  payerTel: string;
  consent: boolean;
};

type ManualCardValidationField =
  | "cardKind"
  | "issuer"
  | "cardNumber"
  | "expiryMonth"
  | "expiryYear"
  | "cardPassword"
  | "identityNumber"
  | "payerTel"
  | "consent"
  | "installments";

type ActivationResult = {
  checkoutId?: string;
  manualReview?: boolean;
};

type CardVerification = {
  id: string;
  issuer: string | null;
  cardType: string | null;
  last4: string | null;
  expiresAt: string;
};

export type CheckoutInstallmentOffer = InstallmentOffer & {
  productKind: "package" | "addon";
  productCode: string;
  amountKrw: number;
  paymentFlow: "legacy" | "manual_direct" | "disabled";
};

type ChangeQuote = {
  chargeAmountKrw: number;
};

const priceFormatter = new Intl.NumberFormat("ko-KR");

function digits(value: string, maxLength: number) {
  return value.replace(/[^0-9]/g, "").slice(0, maxLength);
}

function installmentBenefitDescription(
  option: InstallmentOffer["selectableOptions"][number],
) {
  if (option.benefitType === "interest_free") return "무이자";
  if (option.benefitType === "partial_interest_free") {
    return option.customerPaidInstallments
      ? `부분 무이자 · 1~${option.customerPaidInstallments}회 고객부담`
      : "부분 무이자";
  }
  return "일반 할부 · 이자 발생 가능";
}

export function PlanCheckoutOverlay({
  mode,
  product,
  initialName,
  initialEmail,
  savedPaymentMethod,
  initialInstallmentOffer,
  preferredInstallmentMonths,
  onClose,
}: {
  mode: CheckoutMode;
  product: CheckoutProduct;
  initialName?: string | null;
  initialEmail?: string | null;
  savedPaymentMethod?: {
    hasStoredPayerTel: boolean;
    issuer: string | null;
    last4: string | null;
  } | null;
  initialInstallmentOffer?: CheckoutInstallmentOffer | null;
  preferredInstallmentMonths?: number;
  onClose: () => void;
}) {
  const isOneTimeProduct = product.kind === "package" || product.kind === "addon";
  const defaultInstallmentMonths = preferredInstallmentMonths
    ?? (product.kind === "package" ? product.durationMonths : undefined);
  const [step, setStep] = useState<"card" | "payer">("card");
  const cardPartRefs = useRef<Array<HTMLInputElement | null>>([]);
  const consentRef = useRef<HTMLDivElement | null>(null);
  const previousPayerTelCompleteRef = useRef(false);
  const [form, setForm] = useState<CheckoutForm>({
    cardNumberParts: ["", "", "", ""],
    expiryMonth: "",
    expiryYear: "",
    cardPassword: "",
    identityNumber: "",
    payerName: initialName?.trim() || initialEmail?.split("@", 1)[0] || "Easy Cut 고객",
    payerEmail: initialEmail || "",
    payerTel: "",
    consent: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorTitle, setErrorTitle] = useState("결제를 확인해 주세요");
  const [changeQuote, setChangeQuote] = useState<ChangeQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(mode === "change_subscription");
  const [cardVerification, setCardVerification] = useState<CardVerification | null>(null);
  const [installmentOffer, setInstallmentOffer] = useState<CheckoutInstallmentOffer | null>(
    initialInstallmentOffer || null,
  );
  const [paymentFlow, setPaymentFlow] = useState<
    CheckoutInstallmentOffer["paymentFlow"] | null
  >(
    isOneTimeProduct
      ? initialInstallmentOffer?.paymentFlow || null
      : "legacy",
  );
  const [installmentLoading, setInstallmentLoading] = useState(
    isOneTimeProduct && !initialInstallmentOffer,
  );
  const [installmentReloadKey, setInstallmentReloadKey] = useState(0);
  const [installmentMonths, setInstallmentMonths] = useState(0);
  const [installmentIssuerCode, setInstallmentIssuerCode] = useState("");
  const [installmentIssuerAttention, setInstallmentIssuerAttention] = useState(false);
  const [providerMaxInstallmentMonths, setProviderMaxInstallmentMonths] = useState<
    number | null
  >(null);
  const [manualCardKind, setManualCardKind] = useState<ManualCardKind | "">("");
  const [manualCardKindAttention, setManualCardKindAttention] = useState(false);
  const [manualCardValidationField, setManualCardValidationField] = useState<
    ManualCardValidationField | null
  >(null);
  const [useSavedPaymentMethod, setUseSavedPaymentMethod] = useState(
    Boolean(savedPaymentMethod),
  );
  const cardVerificationIdRef = useRef<string | null>(null);
  const operationInFlightRef = useRef(false);
  const paymentRequestIdRef = useRef("");
  const preferredInstallmentPendingRef = useRef(Boolean(
    initialInstallmentOffer?.paymentFlow === "manual_direct"
    && defaultInstallmentMonths
    && initialInstallmentOffer.selectableMonths.includes(defaultInstallmentMonths),
  ));
  if (!paymentRequestIdRef.current) {
    paymentRequestIdRef.current = crypto.randomUUID();
  }
  const isManualOneTime = isOneTimeProduct && paymentFlow === "manual_direct";
  const isOneTimeFlowLoading = isOneTimeProduct && paymentFlow === null;
  const isOneTimeFlowDisabled = isOneTimeProduct && paymentFlow === "disabled";
  const usesSavedPaymentMethod = Boolean(
    !isManualOneTime
    && savedPaymentMethod
    && useSavedPaymentMethod,
  );

  const chargeAmount = mode === "change_subscription"
    ? changeQuote?.chargeAmountKrw ?? null
    : product.totalPriceKrw;
  const packageTerms = product.kind === "package"
    ? {
      months: product.durationMonths,
      monthlyPriceKrw: product.monthlyPriceKrw,
    }
    : undefined;
  const cardLimitedInstallmentOffer = (
    installmentOffer
    && providerMaxInstallmentMonths !== null
  )
    ? {
      ...installmentOffer,
      terms: installmentOffer.terms.filter(
        (term) => term.installmentMonths <= providerMaxInstallmentMonths,
      ),
      selectableMonths: installmentOffer.selectableMonths.filter(
        (months) => months <= providerMaxInstallmentMonths,
      ),
      selectableOptions: installmentOffer.selectableOptions.filter(
        (option) => option.installmentMonths <= providerMaxInstallmentMonths,
      ),
    }
    : installmentOffer;
  const selectedInstallmentOption = cardLimitedInstallmentOffer?.selectableOptions.find((option) => (
    option.issuerCode === installmentIssuerCode
    && option.installmentMonths === installmentMonths
  ));
  const installmentIssuerOptions = [...new Map(
    (cardLimitedInstallmentOffer?.selectableOptions || [])
      .map((option) => [option.issuerCode, {
        value: option.issuerCode,
        label: option.issuerName,
      }]),
  ).values()];
  const selectedIssuerInstallmentMonths = [...new Set(
    (cardLimitedInstallmentOffer?.selectableOptions || [])
      .filter((option) => (
        option.issuerCode === installmentIssuerCode
      ))
      .map((option) => option.installmentMonths),
  )].sort((left, right) => left - right);
  const selectedIssuerInstallmentDetails = Object.fromEntries(
    (cardLimitedInstallmentOffer?.selectableOptions || [])
      .filter((option) => (
        option.issuerCode === installmentIssuerCode
      ))
      .map((option) => [
        option.installmentMonths,
        installmentBenefitDescription(option),
      ]),
  );
  const selectedIssuerInterestFreeMonths = (
    cardLimitedInstallmentOffer?.selectableOptions || []
  )
    .filter((option) => (
      option.issuerCode === installmentIssuerCode
      && option.benefitType === "interest_free"
    ))
    .map((option) => option.installmentMonths);
  const requiresManualCardKind = isManualOneTime;
  const requiresInstallmentIssuer = Boolean(
    isManualOneTime
    && manualCardKind === "credit"
    && chargeAmount !== null
    && chargeAmount >= 50_000
    && installmentIssuerOptions.length > 0,
  );
  const cardNumber = form.cardNumberParts.join("");
  const cardNumberComplete = cardNumber.length === 16;
  const expiryComplete = (
    /^(0[1-9]|1[0-2])$/.test(form.expiryMonth)
    && /^\d{2}$/.test(form.expiryYear)
  );
  const cardCredentialsComplete = (
    digits(form.cardPassword, 2).length === 2
    && [6, 10].includes(digits(form.identityNumber, 10).length)
  );
  const payerTelComplete = /^\d{10,11}$/.test(digits(form.payerTel, 11));
  const showManualCardNumber = (
    !isManualOneTime
    || Boolean(
      manualCardKind
      && (!requiresInstallmentIssuer || installmentIssuerCode),
    )
  );
  const showManualExpiry = !isManualOneTime || (showManualCardNumber && cardNumberComplete);
  const showManualCardCredentials = !isManualOneTime || expiryComplete;
  const showManualPayerTel = !isManualOneTime || cardCredentialsComplete;
  const showManualConsent = !isManualOneTime || payerTelComplete;
  const cardStepValid = (
    cardNumberComplete
    && expiryComplete
    && cardCredentialsComplete
    && payerTelComplete
    && (!isOneTimeProduct || (paymentFlow !== null && paymentFlow !== "disabled"))
    && (!requiresManualCardKind || Boolean(manualCardKind))
    && (!requiresInstallmentIssuer || Boolean(installmentIssuerCode))
    && form.consent
    && !installmentLoading
  );
  const payerStepValid = Boolean(
    (
      product.kind === "package"
      || product.kind === "addon"
      || (
        cardVerification
        && new Date(cardVerification.expiresAt) > new Date()
      )
    )
    && chargeAmount !== null
    && !quoteLoading
    && !installmentLoading
    && (!isOneTimeProduct || (paymentFlow !== null && paymentFlow !== "disabled"))
    && (!isManualOneTime || installmentOffer !== null)
    && (!isManualOneTime || Boolean(manualCardKind))
    && (!isManualOneTime || manualCardKind !== "debit_prepaid" || installmentMonths === 0)
    && (!isManualOneTime || installmentMonths === 0 || Boolean(selectedInstallmentOption))
    && (!isManualOneTime || form.consent)
    && Boolean(form.payerName.trim())
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.payerEmail.trim()),
  );
  const savedCardValid = Boolean(
    chargeAmount !== null
    && !quoteLoading
    && [6, 10].includes(digits(form.identityNumber, 10).length)
    && digits(form.cardPassword, 2).length === 2
    && (savedPaymentMethod?.hasStoredPayerTel || /^\d{10,11}$/.test(digits(form.payerTel, 11)))
    && form.consent
  );
  const manualCardValidationMessages: Record<ManualCardValidationField, string> = {
    cardKind: "카드 종류를 선택해 주세요.",
    issuer: "카드사를 선택해 주세요.",
    cardNumber: "카드번호 16자리를 확인해 주세요.",
    expiryMonth: "유효기간 월을 두 자리로 입력해 주세요.",
    expiryYear: "유효기간 연도를 두 자리로 입력해 주세요.",
    cardPassword: "카드 비밀번호 앞 2자리를 입력해 주세요.",
    identityNumber: "생년월일 6자리 또는 사업자번호 10자리를 입력해 주세요.",
    payerTel: "휴대전화 번호 10~11자리를 입력해 주세요.",
    consent: "구매약관 및 취소·환불 규정에 동의해 주세요.",
    installments: "결제 옵션을 확인하고 있습니다. 잠시 후 다시 눌러 주세요.",
  };

  function firstManualCardValidationField(): ManualCardValidationField | null {
    if (!manualCardKind) return "cardKind";
    if (requiresInstallmentIssuer && !installmentIssuerCode) return "issuer";
    if (!cardNumberComplete) return "cardNumber";
    if (!/^(0[1-9]|1[0-2])$/.test(form.expiryMonth)) return "expiryMonth";
    if (!/^\d{2}$/.test(form.expiryYear)) return "expiryYear";
    if (digits(form.cardPassword, 2).length !== 2) return "cardPassword";
    if (![6, 10].includes(digits(form.identityNumber, 10).length)) {
      return "identityNumber";
    }
    if (!/^\d{10,11}$/.test(digits(form.payerTel, 11))) return "payerTel";
    if (!form.consent) return "consent";
    if (installmentLoading) return "installments";
    return null;
  }

  function showManualCardValidationIssue() {
    const field = firstManualCardValidationField();
    if (!field) return false;
    setManualCardValidationField(field);
    if (field === "cardKind") setManualCardKindAttention(true);
    if (field === "issuer") setInstallmentIssuerAttention(true);
    const selector = field === "cardKind"
      ? '[data-card-kind-option="credit"]'
      : field === "issuer" || field === "installments"
        ? "[data-card-issuer-trigger]"
        : `[data-manual-card-field="${field}"]`;
    window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(selector);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus();
    });
    return true;
  }

  function clearManualCardValidationField(field: ManualCardValidationField) {
    setManualCardValidationField((current) => current === field ? null : current);
  }

  const finalPaymentLabel = chargeAmount === null
    ? "결제정보 확인 중..."
    : installmentMonths > 0
      ? `${priceFormatter.format(Math.floor(chargeAmount / installmentMonths))}원/월 할부 결제`
      : "일시불로 결제";

  useEffect(() => {
    const payerTelJustCompleted = (
      isManualOneTime
      && step === "card"
      && payerTelComplete
      && !previousPayerTelCompleteRef.current
    );
    previousPayerTelCompleteRef.current = (
      isManualOneTime
      && step === "card"
      && payerTelComplete
    );
    if (!payerTelJustCompleted) return;
    const frame = window.requestAnimationFrame(() => {
      consentRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isManualOneTime, payerTelComplete, step]);

  useEffect(() => () => {
    const verificationId = cardVerificationIdRef.current;
    if (!verificationId) return;
    cardVerificationIdRef.current = null;
    void fetch(`/api/billing/card-verifications/${verificationId}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      keepalive: true,
    });
  }, []);

  useEffect(() => {
    if (mode !== "change_subscription") {
      setQuoteLoading(false);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({
      planCode: product.code,
      billingCycle: product.billingCycle,
    });
    fetch(`/api/billing/subscription/change?${params}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const value = await response.json().catch(() => ({})) as ChangeQuote & { detail?: string };
        if (!response.ok) throw new Error(value.detail || "결제금액을 불러오지 못했습니다.");
        setChangeQuote(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(userFacingErrorMessage(cause, "결제금액을 불러오지 못했습니다."));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setQuoteLoading(false);
      });
    return () => controller.abort();
  }, [mode, product.billingCycle, product.code]);

  useEffect(() => {
    if (!isOneTimeProduct) return;
    if (initialInstallmentOffer) {
      setInstallmentOffer(initialInstallmentOffer);
      setPaymentFlow(initialInstallmentOffer.paymentFlow);
      preferredInstallmentPendingRef.current = Boolean(
        initialInstallmentOffer.paymentFlow === "manual_direct"
        && defaultInstallmentMonths
        && initialInstallmentOffer.selectableMonths.includes(defaultInstallmentMonths)
      );
      setInstallmentMonths(0);
      setInstallmentLoading(false);
      if (initialInstallmentOffer.paymentFlow === "manual_direct") {
        setUseSavedPaymentMethod(false);
      }
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams(
      product.kind === "package"
        ? { planCode: product.code }
        : { addonCode: product.code },
    );
    setInstallmentLoading(true);
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 10_000);
    fetch(`/api/billing/installments?${params}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const value = await response.json().catch(() => ({})) as (
          CheckoutInstallmentOffer & { detail?: string }
        );
        if (!response.ok) {
          throw new Error(value.detail || "결제 옵션을 불러오지 못했습니다.");
        }
        setInstallmentOffer(value);
        setPaymentFlow(value.paymentFlow);
        setInstallmentIssuerCode("");
        preferredInstallmentPendingRef.current = Boolean(
          value.paymentFlow === "manual_direct"
          && defaultInstallmentMonths
          && value.selectableMonths.includes(defaultInstallmentMonths)
        );
        setInstallmentMonths(0);
        if (value.paymentFlow === "manual_direct") {
          setUseSavedPaymentMethod(false);
        } else if (value.paymentFlow === "disabled") {
          setError(`${product.kind === "package" ? "패키지" : "추가시간"} 결제가 현재 중지되어 있습니다.`);
        }
      })
      .catch((cause) => {
        if (timedOut) {
          setPaymentFlow("disabled");
          setError("결제 옵션 확인 시간이 초과되었습니다. 다시 불러와 주세요.");
        } else if (!controller.signal.aborted) {
          setPaymentFlow("disabled");
          setError(userFacingErrorMessage(cause, "결제 옵션을 불러오지 못했습니다."));
        }
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (timedOut || !controller.signal.aborted) setInstallmentLoading(false);
      });
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [
    initialInstallmentOffer,
    isOneTimeProduct,
    defaultInstallmentMonths,
    installmentReloadKey,
    product.code,
    product.kind,
  ]);

  function update<Key extends keyof CheckoutForm>(key: Key, value: CheckoutForm[Key]) {
    if (key === "cardNumberParts") setProviderMaxInstallmentMonths(null);
    const verificationId = key === "payerName" || key === "payerEmail"
      ? null
      : cardVerificationIdRef.current;
    if (verificationId) {
      cardVerificationIdRef.current = null;
      setCardVerification(null);
      setInstallmentMonths(0);
      if (product.kind === "package") setInstallmentOffer(null);
      void billingPostJson(
        `/api/billing/card-verifications/${verificationId}/revoke`,
        {},
      ).catch(() => undefined);
    }
    setForm((current) => ({ ...current, [key]: value }));
  }

  function selectInstallmentIssuer(issuerCode: string) {
    const supportedMonths = (cardLimitedInstallmentOffer?.selectableOptions || [])
      .filter((option) => option.issuerCode === issuerCode)
      .map((option) => option.installmentMonths);
    setInstallmentIssuerCode(issuerCode);
    setInstallmentIssuerAttention(false);
    setInstallmentMonths((currentMonths) => {
      if (currentMonths > 0 && supportedMonths.includes(currentMonths)) {
        preferredInstallmentPendingRef.current = false;
        return currentMonths;
      }
      if (
        preferredInstallmentPendingRef.current
        && defaultInstallmentMonths
        && supportedMonths.includes(defaultInstallmentMonths)
      ) {
        preferredInstallmentPendingRef.current = false;
        return defaultInstallmentMonths;
      }
      if (!defaultInstallmentMonths) {
        preferredInstallmentPendingRef.current = false;
      }
      return 0;
    });
  }

  function selectManualCardKind(cardKind: ManualCardKind) {
    setManualCardKindAttention(false);
    if (cardKind === manualCardKind) return;
    const preferredMonths = (
      cardKind === "credit"
      && defaultInstallmentMonths
      && cardLimitedInstallmentOffer?.selectableMonths.includes(defaultInstallmentMonths)
    )
      ? defaultInstallmentMonths
      : 0;
    setManualCardKind(cardKind);
    setInstallmentIssuerCode("");
    setInstallmentIssuerAttention(false);
    setInstallmentMonths(preferredMonths);
    preferredInstallmentPendingRef.current = preferredMonths > 0;
  }

  function updateCardNumberPart(index: number, rawValue: string) {
    const value = digits(rawValue, 16);
    const nextParts = [...form.cardNumberParts];
    if (value.length <= 4) {
      nextParts[index] = value;
      update("cardNumberParts", nextParts);
      if (value.length === 4 && index < 3) {
        window.requestAnimationFrame(() => cardPartRefs.current[index + 1]?.focus());
      }
      return;
    }
    let cursor = 0;
    for (let partIndex = index; partIndex < 4; partIndex += 1) {
      nextParts[partIndex] = value.slice(cursor, cursor + 4);
      cursor += 4;
    }
    update("cardNumberParts", nextParts);
    const destination = Math.min(3, index + Math.ceil(value.length / 4) - 1);
    window.requestAnimationFrame(() => cardPartRefs.current[destination]?.focus());
  }

  function pasteCardNumber(index: number, event: React.ClipboardEvent<HTMLInputElement>) {
    const value = digits(event.clipboardData.getData("text"), 16);
    if (value.length <= 4) return;
    event.preventDefault();
    updateCardNumberPart(index, value);
  }

  async function reloadInstallmentOffer() {
    if (!isOneTimeProduct) return;
    const params = new URLSearchParams(
      product.kind === "package"
        ? { planCode: product.code }
        : { addonCode: product.code },
    );
    setInstallmentLoading(true);
    try {
      const response = await fetch(`/api/billing/installments?${params}`, {
        cache: "no-store",
      });
      const value = await response.json().catch(() => ({})) as (
        CheckoutInstallmentOffer & { detail?: string }
      );
      if (!response.ok) {
        throw new Error(value.detail || "할부 혜택을 다시 불러오지 못했습니다.");
      }
      setInstallmentOffer(value);
      setPaymentFlow(value.paymentFlow);
    } finally {
      setInstallmentLoading(false);
    }
  }

  async function verifyCard() {
    if (!cardStepValid || busy || operationInFlightRef.current) return;
    if (
      product.kind !== "package"
      && product.kind !== "addon"
      &&
      cardVerification
      && new Date(cardVerification.expiresAt) > new Date()
    ) {
      setStep("payer");
      return;
    }
    operationInFlightRef.current = true;
    setBusy(true);
    setError(null);
    setErrorTitle("카드 정보를 확인해 주세요");
    try {
      if (product.kind === "package" || isManualOneTime) {
        setStep("payer");
        return;
      }
      const result = await billingPostJson<{ verification: CardVerification }>(
        "/api/billing/card-verifications",
        {
          requestId: crypto.randomUUID(),
          mode,
          planCode: product.code,
          billingCycle: product.billingCycle,
          payerName: form.payerName.trim(),
          payerEmail: form.payerEmail.trim(),
          payerTel: digits(form.payerTel, 11),
          cardNumber,
          expiryYear: form.expiryYear,
          expiryMonth: form.expiryMonth,
          identityNumber: digits(form.identityNumber, 10),
          cardPassword: digits(form.cardPassword, 2),
          consent: true,
        },
      );
      cardVerificationIdRef.current = result.verification.id;
      setCardVerification(result.verification);
      setInstallmentMonths(0);
      setStep("payer");
    } catch (cause) {
      const verificationId = cardVerificationIdRef.current;
      if (verificationId) {
        cardVerificationIdRef.current = null;
        setCardVerification(null);
        setInstallmentOffer(product.kind === "package" ? null : installmentOffer);
        void billingPostJson(
          `/api/billing/card-verifications/${verificationId}/revoke`,
          {},
        ).catch(() => undefined);
      }
      setError(cause instanceof Error
        ? cause.message
        : "카드 정보를 확인하지 못했습니다. 입력값을 다시 확인해 주세요.");
    } finally {
      setInstallmentLoading(false);
      operationInFlightRef.current = false;
      setBusy(false);
    }
  }

  async function completePayment() {
    if (
      !payerStepValid
      || busy
      || operationInFlightRef.current
      || (
        product.kind !== "package"
        && product.kind !== "addon"
        && !cardVerification
      )
    ) return;
    operationInFlightRef.current = true;
    setBusy(true);
    setError(null);
    setErrorTitle("결제를 확인해 주세요");
    try {
      const result: ActivationResult = product.kind === "addon"
        ? await purchaseAddonWithManualCard({
          requestId: paymentRequestIdRef.current,
          addonCode: product.code,
          expectedChargeAmountKrw: product.totalPriceKrw,
          payerName: form.payerName.trim(),
          payerEmail: form.payerEmail.trim(),
          payerTel: digits(form.payerTel, 11),
          cardNumber,
          expiryYear: form.expiryYear,
          expiryMonth: form.expiryMonth,
          identityNumber: digits(form.identityNumber, 10),
          cardPassword: digits(form.cardPassword, 2),
          declaredCardKind: manualCardKind as ManualCardKind,
          installmentMonths,
          installmentCampaignId: installmentMonths > 0
            ? installmentOffer?.campaignId || null
            : null,
          installmentIssuerCode: installmentMonths > 0
            ? installmentIssuerCode
            : null,
        })
        : await billingPostJson<ActivationResult>("/api/billing/activate", {
          mode,
          requestId: paymentRequestIdRef.current,
          planCode: product.code,
          billingCycle: product.billingCycle,
          payerName: form.payerName.trim(),
          payerEmail: form.payerEmail.trim(),
          payerTel: digits(form.payerTel, 11),
          cardNumber,
          expiryYear: form.expiryYear,
          expiryMonth: form.expiryMonth,
          ...(product.kind === "package"
            ? {}
            : { cardVerificationId: cardVerification!.id }),
          identityNumber: digits(form.identityNumber, 10),
          cardPassword: digits(form.cardPassword, 2),
          declaredCardKind: manualCardKind || undefined,
          consent: true,
          installmentMonths,
          installmentCampaignId: installmentMonths > 0
            ? installmentOffer?.campaignId || null
            : null,
          installmentIssuerCode: installmentMonths > 0
            ? installmentIssuerCode
            : null,
        });
      cardVerificationIdRef.current = null;
      const success = new URL("/billing/success", window.location.origin);
      success.searchParams.set("flow", product.kind === "addon" ? "addon" : "subscription");
      success.searchParams.set(
        "status",
        result.manualReview
          ? "pending"
          : product.kind === "addon" ? "addon_granted" : "activated",
      );
      success.searchParams.set("source", "pricing");
      if (result.checkoutId) success.searchParams.set("checkoutId", result.checkoutId);
      window.location.assign(success);
    } catch (cause) {
      setError(userFacingErrorMessage(cause, "결제를 완료하지 못했습니다."));
      if (cause instanceof BillingClientError && cause.code === "INSTALLMENT_CAMPAIGN_CHANGED") {
        setInstallmentMonths(0);
        setInstallmentIssuerCode("");
        setErrorTitle("할부 혜택이 변경되었습니다");
        await reloadInstallmentOffer().catch(() => undefined);
      } else if (
        isManualOneTime
        && cause instanceof BillingClientError
        && cause.code === "INSTALLMENT_LIMIT_EXCEEDED"
        && cause.maxInstallmentMonths !== null
      ) {
        const maxInstallmentMonths = cause.maxInstallmentMonths;
        paymentRequestIdRef.current = crypto.randomUUID();
        setProviderMaxInstallmentMonths((current) => (
          current === null
            ? maxInstallmentMonths
            : Math.min(current, maxInstallmentMonths)
        ));
        preferredInstallmentPendingRef.current = false;
        setInstallmentMonths(0);
        setStep("payer");
        setErrorTitle("할부 개월수를 다시 선택해 주세요");
        setError(
          `해당 카드는 최대 ${maxInstallmentMonths}개월 할부까지 지원합니다.`,
        );
      } else if (
        isManualOneTime
        && cause instanceof BillingClientError
        && cause.code === "THEPAYONE_REJECTED"
      ) {
        paymentRequestIdRef.current = crypto.randomUUID();
        setProviderMaxInstallmentMonths(null);
        setStep("card");
        setInstallmentMonths(0);
        setInstallmentIssuerCode("");
        setForm((current) => ({
          ...current,
          cardNumberParts: ["", "", "", ""],
          expiryMonth: "",
          expiryYear: "",
          cardPassword: "",
          identityNumber: "",
        }));
      } else if (isManualOneTime) {
        setErrorTitle("승인 여부를 확인해 주세요");
        setError(
          "결제 결과를 확정하지 못했습니다. 중복 결제를 막기 위해 새 주문으로 다시 결제하지 마세요. 같은 화면에서 다시 확인하면 기존 요청 ID로만 조회·처리됩니다.",
        );
      }
    } finally {
      operationInFlightRef.current = false;
      setBusy(false);
    }
  }

  async function completeSavedPayment() {
    if (
      mode === "purchase_addon"
      || product.kind === "addon"
      || !usesSavedPaymentMethod
      || !savedCardValid
      || chargeAmount === null
      || busy
      || operationInFlightRef.current
    ) return;
    operationInFlightRef.current = true;
    setBusy(true);
    setError(null);
    setErrorTitle("결제를 확인해 주세요");
    try {
      const result = await purchasePlanWithSavedCard({
        mode,
        planCode: product.code,
        billingCycle: product.billingCycle,
        expectedChargeAmountKrw: chargeAmount,
        identityNumber: digits(form.identityNumber, 10),
        cardPassword: digits(form.cardPassword, 2),
        ...(savedPaymentMethod?.hasStoredPayerTel
          ? {}
          : { payerTel: digits(form.payerTel, 11) }),
      });
      const success = new URL("/billing/success", window.location.origin);
      success.searchParams.set("flow", "subscription");
      success.searchParams.set("status", "activated");
      success.searchParams.set("source", "pricing");
      if (result.checkoutId) success.searchParams.set("checkoutId", result.checkoutId);
      window.location.assign(success);
    } catch (cause) {
      setError(userFacingErrorMessage(cause, "결제를 완료하지 못했습니다."));
    } finally {
      operationInFlightRef.current = false;
      setBusy(false);
    }
  }

  function chooseDifferentCard() {
    setUseSavedPaymentMethod(false);
    setStep("card");
    setError(null);
    setProviderMaxInstallmentMonths(null);
    setForm((current) => ({
      ...current,
      cardNumberParts: ["", "", "", ""],
      expiryMonth: "",
      expiryYear: "",
      cardPassword: "",
      payerTel: "",
    }));
    window.requestAnimationFrame(() => cardPartRefs.current[0]?.focus());
  }

  function chooseSavedCard() {
    setUseSavedPaymentMethod(true);
    setStep("card");
    setError(null);
    setForm((current) => ({
      ...current,
      cardPassword: "",
      payerTel: "",
    }));
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>("[data-saved-card-autofocus]")?.focus();
    });
  }

  return (
    <>
      <ThePayOnePaymentOverlay
        title={isOneTimeProduct && paymentFlow !== "legacy"
          ? null
          : usesSavedPaymentMethod || step === "card" ? "카드 정보" : "결제자 정보"}
        busy={busy}
        primaryDisabled={isOneTimeFlowLoading || isOneTimeFlowDisabled
          ? true
          : usesSavedPaymentMethod
          ? !savedCardValid
          : step === "card"
            ? isManualOneTime ? false : !cardStepValid
            : !payerStepValid}
        primaryLabel={isOneTimeFlowLoading
          ? "결제 옵션 확인 중..."
          : isOneTimeFlowDisabled
            ? "결제 불가"
            : busy
          ? usesSavedPaymentMethod || step === "payer"
            ? "결제를 진행하고 있습니다..."
            : isManualOneTime
              ? "결제 옵션을 확인하고 있습니다..."
              : "카드를 확인하고 있습니다..."
          : usesSavedPaymentMethod
            ? quoteLoading || chargeAmount === null ? "결제정보 확인 중..." : "확인"
            : step === "card"
              ? isManualOneTime ? "결제 정보 확인" : "다음"
              : isManualOneTime ? finalPaymentLabel
                : chargeAmount === null ? "결제정보 확인 중..." : "확인"}
        secondaryLabel={usesSavedPaymentMethod
          ? "취소"
          : step === "payer"
            ? "이전"
            : savedPaymentMethod ? "등록 카드 사용" : undefined}
        onPrimaryClick={(event) => {
          if (
            isManualOneTime
            && step === "card"
            && showManualCardValidationIssue()
          ) {
            event.preventDefault();
          }
        }}
        onClose={onClose}
        onSecondary={usesSavedPaymentMethod
          ? onClose
          : step === "payer"
            ? () => setStep("card")
            : savedPaymentMethod ? chooseSavedCard : undefined}
        onSubmit={() => {
          if (usesSavedPaymentMethod) {
            void completeSavedPayment();
          } else if (step === "card") {
            if (!cardStepValid) {
              if (isManualOneTime) {
                showManualCardValidationIssue();
              } else if (!manualCardKind && requiresManualCardKind) {
                document.querySelector<HTMLButtonElement>(
                  '[data-card-kind-option="credit"]',
                )?.focus();
              } else if (requiresInstallmentIssuer && !installmentIssuerCode) {
                document.querySelector<HTMLButtonElement>(
                  "[data-card-issuer-trigger]",
                )?.focus();
              }
              return;
            }
            void verifyCard();
          } else {
            void completePayment();
          }
        }}
      >
        {isOneTimeFlowLoading ? (
          <section
            className="mt-8 rounded-2xl border border-white/10 bg-[#101315] px-5 py-8 text-center"
            aria-live="polite"
            aria-busy="true"
          >
            <span
              className="mx-auto block size-6 animate-spin rounded-full border-2 border-white/15 border-t-[#ff8f80]"
              aria-hidden="true"
            />
            <strong className="mt-4 block text-sm text-white">결제 옵션을 확인하고 있습니다</strong>
            <p className="mt-2 text-xs leading-5 text-neutral-500">
              확인이 끝나면 카드 종류부터 선택할 수 있습니다.
            </p>
          </section>
        ) : isOneTimeFlowDisabled ? (
          <section className="mt-8 rounded-2xl border border-[#ff7868]/20 bg-[#ff7868]/5 px-5 py-7 text-center">
            <strong className="block text-sm text-white">현재 결제를 진행할 수 없습니다</strong>
            <p className="mt-2 text-xs leading-5 text-neutral-400">
              결제 옵션을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
            </p>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setPaymentFlow(null);
                setInstallmentOffer(null);
                setInstallmentReloadKey((current) => current + 1);
              }}
              className="mt-5 min-h-11 rounded-xl border border-[#ff8f80]/45 bg-[#ff7868]/10 px-5 text-sm font-extrabold text-[#ffb0a6] transition hover:border-[#ff8f80]/75 hover:bg-[#ff7868]/15 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#ff715e]/20"
            >
              다시 불러오기
            </button>
          </section>
        ) : usesSavedPaymentMethod ? (
          <div className="mt-8 grid gap-5">
            <SelectedPaymentCard
              card={{
                issuer: savedPaymentMethod?.issuer || null,
                last4: savedPaymentMethod?.last4 || null,
              }}
              disabled={busy}
              onUseDifferentCard={chooseDifferentCard}
            />
            <div className="grid grid-cols-2 gap-3">
              <label className="min-w-0 text-xs font-bold text-neutral-300">
                생년월일 또는 사업자번호
                <input
                  data-payment-autofocus
                  data-saved-card-autofocus
                  required
                  inputMode="numeric"
                  autoComplete="off"
                  value={form.identityNumber}
                  onChange={(event) => update("identityNumber", digits(event.target.value, 10))}
                  placeholder="6자리 또는 10자리"
                  className="mt-2 min-h-14 w-full rounded-2xl border border-white/10 bg-[#101315] px-4 text-base text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10"
                />
              </label>
              <label className="min-w-0 text-xs font-bold text-neutral-300">
                카드 비밀번호 앞 2자리
                <input
                  required
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={form.cardPassword}
                  onChange={(event) => update("cardPassword", digits(event.target.value, 2))}
                  placeholder="••"
                  className="mt-2 min-h-14 w-full rounded-2xl border border-white/10 bg-[#101315] px-4 text-base text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10"
                />
              </label>
            </div>
            {!savedPaymentMethod?.hasStoredPayerTel && (
              <label className="text-xs font-bold text-neutral-300">
                휴대전화 번호
                <input
                  required
                  inputMode="numeric"
                  autoComplete="tel"
                  value={form.payerTel}
                  onChange={(event) => update("payerTel", digits(event.target.value, 11))}
                  placeholder="01012345678"
                  className="mt-2 min-h-14 w-full rounded-2xl border border-white/10 bg-[#101315] px-4 text-base text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10"
                />
              </label>
            )}
            <PurchaseTermsConsent
              checked={form.consent}
              onChange={(consent) => update("consent", consent)}
              packageTerms={packageTerms}
            />
          </div>
        ) : step === "card" ? (
          <div className="mt-8 grid gap-5">
            {isManualOneTime && product.kind === "package" && (
              <section
                className="rounded-2xl border border-[#ff9b8d]/25 bg-[#ff715e]/[.07] p-4"
                aria-label="패키지 이용기간과 할부 안내"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="block text-[11px] font-bold text-neutral-500">
                      이용기간
                    </span>
                    <strong className="mt-1 block text-base font-black text-white">
                      {product.durationMonths}개월
                    </strong>
                  </div>
                  <div className="border-l border-white/10 pl-3">
                    <span className="block text-[11px] font-bold text-neutral-500">
                      결제 할부
                    </span>
                    <strong className="mt-1 block text-base font-black text-[#ffad9f]">
                      최대 {MANUAL_INSTALLMENT_MAX_MONTHS}개월
                    </strong>
                  </div>
                </div>
                <p className="mt-3 text-xs font-medium leading-5 text-neutral-400">
                  일시불 또는 2~{MANUAL_INSTALLMENT_MAX_MONTHS}개월 중 선택할 수 있으며,
                  카드사 정책에 따라 제한될 수 있습니다.
                </p>
              </section>
            )}
            {isManualOneTime && (
              <div className="text-xs font-bold text-neutral-300">
                <span className="block">카드 종류</span>
                <div className="mt-2">
                  <ManualCardKindSelect
                    value={manualCardKind}
                    onChange={(cardKind) => {
                      clearManualCardValidationField("cardKind");
                      selectManualCardKind(cardKind);
                    }}
                    attention={manualCardKindAttention}
                    disabled={busy}
                  />
                </div>
              </div>
            )}
            {requiresInstallmentIssuer && (
              <div className="manual-checkout-field-enter relative z-[70] text-xs font-bold text-neutral-300">
                <span className="block">카드사</span>
                <CardIssuerSelect
                  attention={installmentIssuerAttention}
                  className="mt-2"
                  value={installmentIssuerCode}
                  options={installmentIssuerOptions}
                  onChange={(issuerCode) => {
                    clearManualCardValidationField("issuer");
                    selectInstallmentIssuer(issuerCode);
                  }}
                  disabled={busy || installmentLoading}
                />
              </div>
            )}
            {showManualCardNumber && (
            <fieldset
              className={`${isManualOneTime ? "manual-checkout-field-enter" : ""} ${
                manualCardValidationField === "cardNumber"
                  ? "rounded-2xl ring-4 ring-[#ff715e]/15"
                  : ""
              }`}
            >
              <legend className="text-xs font-bold text-neutral-300">카드번호</legend>
              <div className="mt-2 grid grid-cols-4 gap-2 sm:gap-3">
                {form.cardNumberParts.map((part, index) => (
                  <input
                    key={index}
                    ref={(element) => { cardPartRefs.current[index] = element; }}
                    data-manual-card-field={index === 0 ? "cardNumber" : undefined}
                    data-payment-autofocus={
                      index === 0 && !isManualOneTime && !requiresInstallmentIssuer
                        ? ""
                        : undefined
                    }
                    required
                    type={index === 3 ? "password" : "text"}
                    inputMode="numeric"
                    autoComplete={index === 0 ? "cc-number" : "off"}
                    aria-label={`카드번호 ${index + 1}번째 4자리`}
                    value={part}
                    onChange={(event) => {
                      clearManualCardValidationField("cardNumber");
                      updateCardNumberPart(index, event.target.value);
                    }}
                    onPaste={(event) => pasteCardNumber(index, event)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Backspace"
                        && !form.cardNumberParts[index]
                        && index > 0
                      ) {
                        event.preventDefault();
                        cardPartRefs.current[index - 1]?.focus();
                      }
                    }}
                    maxLength={index === 0 ? 16 : 4}
                    placeholder={index === 3 ? "••••" : "0000"}
                    className={`min-h-14 min-w-0 w-full rounded-2xl border bg-[#101315] px-2 text-center text-base font-bold tracking-[.08em] text-white outline-none transition placeholder:font-medium placeholder:tracking-normal placeholder:text-neutral-700 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10 sm:px-3 ${
                      manualCardValidationField === "cardNumber"
                        ? "border-[#ff8f7f]/80"
                        : "border-white/10"
                    }`}
                  />
                ))}
              </div>
            </fieldset>
            )}
            {showManualExpiry && (
            <div className={`${isManualOneTime ? "manual-checkout-field-enter" : ""} grid grid-cols-2 gap-3`}>
              <label className="text-xs font-bold text-neutral-300">
                유효기간 월
                <input
                  data-manual-card-field="expiryMonth"
                  required
                  inputMode="numeric"
                  autoComplete="cc-exp-month"
                  value={form.expiryMonth}
                  onChange={(event) => {
                    clearManualCardValidationField("expiryMonth");
                    update("expiryMonth", digits(event.target.value, 2));
                  }}
                  placeholder="MM"
                  className={`mt-2 min-h-14 w-full rounded-2xl border bg-[#101315] px-4 text-base text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10 ${
                    manualCardValidationField === "expiryMonth"
                      ? "border-[#ff8f7f]/80 ring-4 ring-[#ff715e]/15"
                      : "border-white/10"
                  }`}
                />
              </label>
              <label className="text-xs font-bold text-neutral-300">
                유효기간 연도
                <input
                  data-manual-card-field="expiryYear"
                  required
                  inputMode="numeric"
                  autoComplete="cc-exp-year"
                  value={form.expiryYear}
                  onChange={(event) => {
                    clearManualCardValidationField("expiryYear");
                    update("expiryYear", digits(event.target.value, 2));
                  }}
                  placeholder="YY"
                  className={`mt-2 min-h-14 w-full rounded-2xl border bg-[#101315] px-4 text-base text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10 ${
                    manualCardValidationField === "expiryYear"
                      ? "border-[#ff8f7f]/80 ring-4 ring-[#ff715e]/15"
                      : "border-white/10"
                  }`}
                />
              </label>
            </div>
            )}
            {showManualCardCredentials && (
            <div className={`${isManualOneTime ? "manual-checkout-field-enter" : ""} grid grid-cols-2 gap-3`}>
              <label className="min-w-0 text-xs font-bold text-neutral-300">
                카드 비밀번호 앞 2자리
                <input
                  data-manual-card-field="cardPassword"
                  required
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={form.cardPassword}
                  onChange={(event) => {
                    clearManualCardValidationField("cardPassword");
                    update("cardPassword", digits(event.target.value, 2));
                  }}
                  placeholder="••"
                  className={`mt-2 min-h-14 w-full rounded-2xl border bg-[#101315] px-4 text-base text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10 ${
                    manualCardValidationField === "cardPassword"
                      ? "border-[#ff8f7f]/80 ring-4 ring-[#ff715e]/15"
                      : "border-white/10"
                  }`}
                />
              </label>
              <label className="min-w-0 text-xs font-bold text-neutral-300">
                생년월일 또는 사업자번호
                <input
                  data-manual-card-field="identityNumber"
                  required
                  inputMode="numeric"
                  autoComplete="off"
                  value={form.identityNumber}
                  onChange={(event) => {
                    clearManualCardValidationField("identityNumber");
                    update("identityNumber", digits(event.target.value, 10));
                  }}
                  placeholder="6자리 또는 10자리"
                  className={`mt-2 min-h-14 w-full rounded-2xl border bg-[#101315] px-4 text-base text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10 ${
                    manualCardValidationField === "identityNumber"
                      ? "border-[#ff8f7f]/80 ring-4 ring-[#ff715e]/15"
                      : "border-white/10"
                  }`}
                />
              </label>
            </div>
            )}
            {showManualPayerTel && (
            <label className={`${isManualOneTime ? "manual-checkout-field-enter" : ""} text-xs font-bold text-neutral-300`}>
              휴대전화 번호
              <input
                data-manual-card-field="payerTel"
                required
                inputMode="numeric"
                autoComplete="tel"
                value={form.payerTel}
                onChange={(event) => {
                  clearManualCardValidationField("payerTel");
                  update("payerTel", digits(event.target.value, 11));
                }}
                placeholder="01012345678"
                className={`mt-2 min-h-14 w-full rounded-2xl border bg-[#101315] px-4 text-base text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10 ${
                  manualCardValidationField === "payerTel"
                    ? "border-[#ff8f7f]/80 ring-4 ring-[#ff715e]/15"
                    : "border-white/10"
                }`}
              />
            </label>
            )}
            {showManualConsent && (
            <div
              ref={consentRef}
              data-manual-card-field="consent"
              className={isManualOneTime ? "manual-checkout-field-enter" : ""}
            >
              <PurchaseTermsConsent
                checked={form.consent}
                onChange={(consent) => {
                  clearManualCardValidationField("consent");
                  update("consent", consent);
                }}
                packageTerms={packageTerms}
                className={manualCardValidationField === "consent"
                  ? "border-[#ff8f7f]/80 ring-4 ring-[#ff715e]/15"
                  : ""}
              />
            </div>
            )}
            {manualCardValidationField && (
              <p className="text-sm font-bold leading-5 text-[#ff9b8d]" role="alert">
                {manualCardValidationMessages[manualCardValidationField]}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-8 grid gap-5">
            <label className="text-xs font-bold text-neutral-300">
              이름
              <input
                data-payment-autofocus
                required
                autoComplete="name"
                value={form.payerName}
                onChange={(event) => update("payerName", event.target.value.slice(0, 20))}
                placeholder="홍길동"
                className="mt-2 min-h-14 w-full rounded-2xl border border-white/10 bg-[#101315] px-4 text-base text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10"
              />
            </label>
            <label className="text-xs font-bold text-neutral-300">
              이메일
              <input
                required
                type="email"
                autoComplete="email"
                value={form.payerEmail}
                onChange={(event) => update("payerEmail", event.target.value.slice(0, 100))}
                placeholder="name@example.com"
                className="mt-2 min-h-14 w-full rounded-2xl border border-white/10 bg-[#101315] px-4 text-base text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10"
              />
            </label>
            {isManualOneTime && chargeAmount !== null && (
              <>
                <section className="flex min-h-[54px] items-center rounded-2xl border border-white/10 bg-[#101315] px-4 py-2">
                  <div className="flex w-full items-center justify-between gap-4">
                    <span className="shrink-0 text-xs font-bold text-neutral-500">
                      구매 상품
                    </span>
                    <strong className="min-w-0 text-right text-base font-black leading-5 text-[#ffad9f]">
                      {product.displayName}
                    </strong>
                  </div>
                </section>

                <section className="rounded-2xl border border-white/10 bg-[#101315] p-4">
                  {manualCardKind === "debit_prepaid" ? (
                    <div className="rounded-xl border border-white/8 bg-black/15 p-3">
                      <strong className="text-sm text-white">일시불</strong>
                      <p className="mt-1 text-xs leading-5 text-neutral-400">
                        체크·선불카드는 일시불로 결제됩니다.
                      </p>
                    </div>
                  ) : chargeAmount >= 50_000 ? (
                    <div className="text-xs font-bold text-neutral-300">
                        <span className="block">결제 방식</span>
                        {providerMaxInstallmentMonths !== null && (
                          <p
                            className="mt-2 rounded-xl border border-[#ff9b8d]/25 bg-[#ff715e]/8 px-3 py-2 text-sm font-bold leading-5 text-[#ffb0a6]"
                            role="status"
                          >
                            해당 카드는 최대 {providerMaxInstallmentMonths}개월 할부까지 지원합니다.
                          </p>
                        )}
                        <InstallmentSelect
                          className="mt-2"
                          value={installmentMonths}
                          months={selectedIssuerInstallmentMonths}
                          optionDetails={selectedIssuerInstallmentDetails}
                          highlightedOptions={selectedIssuerInterestFreeMonths}
                          disabled={
                            requiresInstallmentIssuer && !installmentIssuerCode
                          }
                          disabledLabel="카드사를 먼저 선택해 주세요"
                          onChange={(months) => {
                            preferredInstallmentPendingRef.current = false;
                            setInstallmentMonths(months);
                          }}
                        />
                    </div>
                  ) : (
                    <div className="rounded-xl border border-white/8 bg-black/15 p-3">
                      <strong className="text-sm text-white">일시불</strong>
                      <p className="mt-1 text-[11px] text-neutral-500">
                        할부 혜택은 5만원 이상 결제부터 적용됩니다.
                      </p>
                    </div>
                  )}
                </section>

                {manualCardKind === "credit" && (
                  <InstallmentBenefitsAccordion
                    offer={cardLimitedInstallmentOffer}
                    amountKrw={chargeAmount}
                    formatAmount={(amountKrw) => `${priceFormatter.format(amountKrw)}원`}
                    onSelect={(issuerCode, months) => {
                      preferredInstallmentPendingRef.current = false;
                      setInstallmentIssuerCode(issuerCode);
                      setInstallmentMonths(months);
                    }}
                  />
                )}
              </>
            )}
          </div>
        )}
      </ThePayOnePaymentOverlay>

      <PaymentMessageOverlay
        open={Boolean(error)}
        tone="error"
        title={errorTitle}
        message={error || ""}
        onClose={() => setError(null)}
      />
    </>
  );
}
