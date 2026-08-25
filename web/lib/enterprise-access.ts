import type { Sql, TransactionSql } from "postgres";
import { HttpError } from "@/lib/http";

type EnterpriseDb = Sql | TransactionSql;

export type EnterpriseAccessState =
  | { accountType: "personal"; allowed: true }
  | {
      accountType: "enterprise";
      allowed: boolean;
      reason: "available" | "payment_required" | "not_started" | "outside_period";
      paymentPath: string | null;
      requestStatus: string | null;
      firstStartsAt: string | null;
      lastEndsAt: string | null;
    };

function iso(value: unknown) {
  return value instanceof Date
    ? value.toISOString()
    : value ? new Date(String(value)).toISOString() : null;
}

export async function getEnterpriseAccessState(
  db: EnterpriseDb,
  appUserId: string,
): Promise<EnterpriseAccessState> {
  const rows = await db`
    select managed.id,managed.account_type,
      blocking.public_token,blocking.status as request_status,
      period.first_starts_at,period.last_ends_at,
      coalesce(period.has_active,false) as has_active
    from shorts_mvp.managed_login_accounts managed
    left join lateral (
      select payment_request.id,payment_request.public_token,payment_request.status
      from shorts_mvp.enterprise_payment_requests payment_request
      where payment_request.managed_account_id=managed.id
        and payment_request.payment_mode='billing'
        and payment_request.blocks_service_access=true
        and payment_request.status<>'canceled'
      order by
        case when payment_request.status in ('open','partial') then 0 else 1 end,
        payment_request.created_at desc
      limit 1
    ) blocking on true
    left join lateral (
      select min(entitlement.starts_at) as first_starts_at,
        max(entitlement.ends_at) as last_ends_at,
        bool_or(
          entitlement.starts_at<=clock_timestamp()
          and entitlement.ends_at>clock_timestamp()
        ) as has_active
      from shorts_mvp.enterprise_service_entitlements entitlement
      where entitlement.managed_account_id=managed.id
    ) period on true
    where managed.app_user_id=${appUserId} and managed.is_active=true
    limit 1
  `;
  const row = rows[0];
  if (!row || row.accountType !== "enterprise") {
    return { accountType: "personal", allowed: true };
  }
  const paymentPath = row.publicToken
    ? `/enterprise-pay/${encodeURIComponent(row.publicToken)}`
    : null;
  if (!row.requestStatus) {
    const firstStartsAt = iso(row.firstStartsAt);
    const lastEndsAt = iso(row.lastEndsAt);
    return {
      accountType: "enterprise",
      allowed: Boolean(row.hasActive),
      reason: row.hasActive
        ? "available"
        : firstStartsAt && new Date(firstStartsAt).getTime() > Date.now()
          ? "not_started"
          : firstStartsAt
            ? "outside_period"
            : "payment_required",
      paymentPath,
      requestStatus: null,
      firstStartsAt,
      lastEndsAt,
    };
  }
  const firstStartsAt = iso(row.firstStartsAt);
  const lastEndsAt = iso(row.lastEndsAt);
  if (row.requestStatus !== "paid") {
    return {
      accountType: "enterprise",
      allowed: false,
      reason: "payment_required",
      paymentPath,
      requestStatus: row.requestStatus,
      firstStartsAt,
      lastEndsAt,
    };
  }
  if (row.hasActive) {
    return {
      accountType: "enterprise",
      allowed: true,
      reason: "available",
      paymentPath,
      requestStatus: row.requestStatus,
      firstStartsAt,
      lastEndsAt,
    };
  }
  return {
    accountType: "enterprise",
    allowed: false,
    reason: firstStartsAt && new Date(firstStartsAt).getTime() > Date.now()
      ? "not_started"
      : "outside_period",
    paymentPath,
    requestStatus: row.requestStatus,
    firstStartsAt,
    lastEndsAt,
  };
}

export async function assertEnterpriseServiceAccess(db: EnterpriseDb, appUserId: string) {
  const state = await getEnterpriseAccessState(db, appUserId);
  if (state.accountType === "personal" || state.allowed) return state;
  const message = state.reason === "payment_required"
    ? "기업 서비스 이용을 위해 결제를 완료해 주세요."
    : state.reason === "not_started"
      ? "기업 서비스 이용 시작일 전입니다."
      : "현재 이용 가능한 기업 서비스 기간이 아닙니다.";
  throw new HttpError(402, message, `ENTERPRISE_${state.reason.toUpperCase()}`);
}

export async function assertEnterpriseSessionServiceAccess(
  db: EnterpriseDb,
  session: { userId: string; isEnterprise?: boolean },
) {
  if (session.isEnterprise !== true) {
    return { accountType: "personal", allowed: true } as const;
  }
  return assertEnterpriseServiceAccess(db, session.userId);
}
