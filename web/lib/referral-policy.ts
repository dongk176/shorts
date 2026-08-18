export const REFERRAL_COOKIE = "easycut_referral";
export const REFERRAL_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
export const DEFAULT_REFERRAL_COMMISSION_BPS = 2000;

export const reservedReferralSlugs = new Set([
  "account",
  "admin",
  "ai-shorts-maker",
  "api",
  "auth",
  "billing",
  "compare",
  "creator-project",
  "faq",
  "partner",
  "payment-test",
  "popular",
  "pricing",
  "pricing-2",
  "privacy",
  "projects",
  "purchase-terms",
  "refund",
  "settings",
  "support",
  "templates",
  "terms",
]);

export function normalizeReferralSlug(value: string) {
  return value.trim().toLowerCase();
}

export function isReferralSlug(value: string) {
  const slug = normalizeReferralSlug(value);
  return slug.length >= 3
    && slug.length <= 32
    && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug)
    && !reservedReferralSlugs.has(slug);
}

export function normalizeReferralLoginId(value: string) {
  return value.trim().toLowerCase();
}

export function isReferralLoginId(value: string) {
  const loginId = normalizeReferralLoginId(value);
  return loginId.length >= 3
    && loginId.length <= 32
    && /^[a-z][a-z0-9._-]*$/.test(loginId);
}

export function normalizeReferralCampaign(value: string | null | undefined) {
  const campaign = value?.trim().slice(0, 64) || "";
  return campaign && /^[A-Za-z0-9._-]+$/.test(campaign) ? campaign : null;
}

export function calculateReferralCommission(
  amountKrw: number,
  refundedAmountKrw: number,
  commissionRateBps: number,
) {
  const net = Math.max(0, Math.trunc(amountKrw) - Math.trunc(refundedAmountKrw));
  return Math.floor(net * Math.trunc(commissionRateBps) / 10_000);
}

export type ReferralCommissionInstallment = {
  installmentNumber: number;
  installmentCount: number;
  grossAmountKrw: number;
  recognizedAmountKrw: number;
  scheduledCommissionAmountKrw: number;
  commissionAmountKrw: number;
  earnedAt: Date;
  availableAt: Date;
};

export function addReferralKstMonths(value: Date, months: number) {
  const offsetMs = 9 * 60 * 60 * 1_000;
  const local = new Date(value.getTime() + offsetMs);
  const year = local.getUTCFullYear();
  const targetMonth = local.getUTCMonth() + Math.trunc(months);
  const anchorDay = local.getUTCDate();
  const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
  const shifted = new Date(Date.UTC(
    year,
    targetMonth,
    Math.min(anchorDay, lastDay),
    local.getUTCHours(),
    local.getUTCMinutes(),
    local.getUTCSeconds(),
    local.getUTCMilliseconds(),
  ));
  return new Date(shifted.getTime() - offsetMs);
}

export function calculateReferralCommissionInstallments(input: {
  amountKrw: number;
  refundedAmountKrw: number;
  commissionRateBps: number;
  recognitionMonths: number;
  approvedAt: Date;
}): ReferralCommissionInstallment[] {
  const amountKrw = Math.max(0, Math.trunc(input.amountKrw));
  const refundedAmountKrw = Math.min(
    amountKrw,
    Math.max(0, Math.trunc(input.refundedAmountKrw)),
  );
  const commissionRateBps = Math.max(0, Math.trunc(input.commissionRateBps));
  const installmentCount = Math.min(12, Math.max(1, Math.trunc(input.recognitionMonths)));
  const baseGross = Math.floor(amountKrw / installmentCount);
  const netTotal = amountKrw - refundedAmountKrw;

  return Array.from({ length: installmentCount }, (_, index) => {
    const installmentNumber = index + 1;
    const grossBefore = baseGross * index;
    const grossAmountKrw = installmentNumber === installmentCount
      ? amountKrw - grossBefore
      : baseGross;
    const grossAfter = grossBefore + grossAmountKrw;
    const netBefore = Math.min(netTotal, grossBefore);
    const netAfter = Math.min(netTotal, grossAfter);
    const earnedAt = addReferralKstMonths(input.approvedAt, index);

    return {
      installmentNumber,
      installmentCount,
      grossAmountKrw,
      recognizedAmountKrw: netAfter - netBefore,
      scheduledCommissionAmountKrw:
        Math.floor(grossAfter * commissionRateBps / 10_000)
        - Math.floor(grossBefore * commissionRateBps / 10_000),
      commissionAmountKrw:
        Math.floor(netAfter * commissionRateBps / 10_000)
        - Math.floor(netBefore * commissionRateBps / 10_000),
      earnedAt,
      availableAt: new Date(earnedAt.getTime() + 7 * 24 * 60 * 60 * 1_000),
    };
  });
}

export function maskedReferralEmail(value: string | null | undefined) {
  const email = value?.trim() || "";
  const separator = email.indexOf("@");
  if (separator <= 0) return "-";
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(2, Math.min(6, local.length - visible.length)))}@${domain}`;
}
