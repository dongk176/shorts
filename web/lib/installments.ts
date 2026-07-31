import type { Sql, TransactionSql } from "postgres";
import { HttpError } from "@/lib/http";
import { MANUAL_INSTALLMENT_MAX_MONTHS } from "@/lib/installment-policy";
import type { ThePayOneCredentialScope } from "@/lib/thepayone";

type BillingDb = Sql | TransactionSql;

export const ONE_TIME_INSTALLMENT_MIN_AMOUNT_KRW = 50_000;
export const PACKAGE_INSTALLMENT_MIN_AMOUNT_KRW = ONE_TIME_INSTALLMENT_MIN_AMOUNT_KRW;
export { MANUAL_INSTALLMENT_MAX_MONTHS } from "@/lib/installment-policy";

function isoDate(value: Date | string) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

export type InstallmentBenefitType = "interest_free" | "partial_interest_free";
export type InstallmentSelectionBenefitType =
  | InstallmentBenefitType
  | "standard_interest";

export type InstallmentTerm = {
  id: string;
  issuerCode: string;
  issuerName: string;
  benefitType: InstallmentBenefitType;
  installmentMonths: number;
  customerPaidInstallments: number | null;
  minAmountKrw: number;
  displayOrder: number;
  note: string;
  providerSupported: boolean;
  selectable: boolean;
};

export type InstallmentSelectionOption = {
  issuerCode: InstallmentIssuerCode;
  issuerName: string;
  installmentMonths: number;
  benefitType: InstallmentSelectionBenefitType;
  customerPaidInstallments: number | null;
  campaignTermId: string | null;
  minAmountKrw: number;
  note: string;
};

export type InstallmentOffer = {
  credentialScope: ThePayOneCredentialScope;
  campaignId: string | null;
  campaignName: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  defaultMinAmountKrw: number;
  notice: string;
  terms: InstallmentTerm[];
  selectableMonths: number[];
  selectableOptions: InstallmentSelectionOption[];
};

export const installmentIssuerCodes = [
  "kb",
  "shinhan",
  "samsung",
  "bc",
  "hyundai",
  "nh",
  "hana",
  "woori",
  "lotte",
] as const;

export type InstallmentIssuerCode = (typeof installmentIssuerCodes)[number];

export const installmentIssuerNames: Record<InstallmentIssuerCode, string> = {
  kb: "국민카드",
  shinhan: "신한카드",
  samsung: "삼성카드",
  bc: "BC카드",
  hyundai: "현대카드",
  nh: "농협카드",
  hana: "하나카드",
  woori: "우리카드",
  lotte: "롯데카드",
};

const issuerAliases: Array<[InstallmentIssuerCode, string[]]> = [
  ["kb", ["kb", "국민"]],
  ["shinhan", ["shinhan", "신한"]],
  ["samsung", ["samsung", "삼성"]],
  ["bc", ["bc", "비씨"]],
  ["hyundai", ["hyundai", "현대"]],
  ["nh", ["nh", "농협"]],
  ["hana", ["hana", "하나"]],
  ["woori", ["woori", "우리"]],
  ["lotte", ["lotte", "롯데"]],
];

export function normalizeInstallmentIssuer(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.toLowerCase().replace(/\s+/g, "");
  return issuerAliases.find(([, aliases]) => aliases.some((alias) => normalized.includes(alias)))?.[0]
    || null;
}

export function installmentResponseMatchesSelection(input: {
  requestedMonths: number;
  responseMonths: number;
  requestedIssuer?: string | null;
  responseIssuer?: string | null;
  responseAcquirer?: string | null;
}) {
  if (input.responseMonths !== input.requestedMonths) return false;
  if (input.requestedMonths === 0) return true;
  const requestedIssuer = normalizeInstallmentIssuer(input.requestedIssuer);
  return Boolean(
    requestedIssuer
    && (
      requestedIssuer === normalizeInstallmentIssuer(input.responseIssuer)
      || requestedIssuer === normalizeInstallmentIssuer(input.responseAcquirer)
    ),
  );
}

