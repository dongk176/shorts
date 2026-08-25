import type { Sql, TransactionSql } from "postgres";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import {
  assertTossBillingChargesEnabled,
  tossBillingChargesEnabled,
  tossBillingCohortAssignmentEnabled,
  tossBillingRenewalsEnabled,
  tossEnterpriseBillingEnabled,
} from "@/lib/toss-billing-config";
import {
  TOSS_RUNTIME_ASSIGNMENTS_FLAG,
  TOSS_RUNTIME_CHARGES_FLAG,
  TOSS_RUNTIME_FLAGS,
  TOSS_RUNTIME_HANA_CARD_FLAG,
  TOSS_RUNTIME_ENTERPRISE_BILLING_FLAG,
  TOSS_RUNTIME_RENEWALS_FLAG,
  type TossBillingRuntimeState,
  type TossRuntimeFlag,
} from "@/lib/toss-billing-runtime-contract";

export {
  TOSS_RUNTIME_ASSIGNMENTS_FLAG,
  TOSS_RUNTIME_CHARGES_FLAG,
  TOSS_RUNTIME_FLAGS,
  TOSS_RUNTIME_HANA_CARD_FLAG,
  TOSS_RUNTIME_ENTERPRISE_BILLING_FLAG,
  TOSS_RUNTIME_RENEWALS_FLAG,
};
export type { TossBillingRuntimeState, TossRuntimeFlag };

type BillingDb = Sql | TransactionSql;
export const TOSS_HANA_CARD_ISSUER_CODE = "21";

export function isTossRuntimeFlag(value: string): value is TossRuntimeFlag {
  return (TOSS_RUNTIME_FLAGS as readonly string[]).includes(value);
}

export async function loadTossBillingRuntimeState(
  db: BillingDb = getDb(),
): Promise<TossBillingRuntimeState> {
  let rows: Array<{ flagKey: string; enabled: boolean }> = [];
  try {
    rows = await db`
      select flag_key,enabled
      from shorts_mvp.runtime_feature_flags
      where flag_key in (
        ${TOSS_RUNTIME_ASSIGNMENTS_FLAG},
        ${TOSS_RUNTIME_CHARGES_FLAG},
        ${TOSS_RUNTIME_RENEWALS_FLAG},
        ${TOSS_RUNTIME_HANA_CARD_FLAG},
        ${TOSS_RUNTIME_ENTERPRISE_BILLING_FLAG}
      )
    ` as Array<{ flagKey: string; enabled: boolean }>;
  } catch {
    // Runtime controls fail closed when the migration or database is unavailable.
    rows = [];
  }
  const enabled = new Map(rows.map((row) => [row.flagKey, Boolean(row.enabled)]));
  const stored = {
    assignments: enabled.get(TOSS_RUNTIME_ASSIGNMENTS_FLAG) === true,
    charges: enabled.get(TOSS_RUNTIME_CHARGES_FLAG) === true,
    renewals: enabled.get(TOSS_RUNTIME_RENEWALS_FLAG) === true,
    hanaCard: enabled.get(TOSS_RUNTIME_HANA_CARD_FLAG) === true,
    enterpriseBilling: enabled.get(TOSS_RUNTIME_ENTERPRISE_BILLING_FLAG) === true,
  };
  const environment = {
    assignments: tossBillingCohortAssignmentEnabled(),
    charges: tossBillingChargesEnabled(),
    renewals: tossBillingRenewalsEnabled(),
    hanaCard: true,
    enterpriseBilling: tossEnterpriseBillingEnabled(),
  };
  const effectiveCharges = environment.charges && stored.charges;
  return {
    stored,
    environment,
    effective: {
      assignments: environment.assignments && stored.assignments && effectiveCharges,
      charges: effectiveCharges,
      renewals: environment.renewals && stored.renewals && effectiveCharges,
      hanaCard: stored.hanaCard,
      enterpriseBilling:
        environment.enterpriseBilling && stored.enterpriseBilling && effectiveCharges,
    },
  };
}

export async function tossRuntimeAssignmentsEnabled(db: BillingDb = getDb()) {
  return (await loadTossBillingRuntimeState(db)).effective.assignments;
}

export async function tossRuntimeRenewalsEnabled(db: BillingDb = getDb()) {
  return (await loadTossBillingRuntimeState(db)).effective.renewals;
}

export async function assertTossRuntimeChargesEnabled(db: BillingDb = getDb()) {
  assertTossBillingChargesEnabled();
  if (!(await loadTossBillingRuntimeState(db)).effective.charges) {
    throw new HttpError(
      503,
      "토스 결제를 잠시 점검하고 있습니다. 잠시 후 다시 시도해 주세요.",
      "TOSS_RUNTIME_CHARGES_DISABLED",
    );
  }
}

export async function assertTossEnterpriseBillingEnabled(db: BillingDb = getDb()) {
  const state = await loadTossBillingRuntimeState(db);
  if (!state.effective.enterpriseBilling) {
    throw new HttpError(
      503,
      "기업 카드 결제를 잠시 점검하고 있습니다. 잠시 후 다시 시도해 주세요.",
      "TOSS_ENTERPRISE_BILLING_DISABLED",
    );
  }
}

export function isTossCardIssuerAllowed(input: {
  issuerCode: string | null | undefined;
  hanaCardEnabled: boolean;
}) {
  return input.issuerCode !== TOSS_HANA_CARD_ISSUER_CODE || input.hanaCardEnabled;
}

export async function assertTossCardIssuerAllowed(
  db: BillingDb,
  issuerCode: string | null | undefined,
) {
  const runtime = await loadTossBillingRuntimeState(db);
  if (!isTossCardIssuerAllowed({
    issuerCode,
    hanaCardEnabled: runtime.effective.hanaCard,
  })) {
    throw new HttpError(
      409,
      "하나카드는 아직 토스 자동결제에 사용할 수 없습니다. 다른 카드를 이용해 주세요.",
      "TOSS_HANA_CARD_UNAVAILABLE",
    );
  }
}
