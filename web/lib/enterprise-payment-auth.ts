import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export async function requireEnterprisePaymentOwner(token: string) {
  const session = await requireAuthenticatedMvpSession({
    allowPaymentMethodRemediation: true,
  });
  const db = getDb();
  const rows = await db`
    select payment_request.id as request_id,
      payment_request.managed_account_id,payment_request.status,
      payment_request.expires_at,managed.app_user_id,
      managed.account_type,managed.is_active
    from shorts_mvp.enterprise_payment_requests payment_request
    join shorts_mvp.managed_login_accounts managed
      on managed.id=payment_request.managed_account_id
    where payment_request.public_token=${token}
      and payment_request.payment_mode='billing'
      and managed.app_user_id=${session.userId}
    limit 1
  `;
  const paymentRequest = rows[0];
  if (
    !paymentRequest
    || paymentRequest.accountType !== "enterprise"
    || paymentRequest.isActive !== true
  ) {
    throw new HttpError(404, "결제 요청을 찾을 수 없습니다.");
  }
  return { session, paymentRequest };
}
