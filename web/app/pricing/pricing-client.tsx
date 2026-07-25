"use client";

import { useEffect, useState } from "react";
import { PurchaseTermsConsent } from "@/components/purchase-terms-consent";
import { PaymentMessageOverlay } from "@/components/payment-message-overlay";
import { SelectedPaymentCard } from "@/components/selected-payment-card";
import { ThePayOnePaymentOverlay } from "@/components/thepayone-payment-overlay";
import { useUsageState } from "@/components/usage-provider";
import { billingPostJson, purchaseAddonWithSavedCard } from "@/lib/billing-client";
import type { MvpState } from "@/lib/contracts";
import { billingSupportsEbookDownloads } from "@/lib/ebook-entitlements";
import {
  getPricingV2Package,
  getPricingV2Plan,
  pricingV2EarlyBirdProducts,
  pricingV2PackageMonths,
  type PricingV2EarlyBirdCode,
  type PricingV2PackageMonths,
  type PricingV2PlanCode,
} from "@/lib/pricing-v2";
import { EbookPreviewRail } from "./ebook-preview-rail";
import { PlanCheckoutOverlay } from "./plan-checkout-overlay";
import {
  ReplacementCardPaymentOverlay,
  type ReplacementCardAuth,
} from "./replacement-card-payment-overlay";
import styles from "./pricing.module.css";

const priceFormatter = new Intl.NumberFormat("ko-KR");
const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeZone: "Asia/Seoul",
});
const packageMonthOptions = pricingV2PackageMonths;
export type PricingState = Pick<MvpState, "user" | "billing">;

type PackageMonths = PricingV2PackageMonths;
type PackagePlanCode = "starter" | "expert";
type PlanCheckoutState = {
  mode: "subscribe" | "change_subscription";
  product: NonNullable<ReturnType<typeof getPricingV2Plan>>;
};

type PlanCard = {
  code: string;
  checkoutPlanCode: PricingV2PlanCode;
  name: string;
  eyebrow: string;
  price: string;
  priceSuffix: string;
  billing: string;
  description: string;
  badge: string | null;
  cardClass: string;
  buttonClass: string;
  cta: string;
  features: Array<{
    text: string;
    strong?: string;
    unavailable?: boolean;
  }>;
};

const plans: PlanCard[] = [
  {
    code: "easycut-pro",
    checkoutPlanCode: "easycut_pro_v2",
    name: "이지컷 프로",
    eyebrow: "",
    price: "₩9,900",
    priceSuffix: "/월",
    billing: "매월 자동결제 · 월 60분",
    description: "모든 핵심 기능을 가볍게 시작하세요.",
    badge: null,
    cardClass: "",
    buttonClass: "",
    cta: "이지컷 프로 선택",
    features: [
      { text: "월 60분 · 원본 영상 처리", strong: "월 60분" },
      { text: "쇼츠 약 48개 · 10분 영상 기준", strong: "쇼츠 약 48개" },
      { text: "프로젝트 30일 보관" },
      { text: "실시간 인기 필터 제공" },
      { text: "숏폼 전략 가이드 PDF 미제공", unavailable: true },
    ],
  },
  {
    code: "starter",
    checkoutPlanCode: "starter_6m",
    name: "스타터 패키지",
    eyebrow: "",
    price: "₩19,900",
    priceSuffix: "/월",
    billing: "6개월 ₩119,400 결제",
    description: "꾸준히 제작하는 크리에이터를 위한 구성입니다.",
    badge: "가장 합리적",
    cardClass: "pricing-card-popular",
    buttonClass: "pricing-cta-primary",
    cta: "스타터 패키지 선택",
    features: [
      { text: "매월 200분 × 6개월", strong: "매월 200분" },
      { text: "쇼츠 약 960개", strong: "쇼츠 약 960개" },
      { text: "프로젝트 30일 보관" },
      { text: "실시간 인기 필터 제공" },
      { text: "숏폼 전략 가이드 PDF 다운로드" },
    ],
  },
  {
    code: "expert",
    checkoutPlanCode: "expert_12m",
    name: "전문가 패키지",
    eyebrow: "",
    price: "₩48,000",
    priceSuffix: "/월",
    billing: "12개월 ₩576,000 결제",
    description: "대량 제작자와 운영팀을 위한 최대 용량입니다.",
    badge: null,
    cardClass: "pricing-card-pro",
    buttonClass: "",
    cta: "전문가 패키지 선택",
    features: [
      { text: "매월 600분 × 12개월", strong: "매월 600분" },
      { text: "쇼츠 약 480개 · 10분 영상 기준", strong: "쇼츠 약 480개" },
      { text: "프로젝트 30일 보관" },
      { text: "실시간 인기 필터 제공" },
      { text: "숏폼 전략 가이드 PDF 다운로드" },
    ],
  },
];

type EarlyBirdProduct = {
  code: PricingV2EarlyBirdCode;
  minutes: number;
  discount: number;
  originalPrice: number;
  salePrice: number;
  accent: "coral" | "violet";
  popular?: boolean;
};

