import type { Sql } from "postgres";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { cancellationReasons } from "@/lib/subscription-cancellation";

export const cancellationReasonLabels = {
  price: "가격 부담", less_usage: "사용량 감소", quality: "영상 결과 불만족",
  missing_features: "필요한 기능 부재", technical: "오류·처리 속도",
  alternative: "다른 서비스 이용", other: "기타",
} as const;
export const cancellationPageSize = 30;
export function cancellationFilters(params: Record<string, string | string[] | undefined>) {
  const first = (key: string) => { const value = params[key]; return Array.isArray(value) ? value[0] || "" : value || ""; };
  const requestedPage = Number(first("page"));
  return {
    reason: cancellationReasons.includes(first("reason") as typeof cancellationReasons[number]) ? first("reason") : "all",
    days: ["7", "30", "90", "all"].includes(first("period")) ? first("period") : "30",
    query: first("q").trim().slice(0, 100),
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 1_000_000) : 1,
  };
}
export type CancellationFilters = ReturnType<typeof cancellationFilters>;
export type AdminCancellationFeedback = {
  id: string; email: string; displayName: string | null; planName: string;
  provider: string | null; billingCycle: string; reason: string;
  detail: string | null; message: string | null; alternativeService: string | null;
  alternativeUndecided: boolean; canceledAt: string; accessUntil: string;
};
export type AdminCancellationData = {
  filters: CancellationFilters; rows: AdminCancellationFeedback[];
  total: number; messages: number; alternatives: number; pages: number;
  reasons: Array<{ reason: string; count: number }>;
};
export async function loadAdminCancellationFeedback(params: Record<string, string | string[] | undefined>, db?: Sql): Promise<AdminCancellationData> {
  // Never query survey text until the caller's administrator permission is verified.
  await requireAdminUser();
  const sql = db ?? getDb();
  const filters = cancellationFilters(params);
  const days = filters.days === "all" ? 0 : Number(filters.days);
  const pattern = `%${filters.query.replace(/[\\%_]/g, "\\$&")}%`;
  const where = sql`
    (${filters.reason}='all' or f.reason=${filters.reason})
    and (${days}=0 or f.created_at >= now()-${days} * interval '1 day')
    and (${filters.query}='' or u.email ilike ${pattern} or u.display_name ilike ${pattern}
      or f.detail ilike ${pattern} or f.message ilike ${pattern} or f.alternative_service ilike ${pattern})
  `;
  const groups = await sql`
    select f.reason,count(*)::int as count,
      count(*) filter(where f.message is not null)::int as messages
    from shorts_mvp.subscription_cancellation_feedback f
    join shorts_mvp.app_users u on u.id=f.user_id
    where ${where} group by f.reason
  `;
  const total = groups.reduce((sum, row) => sum + Number(row.count), 0);
  const pages = Math.max(1, Math.ceil(total / cancellationPageSize));
  filters.page = Math.min(filters.page, pages);
  const rows = await sql`
    select f.id,u.email,u.display_name,coalesce(p.display_name,f.plan_code) as plan_name,
      f.payment_provider as provider,f.billing_cycle,f.reason,f.detail,f.message,
      f.alternative_service,f.alternative_undecided,f.canceled_at,f.access_until
    from shorts_mvp.subscription_cancellation_feedback f
    join shorts_mvp.app_users u on u.id=f.user_id
    left join shorts_mvp.plans p on p.code=f.plan_code
    where ${where} order by f.created_at desc,f.id desc
    limit ${cancellationPageSize} offset ${(filters.page-1)*cancellationPageSize}
  `;
  return {
    filters, total, pages,
    messages: groups.reduce((sum, row) => sum + Number(row.messages), 0),
    alternatives: Number(groups.find(row => row.reason === "alternative")?.count || 0),
    reasons: cancellationReasons.map(reason => ({reason,count:Number(groups.find(row => row.reason === reason)?.count || 0)})),
    rows: rows.map(row => ({...row,
      canceledAt: new Date(row.canceledAt).toISOString(), accessUntil: new Date(row.accessUntil).toISOString(),
    })) as AdminCancellationFeedback[],
  };
}
