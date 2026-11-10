import { kstDate, shiftTrendDate } from "./admin-trends";

export type BillingCurrency = "KRW" | "USD" | "JPY";
export type BillingCalendarDay = { day: string; gross: number; refunded: number; count: number };
export type BillingCalendarData = { month: string; currency: BillingCurrency; days: BillingCalendarDay[] };

export function shiftBillingMonth(month: string, offset: number) {
  const [year, value] = month.split("-").map(Number);
  return new Date(Date.UTC(year, value - 1 + offset, 1)).toISOString().slice(0, 7);
}

export function billingRange(month: string, day?: string) {
  return {
    start: `${day || `${month}-01`}T00:00:00+09:00`,
    end: `${day ? shiftTrendDate(day, 1) : `${shiftBillingMonth(month, 1)}-01`}T00:00:00+09:00`,
  };
}

export function billingCalendarCells(month: string) {
  const first = `${month}-01`;
  const weekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  const count = new Date(`${shiftBillingMonth(month, 1)}-01T00:00:00Z`).getTime()
    - new Date(`${first}T00:00:00Z`).getTime();
  const length = Math.ceil((weekday + count / 86_400_000) / 7) * 7;
  return Array.from({ length }, (_, index) => shiftTrendDate(first, index - weekday));
}

export function currentBillingMonth() { return kstDate().slice(0, 7); }