export async function getActiveInstallmentOffer(
  db: BillingDb,
  input: {
    amountKrw: number;
    issuer?: string | null;
    credentialScope?: ThePayOneCredentialScope;
    localManualCheckout?: boolean;
  },
): Promise<InstallmentOffer> {
  const credentialScope = input.credentialScope || "default";
  const credentialMaxMonths = credentialScope === "manual"
    ? MANUAL_INSTALLMENT_MAX_MONTHS
    : 36;
  const [campaigns, capabilityRows] = await Promise.all([
    db`
      select *
      from shorts_mvp.installment_campaigns
      where status='published'
        and effective_from <= (clock_timestamp() at time zone 'Asia/Seoul')::date
        and effective_to >= (clock_timestamp() at time zone 'Asia/Seoul')::date
      order by published_at desc
      limit 1
    `,
    db`
      select installment_months
      from shorts_mvp.payment_provider_installment_capabilities
      where provider='thepayone'
        and credential_scope=${credentialScope}
        and enabled=true
        and installment_months between 2 and ${credentialMaxMonths}
      order by installment_months
    `,
  ]);
  const campaign = campaigns[0];
  const rows = campaign
    ? await db`
      select t.*
      from shorts_mvp.installment_campaign_terms t
      where t.campaign_id=${campaign.id}
      order by t.display_order,t.issuer_name,t.benefit_type,t.installment_months
    `
    : [];
  const issuerWasProvided = input.issuer !== undefined;
  const issuer = normalizeInstallmentIssuer(input.issuer);
  const amountKrw = Number.isSafeInteger(input.amountKrw) ? Math.max(0, input.amountKrw) : 0;
  const providerSupportedMonths = new Set<number>(
    credentialScope === "manual" && input.localManualCheckout === true
      ? Array.from(
        { length: MANUAL_INSTALLMENT_MAX_MONTHS - 1 },
        (_, index) => index + 2,
      )
      : capabilityRows
        .map((row) => Number(row.installmentMonths))
        .filter((months) => (
          credentialScope !== "manual"
          || months <= MANUAL_INSTALLMENT_MAX_MONTHS
        )),
  );
  const terms: InstallmentTerm[] = rows.map((row) => {
    const installmentMonths = Number(row.installmentMonths);
    const minAmountKrw = Number(row.minAmountKrw ?? campaign.defaultMinAmountKrw);
    const matchesIssuer = issuerWasProvided
      ? Boolean(issuer && row.issuerCode === issuer)
      : true;
    const withinManualLimit = credentialScope !== "manual"
      || installmentMonths <= MANUAL_INSTALLMENT_MAX_MONTHS;
    const providerSupported = withinManualLimit
      && providerSupportedMonths.has(installmentMonths);
    const selectable = providerSupported
      && amountKrw >= minAmountKrw
      && matchesIssuer;
    return {
      id: row.id,
      issuerCode: row.issuerCode,
      issuerName: row.issuerName,
      benefitType: row.benefitType,
      installmentMonths,
      customerPaidInstallments: row.customerPaidInstallments === null
        ? null
        : Number(row.customerPaidInstallments),
      minAmountKrw,
      displayOrder: Number(row.displayOrder),
      note: row.note || "",
      providerSupported,
      selectable,
    };
  });
  const eligibleIssuerCodes = issuerWasProvided
    ? issuer ? [issuer] : []
    : [...installmentIssuerCodes];
  const manualSelectableMonths = amountKrw >= ONE_TIME_INSTALLMENT_MIN_AMOUNT_KRW
    ? [...providerSupportedMonths].sort((left, right) => left - right)
    : [];
  const selectableOptions: InstallmentSelectionOption[] = credentialScope === "manual"
    ? eligibleIssuerCodes.flatMap((issuerCode) => (
      manualSelectableMonths.map((installmentMonths) => {
        const benefitTerm = terms.find((term) => (
          term.issuerCode === issuerCode
          && term.installmentMonths === installmentMonths
          && term.selectable
        ));
        return {
          issuerCode,
          issuerName: installmentIssuerNames[issuerCode],
          installmentMonths,
          benefitType: benefitTerm?.benefitType || "standard_interest",
          customerPaidInstallments: benefitTerm?.customerPaidInstallments ?? null,
          campaignTermId: benefitTerm?.id || null,
          minAmountKrw: benefitTerm
            ? Math.max(ONE_TIME_INSTALLMENT_MIN_AMOUNT_KRW, benefitTerm.minAmountKrw)
            : ONE_TIME_INSTALLMENT_MIN_AMOUNT_KRW,
          note: benefitTerm?.note || (
            benefitTerm ? "" : "카드사 일반 할부(이자 발생 가능)"
          ),
        };
      })
    ))
    : [];
  const selectableMonths = credentialScope === "manual"
    ? manualSelectableMonths
    : [...new Set(
      terms.filter((term) => term.selectable).map((term) => term.installmentMonths),
    )].sort((left, right) => left - right);
  return {
    credentialScope,
    campaignId: campaign?.id || null,
    campaignName: campaign?.name || null,
    effectiveFrom: campaign ? isoDate(campaign.effectiveFrom) : null,
    effectiveTo: campaign ? isoDate(campaign.effectiveTo) : null,
    defaultMinAmountKrw: Number(campaign?.defaultMinAmountKrw || 0),
    notice: campaign?.notice || "",
    terms,
    selectableMonths,
    selectableOptions,
  };
}

