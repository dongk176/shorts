import type { Sql, TransactionSql } from "postgres";
import {
  hasManagedFeatureAccess,
  type FeatureEntitlementBilling,
} from "@/lib/feature-entitlements";
import { HttpError } from "@/lib/http";

export const POPULAR_FILTER_PLAN_MESSAGE =
  "실시간 인기 필터는 활성 구독 또는 기간 패키지를 이용할 때 사용할 수 있습니다.";

export function billingSupportsPopularFilters(
  billing: FeatureEntitlementBilling,
  hasDirectAccess = false,
  managedOverride: boolean | null = null,
) {
  if (hasManagedFeatureAccess(billing)) return true;
  if (managedOverride !== null) return managedOverride;
  return hasDirectAccess || billing.activeProducts.length > 0;
}

export function assertPopularFilterAccess(
  billing: FeatureEntitlementBilling,
  hasDirectAccess = false,
  managedOverride: boolean | null = null,
) {
  if (!billingSupportsPopularFilters(billing, hasDirectAccess, managedOverride)) {
    throw new HttpError(402, POPULAR_FILTER_PLAN_MESSAGE, "POPULAR_FILTER_PLAN_REQUIRED");
  }
}

export async function managedPopularFilterOverride(
  db: Sql | TransactionSql,
  userId: string,
): Promise<boolean | null> {
  const rows = await db`
    select true as feature_access
    from shorts_mvp.managed_login_accounts managed
    where managed.app_user_id=${userId}
      and managed.is_active=true
    limit 1
  `;
  return rows[0] ? true : null;
}

export async function hasDirectPopularFilterAccess(
  db: Sql | TransactionSql,
  userId: string,
) {
  const rows = await db`
    select 1
    from shorts_mvp.app_users account
    where account.id=${userId}
      and (
        (
          account.manual_service_access_until > clock_timestamp()
          and not exists (
            select 1
            from shorts_mvp.managed_login_accounts managed
            where managed.app_user_id=account.id
          )
        )
        or exists (
          select 1
          from shorts_mvp.managed_login_accounts managed
          where managed.app_user_id=account.id
            and managed.is_active=true
        )
      )
    limit 1
  `;
  return Boolean(rows[0]);
}
