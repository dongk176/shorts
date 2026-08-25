import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { enterpriseVatLabel } from "@/lib/enterprise-contract";
import { requireMvpSession } from "@/lib/session";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import {
  EnterpriseBillingPaymentClient,
  type EnterpriseBillingPaymentPageData,
} from "./billing-payment-client";
import {
  EnterprisePaymentClient,
  type EnterprisePaymentPageData,
} from "./payment-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "기업 결제 요청 | EasyCut",
  robots: { index: false, follow: false },
};

type PageProps = { params: Promise<{ token: string }> };

function iso(value: unknown) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(String(value)).toISOString();
}

function safeReceiptUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function dateOnly(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export default async function EnterprisePaymentPage({ params }: PageProps) {
  const parsed = z.string().uuid().safeParse((await params).token);
  if (!parsed.success) notFound();
  const token = parsed.data;
  const db = getDb();
  const requestRows = await db`
    select payment_request.id,payment_request.customer_name,
      payment_request.customer_email,payment_request.title,payment_request.status,
      payment_request.expires_at,payment_request.paid_at,payment_request.created_at,
      payment_request.payment_mode,managed.id as managed_account_id,
      managed.app_user_id
    from shorts_mvp.enterprise_payment_requests payment_request
    join shorts_mvp.managed_login_accounts managed
      on managed.id=payment_request.managed_account_id
    where payment_request.public_token=${token}
    limit 1
  `;
  const paymentRequest = requestRows[0];
  if (!paymentRequest) notFound();
  if (paymentRequest.paymentMode === "billing") {
    const user = await getAuthenticatedUser();
    if (!user) {
      redirect(`/auth/sign-in?next=${encodeURIComponent(`/enterprise-pay/${token}`)}`);
    }
    const session = await requireMvpSession(user, { createIfMissing: false });
    if (session.userId !== paymentRequest.appUserId) notFound();
  }
  const itemRowsPromise = db`
    select
      item.id,item.sort_order,item.name,item.amount_krw,item.status,item.paid_at,
      item.service_start_date,item.service_end_date,item.included_minutes,
      item.vat_treatment,item.payment_due_date,
      attempt.receipt_url
    from shorts_mvp.enterprise_payment_items item
    left join shorts_mvp.enterprise_payment_attempts attempt
      on attempt.id=item.paid_attempt_id
    where item.payment_request_id=${paymentRequest.id}
    order by item.sort_order
  `;
  if (paymentRequest.paymentMode === "billing") {
    const billingRowsPromise = db`
      select profile.status,method.card_number_masked,
        exists (
          select 1 from shorts_mvp.enterprise_payment_consents consent
          where consent.payment_request_id=${paymentRequest.id}
            and consent.app_user_id=${paymentRequest.appUserId}
        ) as consented
      from shorts_mvp.enterprise_billing_profiles profile
      left join shorts_mvp.billing_payment_methods method
        on method.id=profile.payment_method_id and method.status='active'
      where profile.managed_account_id=${paymentRequest.managedAccountId}
        and profile.app_user_id=${paymentRequest.appUserId}
      limit 1
    `;
    const [itemRows, billingRows] = await Promise.all([
      itemRowsPromise,
      billingRowsPromise,
    ]);
    const profile = billingRows[0];
    const billingData: EnterpriseBillingPaymentPageData = {
      token,
      customerName: paymentRequest.customerName,
      title: paymentRequest.title,
      status: paymentRequest.status,
      expiresAt: iso(paymentRequest.expiresAt),
      consented: Boolean(profile?.consented),
      hasRegisteredCard: profile?.status === "active",
      cardNumberMasked: profile?.cardNumberMasked || null,
      items: itemRows.map((item) => ({
        id: item.id,
        sortOrder: Number(item.sortOrder),
        name: item.name,
        amountKrw: Number(item.amountKrw),
        status: item.status,
        paidAt: item.paidAt ? iso(item.paidAt) : null,
        receiptUrl: safeReceiptUrl(item.receiptUrl),
        serviceStartDate: dateOnly(item.serviceStartDate),
        serviceEndDate: dateOnly(item.serviceEndDate),
        includedMinutes: Number(item.includedMinutes),
        vatLabel: enterpriseVatLabel(item.vatTreatment),
        paymentDueDate: dateOnly(item.paymentDueDate),
      })),
    };
    return <EnterpriseBillingPaymentClient data={billingData} />;
  }
  const itemRows = await itemRowsPromise;
  const expired = new Date(paymentRequest.expiresAt).getTime() <= Date.now()
    && paymentRequest.status !== "paid"
    && paymentRequest.status !== "canceled";
  const data: EnterprisePaymentPageData = {
    token,
    customerName: paymentRequest.customerName,
    customerEmail: paymentRequest.customerEmail || null,
    title: paymentRequest.title,
    status: expired ? "expired" : paymentRequest.status,
    expiresAt: iso(paymentRequest.expiresAt),
    createdAt: iso(paymentRequest.createdAt),
    items: itemRows.map((item) => ({
      id: item.id,
      name: item.name,
      amountKrw: Number(item.amountKrw),
      status: item.status,
      paidAt: item.paidAt ? iso(item.paidAt) : null,
      receiptUrl: safeReceiptUrl(item.receiptUrl),
    })),
  };
  return <EnterprisePaymentClient data={data} />;
}
