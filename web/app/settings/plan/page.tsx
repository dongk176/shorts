import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getBillingSummary } from "@/lib/billing";
import {
  resolveBillingCustomerCohort,
  shouldUseTossBillingExperience,
} from "@/lib/billing-cohort";
import { getDb } from "@/lib/db";
import { requireMvpSession } from "@/lib/session";
import { authProfile } from "@/lib/session";
import { createNoIndexMetadata } from "@/lib/seo";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { getTossBillingState } from "@/lib/toss-billing-state";
import { EnterprisePlanManagement } from "./enterprise-plan-management";
import type { EnterpriseManagedProduct } from "./enterprise-plan-management-model";
import { PlanManagementClient } from "./plan-management-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = createNoIndexMetadata("요금제 관리", "이지컷 구독 및 요금제 관리");

function dateOnly(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function iso(value: unknown) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function seoulToday() {
  const parts = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Seoul",
  }).formatToParts(new Date());
  const value = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

async function getEnterpriseManagedProducts(
  db: ReturnType<typeof getDb>,
  userId: string,
): Promise<EnterpriseManagedProduct[]> {
  const rows = await db`
    select item.id,item.sort_order,item.name,item.amount_krw,item.status,
      item.paid_at,item.service_start_date,item.service_end_date,
      item.included_minutes,item.vat_treatment,item.payment_due_date,
      payment_request.id as payment_request_id,
      payment_request.title as payment_request_title,
      payment_request.public_token as payment_request_token,
      payment_request.status as payment_request_status,
      (entitlement.id is not null) as entitlement_granted,
      (payment_request.expires_at<=clock_timestamp()
        and payment_request.status not in ('paid','canceled')) as payment_request_expired
    from shorts_mvp.enterprise_payment_items item
    join shorts_mvp.enterprise_payment_requests payment_request
      on payment_request.id=item.payment_request_id
    join shorts_mvp.managed_login_accounts managed
      on managed.id=payment_request.managed_account_id
    left join shorts_mvp.enterprise_service_entitlements entitlement
      on entitlement.payment_item_id=item.id
    where managed.app_user_id=${userId}
      and managed.account_type='enterprise'
      and managed.is_active=true
      and payment_request.payment_mode='billing'
      and payment_request.status<>'canceled'
      and item.service_start_date is not null
    order by item.service_start_date,item.sort_order,payment_request.created_at
  `;
  return rows.map((row) => ({
    id: row.id as string,
    paymentRequestId: row.paymentRequestId as string,
    paymentRequestTitle: row.paymentRequestTitle as string,
    paymentRequestToken: row.paymentRequestToken as string,
    paymentRequestStatus: row.paymentRequestStatus as string,
    paymentRequestExpired: Boolean(row.paymentRequestExpired),
    sortOrder: Number(row.sortOrder),
    name: row.name as string,
    amountKrw: Number(row.amountKrw),
    paymentStatus: row.status as string,
    paidAt: iso(row.paidAt),
    entitlementGranted: Boolean(row.entitlementGranted),
    serviceStartDate: dateOnly(row.serviceStartDate),
    serviceEndDate: dateOnly(row.serviceEndDate),
    includedMinutes: Number(row.includedMinutes),
    vatTreatment: row.vatTreatment === "not_applicable" ? "not_applicable" : "included",
    paymentDueDate: dateOnly(row.paymentDueDate),
  }));
}

export default async function PlanManagementPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/auth/sign-in?next=/settings/plan");
  const session = await requireMvpSession(user, { createIfMissing: false });
  if (!session.userId) redirect("/settings");
  const db = getDb();
  if (session.isEnterprise === true) {
    return (
      <EnterprisePlanManagement
        user={authProfile(user)}
        products={await getEnterpriseManagedProducts(db, session.userId)}
        today={seoulToday()}
      />
    );
  }
  const cohort = await resolveBillingCustomerCohort(session.userId, db);
  if (shouldUseTossBillingExperience(cohort)) {
    const state = await getTossBillingState({
      userId: session.userId,
      session: session as typeof session & { userId: string },
      db,
    });
    return <PlanManagementClient user={authProfile(user)} provider="toss" initialTossState={state} initialLegacyState={null} />;
  }
  return (
    <PlanManagementClient
      user={authProfile(user)}
      provider="thepayone"
      initialTossState={null}
      initialLegacyState={await getBillingSummary(db, session.userId)}
    />
  );
}
