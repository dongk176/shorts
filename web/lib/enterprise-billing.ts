import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import {
  ENTERPRISE_CONSENT_COPY_VERSION,
  ENTERPRISE_PURCHASE_TERMS_HASH,
  ENTERPRISE_PURCHASE_TERMS_VERSION,
  ENTERPRISE_REFUND_POLICY_HASH,
  ENTERPRISE_REFUND_POLICY_VERSION,
  enterprisePaymentRequestExpiresAt,
  type EnterprisePaymentItemInput,
  validateEnterpriseItemSequence,
} from "@/lib/enterprise-contract";
import { HttpError } from "@/lib/http";

type EnterpriseDb = Sql | TransactionSql;

export async function ensureEnterpriseTossBillingCustomer(input: {
  db: EnterpriseDb;
  managedAccountId: string;
  appUserId: string;
}) {
  await input.db`
    select pg_advisory_xact_lock(hashtextextended(${`enterprise-billing:${input.appUserId}`},0))
  `;
  const cohortRows = await input.db`
    select cohort,provider_customer_key
    from shorts_mvp.billing_customer_cohorts
    where user_id=${input.appUserId}
    limit 1
  `;
  const existing = cohortRows[0];
  if (existing && existing.cohort !== "toss_v1") {
    throw new HttpError(
      409,
      "이 기업 계정에는 기존 결제 이력이 있어 기업 카드등록을 시작할 수 없습니다.",
      "ENTERPRISE_BILLING_COHORT_CONFLICT",
    );
  }
  if (!existing) {
    await input.db`
      insert into shorts_mvp.billing_customer_cohorts (
        user_id,cohort,provider_customer_key,source_reason
      ) values (
        ${input.appUserId},'toss_v1',
        ${`EC_${randomUUID().replaceAll("-", "")}`},
        'enterprise_managed_account'
      )
    `;
  }
  await input.db`
    insert into shorts_mvp.enterprise_billing_profiles (
      managed_account_id,app_user_id
    ) values (${input.managedAccountId},${input.appUserId})
    on conflict (managed_account_id) do nothing
  `;
}

export async function insertEnterpriseBillingRequest(input: {
  db: EnterpriseDb;
  createRequestId: string;
  managedAccountId: string;
  appUserId: string;
  createdByUserId: string;
  customerName: string;
  customerEmail?: string | null;
  title: string;
  blocksServiceAccess: boolean;
  items: EnterprisePaymentItemInput[];
}) {
  const items = validateEnterpriseItemSequence(input.items);
  const expiresAt = enterprisePaymentRequestExpiresAt(items);
  if (expiresAt.getTime() <= Date.now()) {
    throw new HttpError(400, "마지막 결제 기한은 오늘 이후여야 합니다.");
  }
  await ensureEnterpriseTossBillingCustomer({
    db: input.db,
    managedAccountId: input.managedAccountId,
    appUserId: input.appUserId,
  });
  const requestRows = await input.db`
    insert into shorts_mvp.enterprise_payment_requests (
      create_request_id,managed_account_id,customer_name,customer_email,title,
      payment_mode,blocks_service_access,expires_at,created_by_user_id,
      purchase_terms_version,purchase_terms_hash,refund_policy_version,
      refund_policy_hash,consent_copy_version
    ) values (
      ${input.createRequestId},${input.managedAccountId},${input.customerName},
      ${input.customerEmail || null},${input.title},'billing',
      ${input.blocksServiceAccess},${expiresAt},${input.createdByUserId},
      ${ENTERPRISE_PURCHASE_TERMS_VERSION},${ENTERPRISE_PURCHASE_TERMS_HASH},
      ${ENTERPRISE_REFUND_POLICY_VERSION},${ENTERPRISE_REFUND_POLICY_HASH},
      ${ENTERPRISE_CONSENT_COPY_VERSION}
    )
    returning id,public_token,expires_at
  `;
  const paymentRequest = requestRows[0];
  for (const [index, item] of items.entries()) {
    await input.db`
      insert into shorts_mvp.enterprise_payment_items (
        payment_request_id,sort_order,name,amount_krw,
        service_start_date,service_end_date,duration_value,duration_unit,
        included_minutes,vat_treatment,payment_due_date
      ) values (
        ${paymentRequest.id},${index + 1},${item.name},${item.amountKrw},
        ${item.serviceStartDate},${item.serviceEndDate},${item.durationValue},
        ${item.durationUnit},${item.includedMinutes},${item.vatTreatment},
        ${item.paymentDueDate}
      )
    `;
  }
  return {
    id: paymentRequest.id as string,
    publicToken: paymentRequest.publicToken as string,
    expiresAt: paymentRequest.expiresAt as Date,
    items,
  };
}

export async function isEnterpriseManagedUser(db: EnterpriseDb, appUserId: string) {
  const rows = await db`
    select exists (
      select 1 from shorts_mvp.managed_login_accounts managed
      where managed.app_user_id=${appUserId}
        and managed.account_type='enterprise'
        and managed.is_active=true
    ) as enabled
  `;
  return Boolean(rows[0]?.enabled);
}
