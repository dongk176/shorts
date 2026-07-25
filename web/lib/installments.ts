import type { Sql, TransactionSql } from "postgres";
import { HttpError } from "@/lib/http";

type BillingDb = Sql | TransactionSql;

function isoDate(value: Date | string) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

export type InstallmentBenefitType = "interest_free" | "partial_interest_free";

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

export type InstallmentOffer = {
  campaignId: string | null;
  campaignName: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  defaultMinAmountKrw: number;
  notice: string;
  terms: InstallmentTerm[];
  selectableMonths: number[];
};

const issuerAliases: Array<[string, string[]]> = [
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

export async function getActiveInstallmentOffer(
  db: BillingDb,
  input: { amountKrw: number; issuer?: string | null },
): Promise<InstallmentOffer> {
  const campaigns = await db`
    select *
    from shorts_mvp.installment_campaigns
    where status='published'
      and effective_from <= (clock_timestamp() at time zone 'Asia/Seoul')::date
      and effective_to >= (clock_timestamp() at time zone 'Asia/Seoul')::date
    order by published_at desc
    limit 1
  `;
  const campaign = campaigns[0];
  if (!campaign) {
    return {
      campaignId: null,
      campaignName: null,
      effectiveFrom: null,
      effectiveTo: null,
      defaultMinAmountKrw: 0,
      notice: "",
      terms: [],
      selectableMonths: [],
    };
  }
  const rows = await db`
    select t.*,coalesce(c.enabled,false) as provider_supported
    from shorts_mvp.installment_campaign_terms t
    left join shorts_mvp.payment_provider_installment_capabilities c
      on c.provider='thepayone' and c.installment_months=t.installment_months
    where t.campaign_id=${campaign.id}
    order by t.display_order,t.issuer_name,t.benefit_type,t.installment_months
  `;
  const issuerWasProvided = input.issuer !== undefined;
  const issuer = normalizeInstallmentIssuer(input.issuer);
  const amountKrw = Number.isSafeInteger(input.amountKrw) ? Math.max(0, input.amountKrw) : 0;
  const terms: InstallmentTerm[] = rows.map((row) => {
    const minAmountKrw = Number(row.minAmountKrw ?? campaign.defaultMinAmountKrw);
    const matchesIssuer = issuerWasProvided
      ? Boolean(issuer && row.issuerCode === issuer)
      : true;
    const selectable = Boolean(row.providerSupported)
      && amountKrw >= minAmountKrw
      && matchesIssuer;
    return {
      id: row.id,
      issuerCode: row.issuerCode,
      issuerName: row.issuerName,
      benefitType: row.benefitType,
      installmentMonths: Number(row.installmentMonths),
      customerPaidInstallments: row.customerPaidInstallments === null
        ? null
        : Number(row.customerPaidInstallments),
      minAmountKrw,
      displayOrder: Number(row.displayOrder),
      note: row.note || "",
      providerSupported: Boolean(row.providerSupported),
      selectable,
    };
  });
  return {
    campaignId: campaign.id,
    campaignName: campaign.name,
    effectiveFrom: isoDate(campaign.effectiveFrom),
    effectiveTo: isoDate(campaign.effectiveTo),
    defaultMinAmountKrw: Number(campaign.defaultMinAmountKrw),
    notice: campaign.notice || "",
    terms,
    selectableMonths: [...new Set(
      terms.filter((term) => term.selectable).map((term) => term.installmentMonths),
    )].sort((a, b) => a - b),
  };
}

export async function validateInstallmentSelection(
  _db: BillingDb,
  input: {
    billingCycle: "monthly" | "yearly";
    amountKrw: number;
    installmentMonths: number;
    campaignId?: string | null;
    issuer?: string | null;
  },
) {
  if (input.installmentMonths === 0) {
    return { campaignId: null, snapshot: {} as Record<string, unknown> };
  }
  throw new HttpError(
    409,
    "현재 모든 카드 결제는 일시불만 이용할 수 있습니다.",
    "INSTALLMENT_NOT_ALLOWED",
  );
}
