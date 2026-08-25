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
  const db = getDb();
  const rows = await db`
    select
      managed.id,managed.login_id,managed.is_active,
      managed.account_type,managed.max_active_jobs,
      managed.created_at,managed.updated_at,
      managed.last_login_at,managed.last_password_reset_at,
      account.id as user_id,account.display_name,
      coalesce(account.manual_service_access_until,enterprise_period.last_ends_at)
        as manual_service_access_until,
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
        and (
          grant_row.product_code=${MANAGED_ACCOUNT_PRODUCT_CODE}
          or (
            managed.account_type='enterprise'
            and grant_row.product_code like 'enterprise_contract:%'
          )
        )
        and grant_row.status='active'
        and grant_row.valid_from<=clock_timestamp()
        and grant_row.expires_at>clock_timestamp()
    ) usage on true
    left join lateral (
      select max(entitlement.ends_at) as last_ends_at
      from shorts_mvp.enterprise_service_entitlements entitlement
      where entitlement.managed_account_id=managed.id
    ) enterprise_period on true
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
  const paymentRows = await db`
    select
      payment_request.id,payment_request.managed_account_id,
      payment_request.public_token,payment_request.customer_name,
      payment_request.customer_email,payment_request.title,
      payment_request.status,payment_request.payment_mode,
      payment_request.blocks_service_access,
      payment_request.expires_at,payment_request.created_at,
      item.id as item_id,item.sort_order,item.name as item_name,item.amount_krw,
      item.service_start_date,item.service_end_date,item.included_minutes,
      item.vat_treatment,item.payment_due_date,
      item.status as item_status,item.paid_at as item_paid_at
    from shorts_mvp.enterprise_payment_requests payment_request
    join shorts_mvp.enterprise_payment_items item
      on item.payment_request_id=payment_request.id
    order by payment_request.created_at desc,item.sort_order
  `;
  const paymentRequestsByAccount = new Map<string, AdminManagedAccount["paymentRequests"]>();
  for (const row of paymentRows) {
    const accountRequests = paymentRequestsByAccount.get(row.managedAccountId) || [];
    let paymentRequest = accountRequests.find((candidate) => candidate.id === row.id);
    if (!paymentRequest) {
      paymentRequest = {
        id: row.id,
        paymentPath: `/enterprise-pay/${encodeURIComponent(row.publicToken)}`,
        customerName: row.customerName,
        customerEmail: row.customerEmail || null,
        title: row.title,
        status: row.status,
        paymentMode: row.paymentMode,
        blocksServiceAccess: Boolean(row.blocksServiceAccess),
        expiresAt: iso(row.expiresAt)!,
        createdAt: iso(row.createdAt)!,
        items: [],
      };
      accountRequests.push(paymentRequest);
      paymentRequestsByAccount.set(row.managedAccountId, accountRequests);
    }
    paymentRequest.items.push({
      id: row.itemId,
      name: row.itemName,
      sortOrder: Number(row.sortOrder),
      amountKrw: Number(row.amountKrw),
      status: row.itemStatus,
      paidAt: iso(row.itemPaidAt),
      serviceStartDate: row.serviceStartDate ? String(row.serviceStartDate).slice(0, 10) : null,
      serviceEndDate: row.serviceEndDate ? String(row.serviceEndDate).slice(0, 10) : null,
      includedMinutes: row.includedMinutes === null ? null : Number(row.includedMinutes),
      vatTreatment: row.vatTreatment || null,
      paymentDueDate: row.paymentDueDate ? String(row.paymentDueDate).slice(0, 10) : null,
    });
  }
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
      maxActiveJobs: Number(row.maxActiveJobs),
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
      paymentRequests: paymentRequestsByAccount.get(row.id) || [],
    };
  });
  return <AdminManagedAccountsDashboard accounts={accounts} />;
}