export async function validateInstallmentSelection(
  db: BillingDb,
  input: {
    billingCycle: "monthly" | "yearly";
    amountKrw: number;
    installmentMonths: number;
    campaignId?: string | null;
    issuer?: string | null;
    productKind?: "subscription" | "package" | "addon";
    credentialScope?: ThePayOneCredentialScope;
    localManualCheckout?: boolean;
  },
) {
  if (input.installmentMonths === 0) {
    return { campaignId: null, snapshot: {} as Record<string, unknown> };
  }
  if (
    (input.productKind !== "package" && input.productKind !== "addon")
    || (input.productKind === "package" && input.billingCycle !== "yearly")
    || input.credentialScope !== "manual"
  ) {
    throw new HttpError(
      409,
      "할부는 패키지 또는 추가시간 수기결제에서만 이용할 수 있습니다.",
      "INSTALLMENT_NOT_ALLOWED",
    );
  }
  if (input.amountKrw < ONE_TIME_INSTALLMENT_MIN_AMOUNT_KRW) {
    throw new HttpError(
      409,
      "5만원 이상 일회성 상품만 할부로 결제할 수 있습니다.",
      "INSTALLMENT_MIN_AMOUNT_NOT_MET",
    );
  }
  if (input.installmentMonths > MANUAL_INSTALLMENT_MAX_MONTHS) {
    throw new HttpError(
      409,
      `수기결제 할부는 최대 ${MANUAL_INSTALLMENT_MAX_MONTHS}개월까지 선택할 수 있습니다.`,
      "INSTALLMENT_MONTHS_EXCEEDED",
    );
  }
  if (input.installmentMonths < 2) {
    throw new HttpError(
      409,
      "할부개월을 다시 확인해 주세요.",
      "INSTALLMENT_MONTHS_INVALID",
    );
  }
  const issuer = normalizeInstallmentIssuer(input.issuer);
  if (!issuer) {
    throw new HttpError(
      409,
      "할부를 선택하려면 카드사를 확인해 주세요.",
      "INSTALLMENT_ISSUER_REQUIRED",
    );
  }
  const offer = await getActiveInstallmentOffer(db, {
    amountKrw: input.amountKrw,
    issuer: input.issuer,
    credentialScope: input.credentialScope,
    localManualCheckout: input.localManualCheckout,
  });
  if (offer.campaignId !== (input.campaignId || null)) {
    throw new HttpError(
      409,
      "할부 혜택이 변경되었거나 만료되었습니다. 다시 확인해 주세요.",
      "INSTALLMENT_CAMPAIGN_CHANGED",
    );
  }
  const option = offer.selectableOptions.find(
    (candidate) => (
      candidate.installmentMonths === input.installmentMonths
      && candidate.issuerCode === issuer
    ),
  );
  if (!option) {
    throw new HttpError(
      409,
      "선택한 카드에서 지원하지 않는 할부개월입니다.",
      "INSTALLMENT_NOT_SUPPORTED",
    );
  }
  return {
    campaignId: offer.campaignId,
    snapshot: {
      credentialScope: offer.credentialScope,
      productKind: input.productKind,
      campaignName: offer.campaignName,
      effectiveFrom: offer.effectiveFrom,
      effectiveTo: offer.effectiveTo,
      issuerCode: option.issuerCode,
      issuerName: option.issuerName,
      benefitType: option.benefitType,
      installmentMonths: option.installmentMonths,
      customerPaidInstallments: option.customerPaidInstallments,
      campaignTermId: option.campaignTermId,
      minAmountKrw: option.minAmountKrw,
      note: option.note,
    },
  };
}
