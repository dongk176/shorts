import { getDb } from "@/lib/db";
import { MANAGED_ACCOUNT_PRODUCT_CODE } from "@/lib/managed-login";
import {
  AdminManagedAccountsDashboard,
  type AdminManagedAccount,
} from "./admin-managed-accounts-dashboard";

function iso(value: unknown) {
  return value instanceof Date
    ? value.toISOString()
    : value ? new Date(String(value)).toISOString() : null;
}

export async function AdminManagedAccountsSection() {
  const rows = await getDb()`
    select
      managed.id,managed.login_id,managed.is_active,
      managed.account_type,managed.popular_filter_enabled,
      managed.created_at,managed.updated_at,
      managed.last_login_at,managed.last_password_reset_at,
      account.id as user_id,account.display_name,account.manual_service_access_until,
      coalesce(usage.total_seconds,0)::bigint as usage_total_seconds,
      coalesce(usage.consumed_seconds,0)::bigint as usage_consumed_seconds,
      coalesce(usage.reserved_seconds,0)::bigint as usage_reserved_seconds,
      coalesce(projects.project_count,0)::integer as project_count,
      coalesce(shorts.short_count,0)::integer as short_count
    from shorts_mvp.managed_login_accounts managed
    join shorts_mvp.app_users account on account.id=managed.app_user_id
    left join lateral (
      select
        coalesce(sum(grant_row.total_seconds),0)::bigint as total_seconds,
        coalesce(sum(grant_row.consumed_seconds),0)::bigint as consumed_seconds,
        coalesce(sum(grant_row.reserved_seconds),0)::bigint as reserved_seconds
      from shorts_mvp.usage_grants grant_row
      where grant_row.user_id=account.id
        and grant_row.product_code=${MANAGED_ACCOUNT_PRODUCT_CODE}
        and grant_row.status='active'
        and grant_row.valid_from<=clock_timestamp()
        and grant_row.expires_at>clock_timestamp()
    ) usage on true
    left join lateral (
      select count(*)::integer as project_count
      from shorts_mvp.video_jobs project
      where project.user_id=account.id
    ) projects on true
    left join lateral (
      select count(*)::integer as short_count
      from shorts_mvp.generated_shorts generated_short
      where generated_short.user_id=account.id
    ) shorts on true
    order by managed.created_at desc
  `;
  const accounts: AdminManagedAccount[] = rows.map((row) => {
    const total = Number(row.usageTotalSeconds || 0);
    const consumed = Number(row.usageConsumedSeconds || 0);
    const reserved = Number(row.usageReservedSeconds || 0);
    return {
      id: row.id,
      userId: row.userId,
      loginId: row.loginId,
      accountType: row.accountType === "enterprise" ? "enterprise" : "personal",
      displayName: row.displayName || "",
      isActive: Boolean(row.isActive),
      popularFilterEnabled: Boolean(row.popularFilterEnabled),
      serviceAccessUntil: iso(row.manualServiceAccessUntil),
      usageTotalSeconds: total,
      usageConsumedSeconds: consumed,
      usageReservedSeconds: reserved,
      usageRemainingSeconds: Math.max(0, total - consumed - reserved),
      projectCount: Number(row.projectCount || 0),
      shortCount: Number(row.shortCount || 0),
      createdAt: iso(row.createdAt)!,
      updatedAt: iso(row.updatedAt)!,
      lastLoginAt: iso(row.lastLoginAt),
      lastPasswordResetAt: iso(row.lastPasswordResetAt),
    };
  });
  return <AdminManagedAccountsDashboard accounts={accounts} />;
}
