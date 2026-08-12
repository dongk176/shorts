import type { Sql, TransactionSql } from "postgres";
import type { PaymentMethodAction } from "@/lib/contracts";
import { HttpError } from "@/lib/http";

export const LEGACY_CARD_CAMPAIGN_KEY = "legacy_easycut_pro_202608";
export const LEGACY_CARD_CLAIMS_FLAG = "legacy_recurring_card_claims";
export const LEGACY_CARD_RECONCILIATION_FLAG = "legacy_recurring_card_reconciliation";
export const LEGACY_CARD_EXPECTED_PLAN = "easycut_pro_v2";
export const LEGACY_CARD_EXPECTED_AMOUNT_KRW = 9_900;

export type RemediationDb = Sql | TransactionSql;

export type PaymentMethodRemediationRow = Record<string, unknown> & {
  id: string;
  userId: string;
  subscriptionId: string;
  legacyPaymentMethodId: string;
  originalNextChargeAt: Date;
  originalCurrentPeriodEnd: Date;
  billingAnchorDay: number;
  expectedProductCode: string;
  expectedAmountKrw: number;
  state: "required" | "registering" | "awaiting_provider" | "completed" | "expired" | "manual_review" | "superseded";
  requestId: string | null;
  registrationTrackId: string | null;
  newPaymentMethodId: string | null;
  enabledAt: Date | null;
};

export function kstDateKey(value: Date) {
  return new Date(value.getTime() + 9 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
}

export function hasKstBillingDateStarted(originalNextChargeAt: Date, now = new Date()) {
  return kstDateKey(now) >= kstDateKey(originalNextChargeAt);
}

export function effectiveRemediationState(
  row: Pick<PaymentMethodRemediationRow, "state" | "originalNextChargeAt">,
  now = new Date(),
) {
  if (
    (row.state === "required" || row.state === "registering")
    && hasKstBillingDateStarted(row.originalNextChargeAt, now)
  ) {
    return "awaiting_provider" as const;
  }
  return row.state;
}

async function featureFlagEnabled(db: RemediationDb, key: string) {
  const rows = await db`
    select enabled
    from shorts_mvp.runtime_feature_flags
    where flag_key=${key}
    limit 1
  `;
  return rows[0]?.enabled === true;
}

export async function legacyCardClaimsEnabled(db: RemediationDb) {
  return featureFlagEnabled(db, LEGACY_CARD_CLAIMS_FLAG);
}

export async function legacyCardReconciliationEnabled(db: RemediationDb) {
  return featureFlagEnabled(db, LEGACY_CARD_RECONCILIATION_FLAG);
}

export async function getPaymentMethodRemediation(
  db: RemediationDb,
  userId: string,
) {
  const rows = await db`
    select r.*
    from shorts_mvp.billing_payment_method_remediations r
    where r.user_id=${userId}
      and r.campaign_key=${LEGACY_CARD_CAMPAIGN_KEY}
      and r.enabled_at is not null
    order by r.created_at desc
    limit 1
  `;
  return (rows[0] || null) as PaymentMethodRemediationRow | null;
}

export async function getPaymentMethodAction(
  db: RemediationDb,
  userId: string | null,
  now = new Date(),
): Promise<PaymentMethodAction> {
  if (!userId) return null;
  const row = await getPaymentMethodRemediation(db, userId);
  if (!row || row.state === "completed" || row.state === "superseded") return null;
  const state = effectiveRemediationState(row, now);
  if (state === "completed" || state === "superseded") return null;
  if (state === "required" && !(await legacyCardClaimsEnabled(db))) return null;
  return {
    type: "legacy_recurring_reconfirmation",
    remediationId: row.id,
    state,
  };
}

export async function assertPaymentMethodRemediationAccess(
  db: RemediationDb,
  userId: string,
) {
  const action = await getPaymentMethodAction(db, userId);
  if (!action || action.state === "expired") return;
  throw new HttpError(
    423,
    "결제수단 확인을 완료해 주세요.",
    "PAYMENT_METHOD_RECONFIRMATION_REQUIRED",
  );
}

export async function getReconcilableRemediationByMethod(
  db: RemediationDb,
  paymentMethodId: string,
) {
  if (!(await legacyCardReconciliationEnabled(db))) return null;
  const rows = await db`
    select r.*
    from shorts_mvp.billing_payment_method_remediations r
    where r.campaign_key=${LEGACY_CARD_CAMPAIGN_KEY}
      and r.legacy_payment_method_id=${paymentMethodId}
      and r.enabled_at is not null
      and r.state in ('required','registering','awaiting_provider')
    limit 1
  `;
  return (rows[0] || null) as PaymentMethodRemediationRow | null;
}

export async function getReconcilableRemediationBySubscription(
  db: RemediationDb,
  subscriptionId: string,
) {
  if (!(await legacyCardReconciliationEnabled(db))) return null;
  const rows = await db`
    select r.*
    from shorts_mvp.billing_payment_method_remediations r
    where r.campaign_key=${LEGACY_CARD_CAMPAIGN_KEY}
      and r.subscription_id=${subscriptionId}
      and r.enabled_at is not null
      and r.state in ('required','registering','awaiting_provider')
    limit 1
  `;
  return (rows[0] || null) as PaymentMethodRemediationRow | null;
}
