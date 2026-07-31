"use client";

import { useId, useState } from "react";
import type { InstallmentOffer } from "@/lib/installments";
import { InstallmentBenefitDetails } from "./installment-benefit-details";

function benefitLabel(term: InstallmentOffer["terms"][number]) {
  if (term.benefitType === "interest_free") return "무이자";
  return term.customerPaidInstallments
    ? `부분 무이자 · 1~${term.customerPaidInstallments}회차 고객 부담`
    : "부분 무이자";
}

export function InstallmentBenefitsAccordion({
  offer,
  amountKrw,
  formatAmount,
  onSelect,
}: {
  offer: InstallmentOffer | null;
  amountKrw: number;
  formatAmount: (amountKrw: number) => string;
  onSelect: (issuerCode: string, installmentMonths: number) => void;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [showAllTerms, setShowAllTerms] = useState(false);
  const selectable = (offer?.terms || []).filter((term) => term.selectable);
  const generalInstallmentsAvailable = Boolean(offer?.selectableOptions.length);
  const issuerCount = new Set((offer?.terms || []).map((term) => term.issuerCode)).size;
  const selectableMonths = [...new Set(selectable.map((term) => term.installmentMonths))]
    .sort((left, right) => left - right);
  const maxSelectableMonths = selectableMonths.at(-1) || null;
  const selectableIssuerGroups = [...selectable.reduce((groups, term) => {
    const group = groups.get(term.issuerCode) || {
      issuerCode: term.issuerCode,
      issuerName: term.issuerName,
      terms: [] as typeof selectable,
    };
    group.terms.push(term);
    groups.set(term.issuerCode, group);
    return groups;
  }, new Map<string, {
    issuerCode: string;
    issuerName: string;
    terms: typeof selectable;
  }>()).values()];
  const belowMinimum = amountKrw < 50_000;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#101315]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((current) => !current);
          if (open) setShowAllTerms(false);
        }}
        className="flex min-h-[72px] w-full items-center justify-between gap-4 px-4 py-3 text-left outline-none transition hover:bg-white/[.025] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#ff8f80]/70"
      >
        <span className="min-w-0">
          <strong className="block text-base leading-6 text-white">이번 달 할부 혜택</strong>
          <small className="mt-0.5 block text-xs leading-5 text-neutral-400">
            {offer?.campaignId
              ? `${issuerCount}개 카드사${
                maxSelectableMonths
                  ? ` · 최대 ${maxSelectableMonths}개월 선택 가능`
                  : ""
              }`
              : "현재 진행 중인 혜택 없음"}
          </small>
        </span>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[.05] text-neutral-400">
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 8 4 4 4-4" />
          </svg>
        </span>
      </button>
      {open && (
        <div id={panelId} className="border-t border-white/8 bg-black/10 px-4 pb-4">
          {offer?.campaignId ? (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                <strong className="text-sm text-neutral-100">{offer.campaignName}</strong>
                <p className="text-xs leading-5 text-neutral-500">
                  {offer.effectiveFrom} ~ {offer.effectiveTo}
                  {offer.defaultMinAmountKrw > 0
                    ? ` · ${formatAmount(offer.defaultMinAmountKrw)} 이상`
                    : ""}
                </p>
              </div>
              <section aria-labelledby={`${panelId}-available`}>
                <h4
                  id={`${panelId}-available`}
                  className="border-b border-white/[.06] pb-2 text-xs font-bold text-neutral-400"
                >
                  현재 결제에서 선택 가능
                </h4>
                {selectable.length > 0 ? (
                  <div className="divide-y divide-white/[.06]">
                    {selectableIssuerGroups.map((issuer) => (
                      <div
                        key={issuer.issuerCode}
                        className="flex items-start justify-between gap-3 py-3"
                      >
                        <strong className="min-w-16 pt-1.5 text-sm text-neutral-100">
                          {issuer.issuerName}
                        </strong>
                        <div className="flex flex-1 flex-wrap justify-end gap-1.5">
                          {issuer.terms.map((term) => (
                            <button
                              key={term.id}
                              type="button"
                              onClick={() => onSelect(term.issuerCode, term.installmentMonths)}
                              className="rounded-lg border border-white/[.08] bg-white/[.035] px-3 py-2 text-xs text-neutral-200 outline-none transition hover:border-[#ff8f80]/35 hover:bg-[#ff715e]/8 hover:text-white focus-visible:ring-2 focus-visible:ring-[#ff8f80]/50"
                              aria-label={`${term.issuerName} ${term.installmentMonths}개월 ${benefitLabel(term)} 선택`}
                            >
                              <strong className="text-white">{term.installmentMonths}개월</strong>
                              <span className={`ml-1 font-bold ${
                                term.benefitType === "interest_free"
                                  ? "text-emerald-200"
                                  : "text-neutral-300"
                              }`}>
                                {term.benefitType === "interest_free" ? "무이자" : "부분 무이자"}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-4 text-sm leading-6 text-neutral-300">
                    {belowMinimum
                      ? "할부 혜택은 5만원 이상 결제부터 적용됩니다."
                      : generalInstallmentsAvailable
                        ? "현재 결제금액에 적용되는 카드사 혜택은 없습니다. 일반 할부는 결제 방식에서 선택할 수 있습니다."
                        : "현재 이 결제에서 선택 가능한 할부가 없습니다."}
                  </p>
                )}
              </section>
              <button
                type="button"
                aria-expanded={showAllTerms}
                aria-controls={`${panelId}-all`}
                onClick={() => setShowAllTerms((current) => !current)}
                className="flex w-full items-center justify-between border-t border-white/[.06] py-3 text-left text-xs font-bold text-neutral-400 outline-none transition hover:text-neutral-200 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#ff8f80]/50"
              >
                <span>전체 카드사 혜택 조건</span>
                <span>{showAllTerms ? "접기" : "보기"}</span>
              </button>
              {showAllTerms && (
                <section id={`${panelId}-all`} aria-label="카드사별 이번 달 전체 혜택">
                  <InstallmentBenefitDetails
                    offer={offer}
                    formatAmount={formatAmount}
                    emptyMessage="현재 진행 중인 할부 혜택이 없습니다."
                  />
                </section>
              )}
              <p className="border-t border-white/[.06] pt-3 text-[11px] leading-5 text-neutral-500">
                혜택 적용 여부는 카드 상품·회원 상태 및 카드사 정책에 따라 달라질 수 있습니다.
              </p>
            </>
          ) : (
            <p className="py-4 text-sm leading-6 text-neutral-300">
              {generalInstallmentsAvailable
                ? "현재 진행 중인 무이자 혜택은 없습니다. 일반 할부는 선택할 수 있으며 이자는 카드사 정책에 따라 적용됩니다."
                : "현재 진행 중인 할부 혜택이 없습니다. 일시불로 결제해 주세요."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
