import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/lib/db";
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

export default async function EnterprisePaymentPage({ params }: PageProps) {
  const parsed = z.string().uuid().safeParse((await params).token);
  if (!parsed.success) notFound();
  const token = parsed.data;
  const db = getDb();
  const requestRows = await db`
    select id,customer_name,customer_email,title,status,expires_at,paid_at,created_at
    from shorts_mvp.enterprise_payment_requests
    where public_token=${token}
    limit 1
  `;
  const paymentRequest = requestRows[0];
  if (!paymentRequest) notFound();
  const itemRows = await db`
    select
      item.id,item.name,item.amount_krw,item.status,item.paid_at,
      attempt.receipt_url
    from shorts_mvp.enterprise_payment_items item
    left join shorts_mvp.enterprise_payment_attempts attempt
      on attempt.id=item.paid_attempt_id
    where item.payment_request_id=${paymentRequest.id}
    order by item.sort_order
  `;
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
