import type { AdminTrendData } from "@/lib/admin-trends";

export const overseasPath = "/admin/easycutcutcutcutcutcut/overseas";
export const overseasTabs = ["overview", "billing", "members", "projects"] as const;
export type OverseasTab = typeof overseasTabs[number];
export const overseasPageSize = 30;

export function overseasFilters(params: Record<string, string | string[] | undefined>) {
  const first = (key: string) => { const value = params[key]; return Array.isArray(value) ? value[0] || "" : value || ""; };
  const page = Number(first("page"));
  return {
    tab: overseasTabs.includes(first("tab") as OverseasTab) ? first("tab") as OverseasTab : "overview" as OverseasTab,
    query: first("q").trim().slice(0, 100),
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 10_000) : 1,
  };
}
export type OverseasFilters = ReturnType<typeof overseasFilters>;
export type OverseasRow = {
  id: string; email: string; name: string | null; label: string; status: string;
  createdAt: string; currency: string | null; amount: number | null; refunded?: number; chargeback?: number; pending?: number;
};
export type OverseasData = {
  filters: OverseasFilters; total: number; pages: number; rows: OverseasRow[];
  metrics: { members: number; todayMembers: number; activeSubscriptions: number; pastDueSubscriptions: number; inactiveSubscriptions: number; projects: number; recentProjects: number };
  sales: Array<{ currency: "USD" | "JPY"; gross: number; refunded: number; chargeback: number; pending: number; today: number; todayDeductions: number; orders: number }>;
  memberTrend: AdminTrendData;
  salesTrends: Record<"USD" | "JPY", AdminTrendData>;
};
