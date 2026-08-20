import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { getDb } from "@/lib/db";
import {
  tossBillingCohortAssignmentEnabled,
  tossBillingEnabled,
} from "@/lib/toss-billing-config";

export type BillingCustomerCohort = "legacy_thepayone" | "toss_v1";

export type BillingCohortResolution = {
  cohort: BillingCustomerCohort;
  providerCustomerKey: string | null;
  persisted: boolean;
  reason: string;
};

export type PersistedTossBillingCustomer = BillingCohortResolution & {
  cohort: "toss_v1";
  providerCustomerKey: string;
  persisted: true;
};

export function requirePersistedTossBillingCustomer(
  resolution: BillingCohortResolution,
): PersistedTossBillingCustomer {
  if (
    resolution.cohort !== "toss_v1"
    || !resolution.persisted
    || !resolution.providerCustomerKey
  ) {
    throw new Error("Toss billing is not allowed for this customer");
  }
  return resolution as PersistedTossBillingCustomer;
}

export function cohortForBillingEvidence(input: {
  existing?: BillingCohortResolution | null;
  hasHistoricalNonTossPayment: boolean;
  hasHistoricalNonTossSubscription: boolean;
  hasHistoricalNonTossPaymentMethod: boolean;
  hasActiveLegacyBaseGrant?: boolean;
  assignmentEnabled: boolean;
}): BillingCustomerCohort {
  if (input.existing) return input.existing.cohort;
  if (!input.assignmentEnabled) return "legacy_thepayone";
  if (
    input.hasHistoricalNonTossPayment
    || input.hasHistoricalNonTossSubscription
    || input.hasHistoricalNonTossPaymentMethod
    || input.hasActiveLegacyBaseGrant
  ) {
    return "legacy_thepayone";
  }
  return "toss_v1";
}

function fallback(reason: string): BillingCohortResolution {
  return {
    cohort: "legacy_thepayone",
    providerCustomerKey: null,
    persisted: false,
    reason,
  };
}

async function existingCohort(db: Sql | TransactionSql, userId: string) {
  const rows = await db`
    select cohort,provider_customer_key,source_reason
    from shorts_mvp.billing_customer_cohorts
    where user_id=${userId}
    limit 1
  `;
  const row = rows[0] as {
    cohort: BillingCustomerCohort;
    providerCustomerKey: string | null;
    sourceReason: string;
  } | undefined;
  if (!row) return null;
  return {
    cohort: row.cohort,
    providerCustomerKey: row.providerCustomerKey,
    persisted: true,
    reason: row.sourceReason,
  } satisfies BillingCohortResolution;
}

export async function resolveBillingCustomerCohort(
  userId: string,
  db: Sql = getDb(),
): Promise<BillingCohortResolution> {
  try {
    // Persisted assignments are immutable and must remain readable even while
    // rollout or charging is paused. This prevents a Toss customer from ever
    // falling through to the legacy ThePayOne experience during a kill switch.
    const existing = await existingCohort(db, userId);
    if (existing) return existing;
    if (!tossBillingEnabled()) return fallback("toss_feature_disabled");
    if (!tossBillingCohortAssignmentEnabled()) {
      return fallback("cohort_assignment_disabled");
    }

    return await db.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${userId},0))`;
      const lockedExisting = await existingCohort(tx, userId);
      if (lockedExisting) return lockedExisting;

      const evidenceRows = await tx`
        select
          exists (
            select 1
            from shorts_mvp.billing_orders billing_order
            where billing_order.user_id=${userId}
              and billing_order.amount_krw>0
              and billing_order.provider<>'toss'
              and (
                billing_order.status='succeeded'
                or billing_order.approved_at is not null
                or billing_order.provider_transaction_id is not null
              )
          ) as has_historical_non_toss_payment,
          exists (
            select 1
            from shorts_mvp.user_subscriptions subscription
            where subscription.user_id=${userId}
              and coalesce(subscription.payment_provider,'thepayone')<>'toss'
              and (
                subscription.payment_method_id is not null
                or subscription.status in ('pending','trialing','active','past_due')
              )
          ) as has_historical_non_toss_subscription,
          exists (
            select 1
            from shorts_mvp.billing_payment_methods payment_method
            where payment_method.user_id=${userId}
              and payment_method.provider<>'toss'
          ) as has_historical_non_toss_payment_method,
          exists (
            select 1
            from shorts_mvp.usage_grants usage_grant
            where usage_grant.user_id=${userId}
              and usage_grant.kind='base'
              and usage_grant.status='active'
              and usage_grant.expires_at>now()
          ) as has_active_legacy_base_grant
      `;
      const evidence = evidenceRows[0] as {
        hasHistoricalNonTossPayment: boolean;
        hasHistoricalNonTossSubscription: boolean;
        hasHistoricalNonTossPaymentMethod: boolean;
        hasActiveLegacyBaseGrant: boolean;
      };
      const cohort = cohortForBillingEvidence({
        hasHistoricalNonTossPayment: evidence.hasHistoricalNonTossPayment,
        hasHistoricalNonTossSubscription: evidence.hasHistoricalNonTossSubscription,
        hasHistoricalNonTossPaymentMethod: evidence.hasHistoricalNonTossPaymentMethod,
        hasActiveLegacyBaseGrant: evidence.hasActiveLegacyBaseGrant,
        assignmentEnabled: true,
      });
      const providerCustomerKey = cohort === "toss_v1"
        ? `EC_${randomUUID().replaceAll("-", "")}`
        : null;
      const reason = cohort === "toss_v1"
        ? "no_historical_subscription_payment"
        : evidence.hasHistoricalNonTossPayment
          ? "historical_non_toss_subscription_payment"
          : evidence.hasHistoricalNonTossSubscription
            ? "historical_non_toss_subscription"
            : evidence.hasHistoricalNonTossPaymentMethod
              ? "historical_non_toss_payment_method"
              : "active_legacy_base_grant";
      const inserted = await tx`
        insert into shorts_mvp.billing_customer_cohorts (
          user_id,cohort,provider_customer_key,source_reason
        ) values (
          ${userId},${cohort},${providerCustomerKey},${reason}
        )
        returning cohort,provider_customer_key,source_reason
      `;
      const row = inserted[0] as {
        cohort: BillingCustomerCohort;
        providerCustomerKey: string | null;
        sourceReason: string;
      };
      return {
        cohort: row.cohort,
        providerCustomerKey: row.providerCustomerKey,
        persisted: true,
        reason: row.sourceReason,
      };
    });
  } catch {
    // Classification must fail closed. Existing paying customers always retain
    // the current ThePayOne experience when the new table or database is unavailable.
    return fallback("classification_failed_closed");
  }
}

export async function assertPersistedTossBillingCustomer(
  userId: string,
  db: Sql | TransactionSql,
): Promise<PersistedTossBillingCustomer> {
  const existing = await existingCohort(db, userId);
  return requirePersistedTossBillingCustomer(
    existing ?? fallback("missing_persisted_toss_cohort"),
  );
}
