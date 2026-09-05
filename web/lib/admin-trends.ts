export const ADMIN_TREND_PERIODS = ["7d", "30d", "6m", "all"] as const;
export type AdminTrendPeriod = typeof ADMIN_TREND_PERIODS[number];
export type AdminTrendMetric = "sales" | "members";
export const ADMIN_TREND_LABELS: Record<AdminTrendPeriod, string> = {
  "7d": "최근 7일", "30d": "30일", "6m": "6개월", all: "전체",
};

export type AdminTrendPoint = { date: string; value: number; orderCount?: number };
export type AdminTrendData = {
  metric: AdminTrendMetric;
  period: AdminTrendPeriod;
  from: string;
  to: string;
  points: AdminTrendPoint[];
};

const DAY_MS = 86_400_000;

export function kstDate(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

export function shiftTrendDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function trendStartDate(period: AdminTrendPeriod, today: string, firstDate?: string): string {
  if (period === "all") return firstDate && firstDate < today ? firstDate : today;
  if (period !== "6m") return shiftTrendDate(today, period === "7d" ? -6 : -29);
  const date = new Date(`${today}T00:00:00Z`);
  const month = date.getUTCMonth() - 6;
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(date.getUTCFullYear(), month, Math.min(date.getUTCDate(), lastDay)))
    .toISOString().slice(0, 10);
}

export function buildAdminTrend(
  metric: AdminTrendMetric, period: AdminTrendPeriod, today: string, rows: AdminTrendPoint[],
): AdminTrendData {
  const byDate = new Map(rows.filter((row) => row.date <= today).map((row) => [row.date, row]));
  const first = [...byDate.keys()].sort()[0];
  const from = trendStartDate(period, today, first);
  const points: AdminTrendPoint[] = [];
  for (let date = from; date <= today; date = shiftTrendDate(date, 1)) {
    points.push(byDate.get(date) ?? { date, value: 0, ...(metric === "sales" ? { orderCount: 0 } : {}) });
  }
  return { metric, period, from, to: today, points };
}

export type TrendViewport = { start: number; count: number };

export function clampTrendViewport(view: TrendViewport, length: number): TrendViewport {
  const count = Math.min(length, Math.max(Math.min(2, length), Math.round(view.count)));
  return { start: Math.max(0, Math.min(length - count, Math.round(view.start))), count };
}

export function zoomTrendViewport(view: TrendViewport, length: number, factor: number): TrendViewport {
  const { count } = clampTrendViewport({ ...view, count: view.count * factor }, length);
  return clampTrendViewport({ start: view.start + (view.count - count) / 2, count }, length);
}

export function trendAxisLabel(date: string, includeYear: boolean): string {
  return (includeYear ? date : date.slice(5)).replaceAll("-", ".");
}

export function trendValueScale(visibleMaximum: number): { maximum: number; ticks: number[] } {
  const maximum = Math.max(1, visibleMaximum);
  const roughStep = Math.max(1, maximum / 4);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step = ([1, 2, 5, 10].find((factor) => factor * magnitude >= roughStep) ?? 10) * magnitude;
  const intervals = Math.ceil(maximum / step);
  return { maximum: intervals * step, ticks: Array.from({ length: intervals + 1 }, (_, index) => index * step) };
}

export function trendValueLabel(value: number, metric: AdminTrendMetric): string {
  const number = (amount: number) => amount.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
  if (value >= 100_000_000) return `${number(value / 100_000_000)}억${metric === "sales" ? "원" : "명"}`;
  if (value >= 10_000) return `${number(value / 10_000)}만${metric === "sales" ? "원" : "명"}`;
  return `${number(value)}${metric === "sales" ? "원" : "명"}`;
}

// Match the first/last aligned labels and reserve the last label before placing
// interior ticks. All widths and positions are actual CSS pixels.
export function trendTickIndices(widths: number[], plotWidth: number, gap = 14): number[] {
  if (!widths.length || plotWidth <= 0) return [];
  if (widths.length === 1) return [0];
  const last = widths.length - 1;
  if (widths[0] + widths[last] + gap > plotWidth) return [last];
  const selected = [0];
  let previousRight = widths[0];
  const lastLeft = plotWidth - widths[last];
  for (let index = 1; index < last; index += 1) {
    const center = index / last * plotWidth;
    const left = center - widths[index] / 2;
    const right = center + widths[index] / 2;
    if (left >= previousRight + gap && right + gap <= lastLeft) {
      selected.push(index);
      previousRight = right;
    }
  }
  selected.push(last);
  return selected;
}
