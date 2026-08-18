import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pricingSource = readFileSync(
  new URL("./pricing-client.tsx", import.meta.url),
  "utf8",
);
const checkoutSource = readFileSync(
  new URL("./plan-checkout-overlay.tsx", import.meta.url),
  "utf8",
);

describe("package installment UI", () => {
  it("does not advertise installments on the pricing cards", () => {
    expect(pricingSource).not.toContain("대상 신용카드 최대");
    expect(pricingSource).not.toContain("installmentMaxMonthsByCode");
  });

  it("requires a server-provided issuer-month option before enabling manual payment", () => {
    expect(checkoutSource).toContain("selectedInstallmentOption");
    expect(checkoutSource).toContain("Boolean(selectedInstallmentOption)");
    expect(checkoutSource).not.toContain("카드사별 혜택 조건에 따라 최대");
    expect(checkoutSource).not.toContain("체크·선불카드는 할부를 이용할 수 없습니다");
    expect(checkoutSource).not.toContain("카드를 저장하지 않으며");
  });

  it("keeps the product summary and final payment CTA concise", () => {
    expect(checkoutSource).toContain("원/월 할부 결제");
    expect(checkoutSource).toContain('"일시불로 결제"');
    expect(checkoutSource).toContain("flex min-h-[54px] items-center");
    expect(checkoutSource).not.toContain("서비스 이용기간:");
    expect(checkoutSource).not.toContain("기본시간: 매월");
    expect(checkoutSource).not.toContain("사용기한: 구매일부터");
    expect(checkoutSource).not.toContain("총 {priceFormatter.format(chargeAmount)}원 승인");
    expect(checkoutSource).not.toContain("회차당 약");
    expect(checkoutSource).not.toContain("priceFormatter.format(chargeAmount)");
  });

  it("advertises and preselects the matching package installment only when supported", () => {
    expect(pricingSource).toContain("paymentFlow === \"manual_direct\"");
    expect(pricingSource).toContain("${tierName} ${packageMonths}개월 할부결제");
    expect(pricingSource).toContain("Pay for ${tierName} in ${packageMonths} installments");
    expect(pricingSource).toContain("${tierName}を${packageMonths}回払いで決済");
    expect(pricingSource).toContain("할부 최대 ${maximumInstallmentMonths}개월");
    expect(pricingSource).toContain("preferredInstallmentMonths");
    expect(checkoutSource).toContain("preferredInstallmentMonths");
    expect(checkoutSource).toContain(
      'product.kind === "package" ? product.durationMonths : undefined',
    );
    expect(checkoutSource).toContain(
      "selectableMonths.includes(defaultInstallmentMonths)",
    );
    expect(checkoutSource).toContain("setInstallmentMonths(preferredMonths)");
    expect(checkoutSource).toContain(
      "preferredInstallmentPendingRef.current = preferredMonths > 0",
    );
  });

  it("separates package duration from the maximum payment installments up front", () => {
    expect(checkoutSource).toContain("패키지 이용기간과 할부 안내");
    expect(checkoutSource).toContain("이용기간");
    expect(checkoutSource).toContain("결제 할부");
    expect(checkoutSource).toContain("최대 {MANUAL_INSTALLMENT_MAX_MONTHS}개월");
    expect(checkoutSource).toContain(
      "일시불 또는 2~{MANUAL_INSTALLMENT_MAX_MONTHS}개월 중 선택할 수 있으며",
    );
    expect(checkoutSource).toContain("카드사 정책에 따라 제한될 수 있습니다.");
  });

  it("selects card kind, then credit-card issuer, before showing installments", () => {
    const cardKindPosition = checkoutSource.indexOf("<ManualCardKindSelect");
    const issuerSelectPosition = checkoutSource.indexOf("<CardIssuerSelect");
    const installmentSelectPosition = checkoutSource.indexOf("<InstallmentSelect");
    const cardNumberPosition = checkoutSource.indexOf(
      '<legend className="text-xs font-bold text-neutral-300">카드번호</legend>',
    );
    expect(cardKindPosition).toBeGreaterThan(-1);
    expect(issuerSelectPosition).toBeGreaterThan(cardKindPosition);
    expect(issuerSelectPosition).toBeLessThan(cardNumberPosition);
    expect(installmentSelectPosition).toBeGreaterThan(issuerSelectPosition);
    expect(checkoutSource).toContain("selectedIssuerInstallmentMonths");
    expect(checkoutSource).toContain("카드사를 먼저 선택해 주세요");
    expect(checkoutSource).toContain(
      "(!requiresInstallmentIssuer || Boolean(installmentIssuerCode))",
    );
    expect(checkoutSource).toContain(
      "(!requiresManualCardKind || Boolean(manualCardKind))",
    );
    expect(checkoutSource).not.toContain("<select");
  });

  it("keeps debit and prepaid cards cash-only without installment benefits", () => {
    expect(checkoutSource).toContain('manualCardKind === "debit_prepaid"');
    expect(checkoutSource).toContain("체크·선불카드는 일시불로 결제됩니다.");
    expect(checkoutSource).toContain('manualCardKind === "credit" && (');
    expect(checkoutSource).toContain("declaredCardKind");
  });

  it("shows issuer benefit details in the installment selector", () => {
    expect(checkoutSource).toContain("installmentBenefitDescription");
    expect(checkoutSource).toContain("selectedIssuerInstallmentDetails");
    expect(checkoutSource).toContain("optionDetails={selectedIssuerInstallmentDetails}");
    expect(checkoutSource).toContain(
      "highlightedOptions={selectedIssuerInterestFreeMonths}",
    );
    expect(checkoutSource).toContain("회 고객부담");
    expect(checkoutSource).toContain("일반 할부 · 이자 발생 가능");
    expect(checkoutSource).toContain("카드사 선택은 할부 혜택 안내용입니다.");
    expect(checkoutSource).toContain(
      "실제 적용 여부는 결제 카드와 카드사 정책에 따라 결정됩니다.",
    );
  });

  it("keeps advisory issuer and installment choices after an actionable rejection", () => {
    expect(checkoutSource).toContain("userPaymentFailureForCode");
    expect(checkoutSource).toContain("setManualCardValidationField");
    expect(checkoutSource).toContain('paymentFailure.field === "identityNumber"');
    expect(checkoutSource).not.toContain('setInstallmentIssuerCode("");\n        setForm');
  });

  it("keeps the card in memory but hides months above a definite provider limit", () => {
    expect(checkoutSource).toContain("providerMaxInstallmentMonths");
    expect(checkoutSource).toContain("cardLimitedInstallmentOffer");
    expect(checkoutSource).toContain(
      "option.installmentMonths <= providerMaxInstallmentMonths",
    );
    expect(checkoutSource).toContain('"INSTALLMENT_LIMIT_EXCEEDED"');
    expect(checkoutSource).toContain("paymentRequestIdRef.current = crypto.randomUUID()");
    expect(checkoutSource).not.toContain("더 긴 할부 옵션은 숨겼습니다.");
    expect(checkoutSource).toContain(
      "setProviderMaxInstallmentMonths(null)",
    );
  });

  it("collects required purchase terms consent on the card step", () => {
    const consentPositions = [...checkoutSource.matchAll(/<PurchaseTermsConsent/g)]
      .map((match) => match.index);
    const manualSummaryPosition = checkoutSource.indexOf(
      "{isManualOneTime && chargeAmount !== null && (",
    );
    expect(consentPositions).toHaveLength(2);
    expect(consentPositions.at(-1)).toBeLessThan(manualSummaryPosition);
    expect(checkoutSource).toContain("&& form.consent");
  });

  it("hides manual one-time checkout step titles", () => {
    expect(checkoutSource).toContain(
      'isOneTimeProduct && paymentFlow !== "legacy"',
    );
    expect(checkoutSource).not.toContain(
      'title={usesSavedPaymentMethod || step === "card"',
    );
    expect(checkoutSource).not.toContain('isManualOneTime ? "결제 확인"');
  });

  it("fails closed while a one-time payment flow is loading or disabled", () => {
    expect(checkoutSource).toContain(
      'isOneTimeProduct && paymentFlow === null',
    );
    expect(checkoutSource).toContain(
      'isOneTimeProduct && paymentFlow === "disabled"',
    );
    expect(checkoutSource).toContain("결제 옵션을 확인하고 있습니다");
    expect(checkoutSource).toContain("확인이 끝나면 카드 종류부터 선택할 수 있습니다.");
    expect(checkoutSource).toContain("현재 결제를 진행할 수 없습니다");
    expect(checkoutSource).toContain("결제 옵션 확인 시간이 초과되었습니다.");
    expect(checkoutSource).toContain("다시 불러오기");
    expect(checkoutSource).toContain("setInstallmentReloadKey");
  });

  it("keeps the manual card-step CTA active while required input is incomplete", () => {
    expect(checkoutSource).toContain(
      "? isManualOneTime ? false : !cardStepValid",
    );
    expect(checkoutSource).toContain('"[data-card-issuer-trigger]"');
    expect(checkoutSource).toContain("setInstallmentIssuerAttention(true)");
    expect(checkoutSource).toContain("attention={installmentIssuerAttention}");
    expect(checkoutSource).toContain("setManualCardKindAttention(true)");
    expect(checkoutSource).toContain("attention={manualCardKindAttention}");
    expect(checkoutSource).toContain("event.preventDefault()");
  });

  it("focuses and highlights the first invalid manual-card field", () => {
    expect(checkoutSource).toContain("firstManualCardValidationField");
    expect(checkoutSource).toContain("showManualCardValidationIssue");
    expect(checkoutSource).toContain(
      'data-manual-card-field={index === 0 ? "cardNumber" : undefined}',
    );
    expect(checkoutSource).toContain('data-manual-card-field="identityNumber"');
    expect(checkoutSource).toContain('data-manual-card-field="payerTel"');
    expect(checkoutSource).toContain("카드번호 16자리를 확인해 주세요.");
    expect(checkoutSource).toContain("scrollIntoView");
  });

  it("progressively reveals manual-card fields after each prior group is complete", () => {
    expect(checkoutSource).toContain("showManualCardNumber");
    expect(checkoutSource).toContain("showManualExpiry");
    expect(checkoutSource).toContain("showManualCardCredentials");
    expect(checkoutSource).toContain("showManualPayerTel");
    expect(checkoutSource).toContain("showManualConsent");
    expect(checkoutSource).toContain("manual-checkout-field-enter");
    expect(checkoutSource).toContain("relative z-[70]");
  });

  it("advances completed payment inputs without smooth-scrolling the sheet", () => {
    expect(checkoutSource).toContain('data-payment-advance-at="2"');
    expect(checkoutSource).toContain('data-payment-advance-at="4"');
    expect(checkoutSource).toContain('data-payment-advance-at="6,10"');
    expect(checkoutSource).toContain('data-payment-advance-at="10,11"');
    expect(checkoutSource).not.toContain("previousPayerTelCompleteRef");
    expect(checkoutSource).not.toContain("consentRef.current?.scrollIntoView");
  });
});