type CardAuthState = {
  identityNumber: string;
  cardPassword: string;
  payerTel: string;
  consent: boolean;
};

type ResubscribeAuthState = {
  requestId: string;
  identityNumber: string;
  cardPassword: string;
  consent: boolean;
};

type EarlyBirdSuccessState = {
  minutes: number;
  chargedAmountKrw: number;
  remainingMinutes: number | null;
};

const emptyCardAuth: CardAuthState = {
  identityNumber: "",
  cardPassword: "",
  payerTel: "",
  consent: false,
};

function digits(value: string, maxLength: number) {
  return value.replace(/[^0-9]/g, "").slice(0, maxLength);
}

const earlyBirdProducts: EarlyBirdProduct[] = pricingV2EarlyBirdProducts.map((product) => ({
  code: product.code,
  minutes: product.minutes,
  discount: product.discountPercent,
  originalPrice: product.originalPriceKrw,
  salePrice: product.priceKrw,
  accent: product.code === "earlybird_1000" ? "violet" : "coral",
  popular: product.code === "earlybird_600",
}));

function packagePlanMinutes(code: PackagePlanCode) {
  return code === "starter" ? 200 : 600;
}

function isPackagePlanCode(code: string): code is PackagePlanCode {
  return code === "starter" || code === "expert";
}

function featureContent(text: string, strong?: string) {
  if (!strong) return text;
  const [before, after = ""] = text.split(strong);
  return <>{before}<b>{strong}</b>{after}</>;
}

function AnimatedMinuteCredit({ minutes }: { minutes: number }) {
  const [displayedMinutes, setDisplayedMinutes] = useState(1);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplayedMinutes(minutes);
      return;
    }
    let animationFrame = 0;
    let startedAt: number | null = null;
    const duration = Math.min(1_300, Math.max(750, minutes * 2));
    const animate = (timestamp: number) => {
      startedAt ??= timestamp;
      const progress = Math.min(1, (timestamp - startedAt) / duration);
      const easedProgress = 1 - ((1 - progress) ** 3);
      setDisplayedMinutes(Math.max(1, Math.min(minutes, Math.ceil(minutes * easedProgress))));
      if (progress < 1) animationFrame = window.requestAnimationFrame(animate);
    };
    animationFrame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [minutes]);

  return (
    <div className="relative mt-5">
      <span className="sr-only">{priceFormatter.format(minutes)}분 추가</span>
      <strong
        aria-hidden="true"
        className="inline-flex min-h-14 items-center rounded-2xl border border-[#ff8c7c]/25 bg-[#ff715e]/10 px-5 text-3xl font-black tabular-nums tracking-[-.04em] text-[#ffad9f]"
      >
        +{priceFormatter.format(displayedMinutes)}분
      </strong>
    </div>
  );
}

