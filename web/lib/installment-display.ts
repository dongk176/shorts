import type {
  InstallmentBenefitType,
  InstallmentTerm,
} from "./installments";

export type InstallmentDisplayLine = {
  benefitType: InstallmentBenefitType;
  customerPaidInstallments: number | null;
  minAmountKrw: number;
  note: string;
  supportedMonths: number[];
  pendingMonths: number[];
};

export type InstallmentIssuerGroup = {
  issuerCode: string;
  issuerName: string;
  lines: InstallmentDisplayLine[];
};

export function compactInstallmentMonths(values: number[]) {
  const months = [...new Set(values)].sort((left, right) => left - right);
  const ranges: string[] = [];

  for (let index = 0; index < months.length;) {
    const start = months[index];
    let end = start;
    while (index + 1 < months.length && months[index + 1] === end + 1) {
      index += 1;
      end = months[index];
    }
    ranges.push(start === end ? `${start}개월` : `${start}~${end}개월`);
    index += 1;
  }

  return ranges.join(", ");
}

export function groupInstallmentTerms(terms: InstallmentTerm[]): InstallmentIssuerGroup[] {
  const issuers = new Map<string, {
    issuerCode: string;
    issuerName: string;
    lines: Map<string, InstallmentDisplayLine>;
  }>();

  terms.forEach((term) => {
    const issuer = issuers.get(term.issuerCode) || {
      issuerCode: term.issuerCode,
      issuerName: term.issuerName,
      lines: new Map<string, InstallmentDisplayLine>(),
    };
    const lineKey = [
      term.benefitType,
      term.customerPaidInstallments ?? "",
      term.minAmountKrw,
      term.note,
    ].join(":");
    const line = issuer.lines.get(lineKey) || {
      benefitType: term.benefitType,
      customerPaidInstallments: term.customerPaidInstallments,
      minAmountKrw: term.minAmountKrw,
      note: term.note,
      supportedMonths: [],
      pendingMonths: [],
    };

    (term.providerSupported ? line.supportedMonths : line.pendingMonths)
      .push(term.installmentMonths);
    issuer.lines.set(lineKey, line);
    issuers.set(term.issuerCode, issuer);
  });

  return [...issuers.values()].map((issuer) => ({
    issuerCode: issuer.issuerCode,
    issuerName: issuer.issuerName,
    lines: [...issuer.lines.values()].sort((left, right) => {
      if (left.benefitType !== right.benefitType) {
        return left.benefitType === "interest_free" ? -1 : 1;
      }
      return (left.customerPaidInstallments || 0) - (right.customerPaidInstallments || 0);
    }),
  }));
}
