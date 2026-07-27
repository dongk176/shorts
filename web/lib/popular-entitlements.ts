import type { Sql, TransactionSql } from "postgres";
import type { BillingSummary } from "@/lib/contracts";
import { HttpError } from "@/lib/http";

export const POPULAR_FILTER_PLAN_MESSAGE =
  "실시간 인기 필터는 활성 구독 또는 기간 패키지를 이용할 때 사용할 수 있습니다.";

export function billingSupportsPopularFilters(
  billing: Pick<BillingSummary, "activeProducts">,
  hasDirectAccess = false,
) {
  return hasDirectAccess || billing.activeProducts.length > 0;
}

export function assertPopularFilterAccess(
  billing: Pick<BillingSummary, "activeProducts">,
  hasDirectAccess = false,
) {
  if (!billingSupportsPopularFilters(billing, hasDirectAccess)) {
    throw new HttpError(402, POPULAR_FILTER_PLAN_MESSAGE, "POPULAR_FILTER_PLAN_REQUIRED");
  }
}

export async function hasDirectPopularFilterAccess(
  db: Sql | TransactionSql,
  userId: string,
) {
  const rows = await db`
    select 1
    from shorts_mvp.app_users
    where id=${userId}
      and manual_service_access_until > clock_timestamp()
    limit 1
  `;
  return Boolean(rows[0]);
}