export function PricingClient({
  initialState,
  onRequireLogin,
}: {
  initialState: PricingState | null;
  onRequireLogin: () => void;
}) {
  const { refreshUsage } = useUsageState();
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [state, setState] = useState<PricingState | null>(initialState);
  const [stateLoaded, setStateLoaded] = useState(initialState !== null);
  const [earlyBirdConfirmation, setEarlyBirdConfirmation] = useState<EarlyBirdProduct | null>(null);
  const [earlyBirdSuccess, setEarlyBirdSuccess] = useState<EarlyBirdSuccessState | null>(null);
  const [planCheckout, setPlanCheckout] = useState<PlanCheckoutState | null>(null);
  const [cancelConfirmation, setCancelConfirmation] = useState(false);
  const [resubscribeAuth, setResubscribeAuth] = useState<ResubscribeAuthState | null>(null);
  const [cardAuth, setCardAuth] = useState<CardAuthState>(emptyCardAuth);
  const [earlyBirdUseDifferentCard, setEarlyBirdUseDifferentCard] = useState(false);
  const [resubscribeUseDifferentCard, setResubscribeUseDifferentCard] = useState(false);
  const [packageMonths, setPackageMonths] = useState<PackageMonths>(6);

  useEffect(() => {
    if (initialState) return;
    const controller = new AbortController();
    fetch("/api/mvp/state", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("STATE_LOAD_FAILED");
        setState(await response.json() as PricingState);
      })
      .catch(() => {
        if (!controller.signal.aborted) setState(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setStateLoaded(true);
      });
    return () => controller.abort();
  }, [initialState]);

  useEffect(() => {
    if (!cancelConfirmation) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("purchase-sheet-open");
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.classList.remove("purchase-sheet-open");
    };
  }, [cancelConfirmation]);

  async function reloadState() {
    const response = await fetch("/api/mvp/state", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("결제 상태를 다시 불러오지 못했습니다.");
    setState(await response.json() as MvpState);
  }

  const displayedPlans = plans.map((plan) => {
    if (!isPackagePlanCode(plan.code)) return plan;
    const packagePrice = getPricingV2Package(plan.code, packageMonths);
    if (!packagePrice) return plan;
    const monthlyMinutes = packagePlanMinutes(plan.code);
    const monthlyShorts = plan.code === "starter" ? 160 : 480;
    const totalShorts = monthlyShorts * packageMonths;
    return {
      ...plan,
      eyebrow: `${packagePrice.discountPercent}% 할인`,
      checkoutPlanCode: packagePrice.code,
      price: `₩${priceFormatter.format(packagePrice.monthlyPriceKrw)}`,
      billing: `${packageMonths}개월 총 ₩${priceFormatter.format(packagePrice.totalPriceKrw)}`,
      cta: `${plan.name} ${packageMonths}개월 선택`,
      features: [
        {
          text: `매월 ${priceFormatter.format(monthlyMinutes)}분 × ${packageMonths}개월`,
          strong: `매월 ${priceFormatter.format(monthlyMinutes)}분`,
        },
        {
          text: `쇼츠 약 ${priceFormatter.format(totalShorts)}개`,
          strong: `쇼츠 약 ${priceFormatter.format(totalShorts)}개`,
        },
        ...plan.features.slice(2),
      ],
    };
  });
  const activePricingProduct = state?.billing.status === "active"
    ? getPricingV2Plan(state.billing.planCode)
    : null;
  const activeProducts = state?.billing.activeProducts ?? [];
  const purchasedPackageCodes = new Set(state?.billing.purchasedPackageCodes ?? []);
  const hasReusableStoredCard = Boolean(
    state?.billing.paymentProvider === "thepayone"
    && (state.billing.cardNumberMasked || state.billing.cardLast4)
  );
  const selectedPaymentCard = hasReusableStoredCard ? {
    issuer: state?.billing.cardIssuer || null,
    last4: state?.billing.cardLast4 || state?.billing.cardNumberMasked || null,
  } : null;
  const hasActivePackage = activeProducts.some(
    (product) => getPricingV2Plan(product.planCode)?.kind === "package",
  ) || activePricingProduct?.kind === "package";
  const comparisonRows = [
    { label: "월 제공시간", values: ["60분", "200분", "600분"] },
    {
      label: "예상 쇼츠 제작량",
      values: [
        "약 48개/월",
        `약 ${priceFormatter.format(160 * packageMonths)}개/${packageMonths}개월`,
        `약 ${priceFormatter.format(480 * packageMonths)}개/${packageMonths}개월`,
      ],
    },
    { label: "프로젝트 보관", values: ["30일", "30일", "30일"] },
    { label: "실시간 인기 필터", values: ["제공", "제공", "제공"] },
    { label: "전략 가이드 PDF", values: ["미제공", "제공", "제공"] },
    {
      label: "결제 방식",
      values: ["매월 자동결제", `${packageMonths}개월 패키지`, `${packageMonths}개월 패키지`],
    },
  ];

  function requireLogin() {
    if (!stateLoaded) {
      setError("로그인 상태를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.");
      return true;
    }
    if (state?.user) return false;
    onRequireLogin();
    return true;
  }

  async function choosePlan(planCode: PricingV2PlanCode) {
    if (requireLogin()) return;
    const product = getPricingV2Plan(planCode);
    if (!product) {
      setError("선택한 상품을 확인할 수 없습니다.");
      return;
    }
    if (product.kind === "package" && purchasedPackageCodes.has(product.code)) {
      setError("이 패키지 상품은 이미 구매했습니다. 다른 기간이나 등급을 선택해 주세요.");
      return;
    }
    const billing = state!.billing;
    const hasCurrentPlan = billing.status === "active" || billing.status === "past_due";
    if (
      billing.status === "active"
      && billing.planCode === planCode
      && product.kind === "subscription"
    ) {
      setError("현재 이용 중인 상품입니다.");
      return;
    }
    if (billing.status === "active") {
      const currentPricingV2Plan = getPricingV2Plan(billing.planCode);
      if (currentPricingV2Plan?.kind === "package") {
        if (product.kind !== "package") {
          setError("패키지 이용 중에는 월간 구독을 추가할 수 없습니다.");
          return;
        }
        setError(null);
        setPlanCheckout({ mode: "subscribe", product });
        return;
      }
      if (billing.billingCycle !== "monthly") {
        setError("현재 이용권이 종료된 후 다른 패키지를 구매할 수 있습니다.");
        return;
      }
      setBusy(planCode);
      setError(null);
      try {
        const result = await billingPostJson<{
          action: "scheduled" | "canceled" | "checkout";
          effectiveAt?: string;
          checkoutUrl?: string;
        }>("/api/billing/subscription/change", {
          planCode: product.code,
          billingCycle: product.billingCycle,
        });
        if (result.action === "checkout" && result.checkoutUrl) {
          setPlanCheckout({ mode: "change_subscription", product });
          return;
        }
        const effectiveDate = result.effectiveAt
          ? new Intl.DateTimeFormat("ko-KR", {
            dateStyle: "long",
            timeZone: "Asia/Seoul",
          }).format(new Date(result.effectiveAt))
          : "현재 이용기간 종료일";
        setPreviewMessage(
          `${product.displayName} 변경을 예약했습니다. ${effectiveDate} 이후 요금제 페이지에서 패키지 결제를 완료해 주세요.`,
        );
        setState((current) => current ? {
          ...current,
          billing: {
            ...current.billing,
            scheduledPlanCode: product.code,
            scheduledBillingCycle: product.billingCycle,
          },
        } : current);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "상품 변경을 예약하지 못했습니다.");
      } finally {
        setBusy(null);
      }
      return;
    }
    setError(null);
    setPlanCheckout({
      mode: hasCurrentPlan ? "change_subscription" : "subscribe",
      product,
    });
  }

  function buyEarlyBird(product: EarlyBirdProduct) {
    if (requireLogin()) return;
    if (state?.billing.status !== "active") {
      setError("얼리버드 추가시간은 활성 이용권이 있는 사용자만 구매할 수 있습니다.");
      return;
    }
    if (
      state.billing.paymentProvider !== "thepayone"
      || (!state.billing.cardNumberMasked && !state.billing.cardLast4)
    ) {
      setError("사용 가능한 더페이원 저장 카드가 없습니다. 먼저 결제수단을 등록해 주세요.");
      return;
    }
    setError(null);
    setCardAuth(emptyCardAuth);
    setEarlyBirdUseDifferentCard(false);
    setEarlyBirdConfirmation(product);
  }

  async function purchaseEarlyBird(
    product: EarlyBirdProduct,
    auth: ReplacementCardAuth,
    payerTel?: string,
  ) {
    const result = await purchaseAddonWithSavedCard({
      addonCode: product.code,
      expectedChargeAmountKrw: product.salePrice,
      identityNumber: auth.identityNumber,
      cardPassword: auth.cardPassword,
      ...(payerTel ? { payerTel } : {}),
    });
    const addedMinutes = result.addedMinutes || product.minutes;
    setEarlyBirdConfirmation(null);
    setEarlyBirdUseDifferentCard(false);
    setCardAuth(emptyCardAuth);
    setEarlyBirdSuccess({
      minutes: addedMinutes,
      chargedAmountKrw: result.chargedAmountKrw,
      remainingMinutes: null,
    });
    const refreshedUsage = await refreshUsage().catch(() => null);
    void reloadState().catch(() => undefined);
    if (refreshedUsage) {
      setEarlyBirdSuccess((current) => current ? {
        ...current,
        remainingMinutes: Math.max(0, Math.floor(refreshedUsage.remainingSeconds / 60)),
      } : current);
    }
  }

  async function confirmEarlyBirdPurchase() {
    if (!earlyBirdConfirmation || !state || busy) return;
    const identityNumber = cardAuth.identityNumber.replace(/[^0-9]/g, "");
    const cardPassword = cardAuth.cardPassword.replace(/[^0-9]/g, "");
    const payerTel = cardAuth.payerTel.replace(/[^0-9]/g, "");
    if (![6, 10].includes(identityNumber.length)) {
      setError("생년월일 6자리 또는 사업자번호 10자리를 입력해 주세요.");
      return;
    }
    if (cardPassword.length !== 2) {
      setError("카드 비밀번호 앞 2자리를 입력해 주세요.");
      return;
    }
    if (!state.billing.hasStoredPayerTel && !/^\d{10,11}$/.test(payerTel)) {
      setError("휴대전화 번호 10~11자리를 입력해 주세요.");
      return;
    }
    if (!cardAuth.consent) {
      setError("구매약관 및 취소·환불 규정에 동의해 주세요.");
      return;
    }
    setBusy(earlyBirdConfirmation.code);
    setError(null);
    try {
      await purchaseEarlyBird(
        earlyBirdConfirmation,
        { identityNumber, cardPassword },
        state.billing.hasStoredPayerTel ? undefined : payerTel,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "얼리버드 결제를 완료하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  async function cancelMonthlySubscription() {
    if (!state || busy) return;
    setBusy("cancel_subscription");
    setError(null);
    try {
      await billingPostJson("/api/billing/subscription/cancel", {
        cancelAtPeriodEnd: true,
      });
      await reloadState();
      setCancelConfirmation(false);
      setPreviewMessage("월간 구독 해지가 예약되었습니다. 현재 유료기간은 유지되고 다음 자동결제와 월 처리시간 지급은 중단됩니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "월간 구독을 해지하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  async function resubscribeMonthly() {
    if (!state || !resubscribeAuth || busy) return;
    const identityNumber = digits(resubscribeAuth.identityNumber, 10);
    const cardPassword = digits(resubscribeAuth.cardPassword, 2);
    if (![6, 10].includes(identityNumber.length)) {
      setError("생년월일 6자리 또는 사업자번호 10자리를 입력해 주세요.");
      return;
    }
    if (cardPassword.length !== 2) {
      setError("카드 비밀번호 앞 2자리를 입력해 주세요.");
      return;
    }
    if (!resubscribeAuth.consent) {
      setError("구매약관 및 취소·환불 규정에 동의해 주세요.");
      return;
    }
    setBusy("resubscribe");
    setError(null);
    try {
      await completeResubscribe({
        identityNumber,
        cardPassword,
      }, resubscribeAuth.requestId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "월간 구독을 다시 시작하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  async function completeResubscribe(
    auth: ReplacementCardAuth,
    requestId = crypto.randomUUID(),
  ) {
    const result = await billingPostJson<{
      addedMinutes?: number;
      accessUntil?: string;
    }>("/api/billing/subscription/resubscribe", {
      requestId,
      expectedChargeAmountKrw: 9_900,
      identityNumber: auth.identityNumber,
      cardPassword: auth.cardPassword,
      consent: true,
    });
    await reloadState();
    setResubscribeAuth(null);
    setResubscribeUseDifferentCard(false);
    const accessUntil = result.accessUntil
      ? dateFormatter.format(new Date(result.accessUntil))
      : "연장된 이용기간";
    setPreviewMessage(
      `월간 구독을 다시 시작했습니다. ${priceFormatter.format(result.addedMinutes || 60)}분이 지급되고 Pro 이용기간이 ${accessUntil}까지 연장되었습니다.`,
    );
  }

  function renderPlanCard(plan: PlanCard) {
    const alreadyPurchased = isPackagePlanCode(plan.code)
      && purchasedPackageCodes.has(plan.checkoutPlanCode);
    return (
      <article
        key={plan.code}
        className={`pricing-card ${plan.cardClass} ${styles.planCard} ${
          plan.code === "easycut-pro" ? styles.monthlyPlanCard : ""
        } ${
          isPackagePlanCode(plan.code) ? styles.packagePlanCard : ""
        }`}
      >
        {plan.badge && (plan.code !== "starter" || packageMonths === 6) && (
          <span className={`pricing-badge ${plan.code === "expert" ? "pricing-badge-violet" : ""}`}>
            {plan.badge}
          </span>
        )}
        {plan.eyebrow && (
          <span
            className={`${styles.planEyebrow} ${
              isPackagePlanCode(plan.code) ? styles.discountEyebrow : ""
            } ${plan.code === "expert" ? styles.discountEyebrowViolet : ""}`}
          >
            {plan.eyebrow}
          </span>
        )}
        <div className="pricing-plan-name"><h2>{plan.name}</h2></div>
        <p className={styles.planDescription}>{plan.description}</p>
        <div className="pricing-price">
          <strong>{plan.price}</strong><span>{plan.priceSuffix}</span>
        </div>
        <p className="pricing-billing">{plan.billing}</p>
        <ul>
          {plan.features.map((feature) => (
            <li
              key={feature.text}
              className={feature.unavailable ? "pricing-feature-unavailable" : ""}
            >
              <span aria-hidden="true">{feature.unavailable ? "×" : "✓"}</span>
              <div>{featureContent(feature.text, feature.strong)}</div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          disabled={busy !== null || alreadyPurchased}
          className={`pricing-cta ${plan.buttonClass} ${styles.planCta} ${
            alreadyPurchased ? styles.planCtaPurchased : ""
          }`}
          onClick={() => void choosePlan(plan.checkoutPlanCode)}
        >
          {alreadyPurchased
            ? "이미 구매함"
            : busy === plan.checkoutPlanCode ? "준비 중..." : plan.cta}
        </button>
      </article>
    );
  }

  if (!stateLoaded) {
    return (
      <>
        <section className={`hero pricing-hero ${styles.hero}`}>
          <h1>
            <span>얼리버드 할인으로</span><br />
            <span className="pricing-hero-accent">패키지 상품을 만나보세요</span>
          </h1>
        </section>
        <section
          className={styles.pricingStateSkeleton}
          aria-label="요금제 정보를 불러오는 중"
          aria-busy="true"
        >
          <div className={styles.skeletonStatusCard}>
            <span />
            <strong />
            <i />
          </div>
          <div className={styles.skeletonToolbar} />
          <div className={styles.skeletonPackageGrid}>
            <article><span /><strong /><i /><i /><i /><button type="button" disabled /></article>
            <article><span /><strong /><i /><i /><i /><button type="button" disabled /></article>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <section className={`hero pricing-hero ${styles.hero}`}>
        <h1>
          <span>얼리버드 할인으로</span><br />
          <span className="pricing-hero-accent">패키지 상품을 만나보세요</span>
        </h1>
      </section>

      {activeProducts.length > 0 && (
        <section className={styles.activeProductsSection} aria-label="활성 이용 상품">
          <div className={styles.activeProductsGrid}>
            {activeProducts.map((product, index) => {
              const pricingProduct = getPricingV2Plan(product.planCode);
              const isPackage = pricingProduct?.kind === "package";
              const periodEnd = dateFormatter.format(new Date(product.currentPeriodEnd));
              const nextCharge = product.nextChargeAt
                ? dateFormatter.format(new Date(product.nextChargeAt))
                : null;
              const scheduleLabel = isPackage
                ? `${periodEnd}까지 이용`
                : product.cancelAtPeriodEnd
                  ? `${periodEnd} 해지 예정`
                  : nextCharge
                    ? `${nextCharge} 다음 결제`
                    : `${periodEnd}까지 이용`;
              return (
                <article
                  key={`${product.planCode}-${product.currentPeriodStart}-${index}`}
                  className={`${styles.activeProductCard} ${
                    isPackage ? styles.activePackageCard : ""
                  }`}
                >
                  <div className={styles.activeProductTopline}>
                    <span className={styles.activeProductBadge}>
                      <i aria-hidden="true" />
                      이용 중
                    </span>
                    <span>{isPackage ? "기간 패키지" : "월간 구독"}</span>
                  </div>
                  <h3>{product.displayName}</h3>
                  <div className={styles.activeProductBenefit}>
                    <strong>
                      매월 {priceFormatter.format(Math.floor(product.monthlySourceSeconds / 60))}분
                    </strong>
                    <span>원본 영상 처리</span>
                  </div>
                  <p>{scheduleLabel}</p>
                  {!isPackage && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      className={styles.subscriptionAction}
                      onClick={() => {
                        if (product.cancelAtPeriodEnd) {
                          setResubscribeUseDifferentCard(false);
                          setResubscribeAuth({
                            requestId: crypto.randomUUID(),
                            identityNumber: "",
                            cardPassword: "",
                            consent: false,
                          });
                        } else {
                          setCancelConfirmation(true);
                        }
                      }}
                    >
                      {product.cancelAtPeriodEnd ? "다시 구독하기" : "구독 해지"}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section id="pricing-plans" className={styles.planSection} aria-label="요금제 선택">
        <div className={`${styles.planToolbar} ${hasActivePackage ? styles.packageOnlyToolbar : ""}`}>
          <span>패키지 이용기간</span>
          <div className={styles.packageTermPicker} role="group" aria-label="패키지 이용기간">
            {packageMonthOptions.map((months) => (
              <button
                key={months}
                type="button"
                aria-pressed={packageMonths === months}
                className={packageMonths === months ? styles.packageTermActive : ""}
                onClick={() => setPackageMonths(months)}
              >
                {months}개월
              </button>
            ))}
          </div>
        </div>
        <div className={`${styles.planGrid} ${hasActivePackage ? styles.packageOnlyGrid : ""}`}>
          {!hasActivePackage && renderPlanCard(displayedPlans[0])}
          <div className={styles.packageGroup}>
            {displayedPlans.slice(1).map(renderPlanCard)}
          </div>
        </div>
      </section>

      <EbookPreviewRail
        canDownload={Boolean(state && billingSupportsEbookDownloads(state.billing))}
        onChoosePackage={() => {
          document.getElementById("pricing-plans")?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }}
      />

      <section className={styles.earlyBirdSection} aria-labelledby="early-bird-heading">
        <div className="pricing-section-heading">
          <h2 id="early-bird-heading">얼리버드 특가 할인</h2>
          <p>계정당 한 번씩만 구매할 수 있는 특별 상품입니다.</p>
        </div>
        <div className={styles.earlyBirdGrid}>
          {earlyBirdProducts.map((product) => (
            <article
              key={product.minutes}
              className={`${styles.earlyBirdCard} ${
                product.popular ? styles.earlyBirdPopular : ""
              } ${product.accent === "violet" ? styles.earlyBirdViolet : ""}`}
            >
              <span className={styles.discountBadge}>{product.discount}% 할인</span>
              <p>얼리버드</p>
              <h3>{priceFormatter.format(product.minutes)}분</h3>
              <span className={styles.originalPrice}>₩{priceFormatter.format(product.originalPrice)}</span>
              <strong>₩{priceFormatter.format(product.salePrice)}</strong>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => buyEarlyBird(product)}
              >
                {busy === product.code ? "결제 중..." : "구매"}
              </button>
            </article>
          ))}
        </div>
        <p className={styles.earlyBirdNote}>
          활성 이용권 보유자만 구매 가능 · 상품별 계정당 1회 · 구매일로부터 90일 유효 · 다른 할인과 중복 불가
        </p>
      </section>

      <section className="pricing-comparison" aria-labelledby="pricing-two-comparison">
        <div className="pricing-section-heading">
          <h2 id="pricing-two-comparison">상품 한눈에 보기</h2>
        </div>
        <div className="pricing-comparison-table-wrap">
          <table className="pricing-comparison-table">
            <thead>
              <tr>
                <th>구분</th>
                <th>이지컷 프로</th>
                <th className="pricing-comparison-popular">스타터</th>
                <th>전문가</th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr key={row.label}>
                  <th>{row.label}</th>
                  {row.values.map((value, index) => (
                    <td
                key={`${row.label}-${index}`}
                      className={row.label === "전략 가이드 PDF" && index === 0 ? styles.unavailableCell : ""}
                    >
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {planCheckout && (
        <PlanCheckoutOverlay
          mode={planCheckout.mode}
          product={planCheckout.product}
          initialName={state?.user?.displayName}
          initialEmail={state?.user?.email}
          savedPaymentMethod={hasReusableStoredCard ? {
            hasStoredPayerTel: Boolean(state?.billing.hasStoredPayerTel),
            issuer: selectedPaymentCard?.issuer || null,
            last4: selectedPaymentCard?.last4 || null,
          } : null}
          onClose={() => setPlanCheckout(null)}
        />
      )}

      {earlyBirdConfirmation && (earlyBirdUseDifferentCard ? (
        <ReplacementCardPaymentOverlay
          initialName={state?.user?.displayName}
          initialEmail={state?.user?.email}
          onClose={() => {
            setEarlyBirdConfirmation(null);
            setEarlyBirdUseDifferentCard(false);
            setCardAuth(emptyCardAuth);
          }}
          onUseSavedCard={() => setEarlyBirdUseDifferentCard(false)}
          onPaymentMethodReplaced={(auth) => purchaseEarlyBird(
            earlyBirdConfirmation,
            auth,
          )}
        />
      ) : (
        <ThePayOnePaymentOverlay
          title="카드 정보"
          busy={Boolean(busy)}
          primaryDisabled={
            ![6, 10].includes(digits(cardAuth.identityNumber, 10).length)
            || digits(cardAuth.cardPassword, 2).length !== 2
            || (!state?.billing.hasStoredPayerTel
              && !/^\d{10,11}$/.test(digits(cardAuth.payerTel, 11)))
            || !cardAuth.consent
          }
          primaryLabel={busy ? "결제를 진행하고 있습니다..." : "확인"}
          secondaryLabel="취소"
          onClose={() => {
            setEarlyBirdConfirmation(null);
            setEarlyBirdUseDifferentCard(false);
            setCardAuth(emptyCardAuth);
          }}
          onSubmit={() => void confirmEarlyBirdPurchase()}
        >
          <div className="mt-8 grid gap-5">
            {selectedPaymentCard && (
              <SelectedPaymentCard
                card={selectedPaymentCard}
                disabled={Boolean(busy)}
                onUseDifferentCard={() => setEarlyBirdUseDifferentCard(true)}
              />
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="min-w-0 text-xs font-bold text-neutral-300">
                생년월일 또는 사업자번호
                <input
                  data-payment-autofocus
                  required
                  inputMode="numeric"
                  autoComplete="off"
                  value={cardAuth.identityNumber}
                  onChange={(event) => setCardAuth((current) => ({
                    ...current,
                    identityNumber: digits(event.target.value, 10),
                  }))}
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
                  value={cardAuth.cardPassword}
                  onChange={(event) => setCardAuth((current) => ({
                    ...current,
                    cardPassword: digits(event.target.value, 2),
                  }))}
                  placeholder="••"
                  className="mt-2 min-h-14 w-full rounded-2xl border border-white/10 bg-[#101315] px-4 text-base text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10"
                />
              </label>
            </div>
            {!state?.billing.hasStoredPayerTel && (
              <label className="text-xs font-bold text-neutral-300">
                휴대전화 번호
                <input
                  required
                  inputMode="numeric"
                  autoComplete="tel"
                  value={cardAuth.payerTel}
                  onChange={(event) => setCardAuth((current) => ({
                    ...current,
                    payerTel: digits(event.target.value, 11),
                  }))}
                  placeholder="01012345678"
                  className="mt-2 min-h-14 w-full rounded-2xl border border-white/10 bg-[#101315] px-4 text-base text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10"
                />
              </label>
            )}
            <PurchaseTermsConsent
              checked={cardAuth.consent}
              onChange={(consent) => setCardAuth((current) => ({ ...current, consent }))}
            />
          </div>
        </ThePayOnePaymentOverlay>
      ))}

      {cancelConfirmation && (
        <div
          className="fixed inset-0 z-[130] flex items-end bg-black/80 pt-8 backdrop-blur-md sm:grid sm:place-items-center sm:px-5 sm:py-8"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-subscription-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setCancelConfirmation(false);
          }}
        >
          <div className="flex w-full max-w-md flex-col overflow-hidden rounded-t-[28px] border border-white/10 bg-[#191c1e] shadow-2xl sm:rounded-3xl">
            <div className="px-5 pb-7 pt-4 sm:px-7 sm:pt-7">
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20 sm:hidden" aria-hidden="true" />
              <h2 id="cancel-subscription-title" className="text-2xl font-black text-white">월간 구독을 해지할까요?</h2>
              <p className="mt-4 text-sm leading-7 text-neutral-400">
                이미 결제한 Pro 이용기간과 남은 처리시간은 종료일까지 유지됩니다.
                최종 해지하면 더페이원 자동결제 일정이 즉시 중지되고 다음 월 처리시간은 지급되지 않습니다.
              </p>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-3 border-t border-white/10 bg-[#191c1e] px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-7">
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => setCancelConfirmation(false)}
                className="min-h-12 rounded-xl border border-white/10 px-5 text-sm font-bold text-neutral-300 disabled:opacity-40"
              >
                취소
              </button>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void cancelMonthlySubscription()}
                className="min-h-12 rounded-xl bg-[#ff715e] px-5 text-sm font-black text-white disabled:opacity-40"
              >
                {busy === "cancel_subscription" ? "해지 처리 중..." : "최종 해지"}
              </button>
            </div>
          </div>
        </div>
      )}

      {resubscribeAuth && (resubscribeUseDifferentCard ? (
        <ReplacementCardPaymentOverlay
          initialName={state?.user?.displayName}
          initialEmail={state?.user?.email}
          onClose={() => {
            setResubscribeAuth(null);
            setResubscribeUseDifferentCard(false);
          }}
          onUseSavedCard={() => setResubscribeUseDifferentCard(false)}
          onPaymentMethodReplaced={(auth) => completeResubscribe(auth)}
        />
      ) : (
        <ThePayOnePaymentOverlay
          title="카드 정보"
          busy={Boolean(busy)}
          primaryDisabled={
            ![6, 10].includes(digits(resubscribeAuth.identityNumber, 10).length)
            || digits(resubscribeAuth.cardPassword, 2).length !== 2
            || !resubscribeAuth.consent
          }
          primaryLabel={busy === "resubscribe" ? "결제를 진행하고 있습니다..." : "확인"}
          secondaryLabel="취소"
          onClose={() => {
            setResubscribeAuth(null);
            setResubscribeUseDifferentCard(false);
          }}
          onSubmit={() => void resubscribeMonthly()}
        >
          <div className="mt-8 grid gap-5">
            {selectedPaymentCard && (
              <SelectedPaymentCard
                card={selectedPaymentCard}
                disabled={Boolean(busy)}
                onUseDifferentCard={() => setResubscribeUseDifferentCard(true)}
              />
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="min-w-0 text-xs font-bold text-neutral-300">
                생년월일 또는 사업자번호
                <input
                  data-payment-autofocus
                  required
                  inputMode="numeric"
                  autoComplete="off"
                  value={resubscribeAuth.identityNumber}
                  onChange={(event) => setResubscribeAuth((current) => current ? {
                    ...current,
                    identityNumber: digits(event.target.value, 10),
                  } : current)}
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
                  value={resubscribeAuth.cardPassword}
                  onChange={(event) => setResubscribeAuth((current) => current ? {
                    ...current,
                    cardPassword: digits(event.target.value, 2),
                  } : current)}
                  placeholder="••"
                  className="mt-2 min-h-14 w-full rounded-2xl border border-white/10 bg-[#101315] px-4 text-base text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8f80]/70 focus:ring-4 focus:ring-[#ff715e]/10"
                />
              </label>
            </div>
            <PurchaseTermsConsent
              checked={resubscribeAuth.consent}
              onChange={(consent) => setResubscribeAuth((current) => current
                ? { ...current, consent }
                : current)}
            />
          </div>
        </ThePayOnePaymentOverlay>
      ))}

      <PaymentMessageOverlay
        open={Boolean(error)}
        tone="error"
        title="결제를 확인해 주세요"
        message={error || ""}
        onClose={() => setError(null)}
      />

      <PaymentMessageOverlay
        open={Boolean(earlyBirdSuccess)}
        tone="success"
        title="추가시간 충전 완료"
        highlight={earlyBirdSuccess
          ? <AnimatedMinuteCredit minutes={earlyBirdSuccess.minutes} />
          : null}
        message={earlyBirdSuccess
          ? [
              `얼리버드 ${priceFormatter.format(earlyBirdSuccess.minutes)}분이 즉시 추가되었습니다.`,
              `결제금액은 ₩${priceFormatter.format(earlyBirdSuccess.chargedAmountKrw)}입니다.`,
              earlyBirdSuccess.remainingMinutes === null
                ? "새로운 남은 사용량을 확인하고 있습니다."
                : `현재 남은 사용량은 ${priceFormatter.format(earlyBirdSuccess.remainingMinutes)}분입니다.`,
              "추가시간은 구매일부터 90일 동안 사용할 수 있습니다.",
            ].join("\n")
          : ""}
        onClose={() => setEarlyBirdSuccess(null)}
      />

      {previewMessage && (
        <div className={styles.previewToast} role="status">
          <span>{previewMessage}</span>
          <button type="button" onClick={() => setPreviewMessage(null)} aria-label="안내 닫기">×</button>
        </div>
      )}
    </>
  );
}
