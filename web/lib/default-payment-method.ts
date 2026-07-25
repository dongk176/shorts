import type { Sql, TransactionSql } from "postgres";
import { HttpError } from "@/lib/http";

type BillingDb = Sql | TransactionSql;

export async function getDefaultPaymentMethodId(
  db: BillingDb,
  userId: string,
) {
  const rows = await db`
    select m.id
    from shorts_mvp.app_users u
    join shorts_mvp.billing_payment_methods m
      on m.id=u.default_payment_method_id
     and m.user_id=u.id
    where u.id=${userId}
      and m.provider='thepayone'
      and m.status not in ('disposed','manual_review','replaced','revoked')
    limit 1
  `;
  return typeof rows[0]?.id === "string" ? rows[0].id : null;
}

export async function setDefaultPaymentMethod(
  db: BillingDb,
  userId: string,
  paymentMethodId: string,
) {
  const rows = await db`
    update shorts_mvp.app_users u
    set default_payment_method_id=${paymentMethodId}
    where u.id=${userId}
      and exists (
        select 1
        from shorts_mvp.billing_payment_methods m
        where m.id=${paymentMethodId}
          and m.user_id=u.id
      )
    returning u.id
  `;
  if (!rows[0]) {
    throw new HttpError(
      409,
      "기본 결제수단을 저장하지 못했습니다.",
      "PAYMENT_METHOD_OWNERSHIP_MISMATCH",
    );
  }
}
