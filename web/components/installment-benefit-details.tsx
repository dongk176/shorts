import type { InstallmentOffer } from "@/lib/installments";
import {
  compactInstallmentMonths,
  groupInstallmentTerms,
} from "@/lib/installment-display";

export function InstallmentBenefitDetails({
  offer,
  formatAmount,
  emptyMessage,
}: {
  offer: InstallmentOffer | null;
  formatAmount: (amountKrw: number) => string;
  emptyMessage: string;
}) {
  if (!offer?.campaignId) {
    return (
      <p className="mt-6 rounded-xl bg-amber-300/10 p-4 text-sm text-amber-100">
        {emptyMessage}
      </p>
    );
  }

  const issuerGroups = groupInstallmentTerms(offer.terms);

  return (
    <>
      {offer.notice && (
        <p className="mt-4 text-sm leading-6 text-neutral-400">{offer.notice}</p>
      )}
      <div className="mt-5 grid items-start gap-3 sm:grid-cols-2">
        {issuerGroups.map((issuer) => (
          <article
            key={issuer.issuerCode}
            className="rounded-2xl border border-white/8 bg-black/15 p-4"
          >
            <strong className="text-sm text-white">{issuer.issuerName}</strong>
            <div className="mt-3 divide-y divide-white/8">
              {issuer.lines.map((line) => (
                <div
                  key={`${line.benefitType}-${line.customerPaidInstallments}-${line.minAmountKrw}-${line.note}`}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div>
                    <span className="block text-xs font-bold text-neutral-300">
                      {line.benefitType === "interest_free" ? "무이자" : "부분 무이자"}
                    </span>
                    {line.benefitType === "partial_interest_free" && (
                      <span className="mt-1 block text-[11px] leading-4 text-neutral-500">
                        1~{line.customerPaidInstallments}회차 고객 부담
                      </span>
                    )}
                    {line.minAmountKrw !== offer.defaultMinAmountKrw && (
                      <span className="mt-1 block text-[10px] text-neutral-600">
                        {formatAmount(line.minAmountKrw)} 이상
                      </span>
                    )}
                  </div>
                  <div className="text-right text-xs font-black leading-5">
                    {line.supportedMonths.length > 0 && (
                      <span className="block text-white">
                        {compactInstallmentMonths(line.supportedMonths)}
                      </span>
                    )}
                    {line.pendingMonths.length > 0 && (
                      <span className="block text-amber-300">
                        {compactInstallmentMonths(line.pendingMonths)}
                        <small className="block text-[10px] font-bold">PG 지원 확인 중</small>
                      </span>
                    )}
                    {line.note && (
                      <span className="mt-1 block text-[10px] font-medium text-neutral-500">
                        {line.note}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
