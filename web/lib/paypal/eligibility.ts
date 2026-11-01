import "server-only";
import type { Sql, TransactionSql } from "postgres";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";

// Historical payments remain historical after expiry, cancellation or refund.
// A PayPal customer's own renewals do not switch them back to a legacy provider.
export async function hasLegacyPaymentHistory(userId: string, db: Sql | TransactionSql = getDb()) {
  const [row] = await db`
    select exists (
      select 1 from shorts_mvp.billing_orders
      where user_id=${userId} and provider in ('toss','thepayone','nicepay') and amount_krw>0
        and (status='succeeded' or approved_at is not null or provider_transaction_id is not null)
    ) or exists (
      select 1 from shorts_mvp.user_subscriptions
      where user_id=${userId} and payment_provider in ('toss','thepayone','nicepay','paddle')
        and (current_period_start is not null or payment_method_id is not null)
    ) or exists (
      select 1 from shorts_mvp.paddle_payments where user_id=${userId}
    ) as has_history
  `;
  if (!row || typeof row.hasHistory !== "boolean") throw Error("Billing history unavailable");
  return row.hasHistory;
}
export async function assertPayPalNewCustomer(userId: string, db: Sql | TransactionSql = getDb()) {
  if (await hasLegacyPaymentHistory(userId, db)) {
    throw new HttpError(409, "Continue using your existing payment provider.", "EXISTING_PAYMENT_HISTORY");
  }
}
