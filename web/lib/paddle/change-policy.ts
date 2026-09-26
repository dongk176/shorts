import { paddlePlan, paddleAmount, type PaddleCurrency } from './catalog';
import { paddleMonthlyPeriods } from './periods';

export function changeTiming(from: string, to: string) {
  const old = paddlePlan(from), next = paddlePlan(to);
  // Term changes preserve the full paid term, including when the tier changes.
  return old.billingMonths === next.billingMonths && next.minutes > old.minutes
    ? 'immediate' as const : 'renewal' as const;
}
export function changePayload(from: string, to: string, priceId: string) {
  const timing = changeTiming(from, to);
  return {
    items: [{ price_id: priceId, quantity: 1 }],
    proration_billing_mode: timing === 'immediate' ? 'prorated_immediately' : 'do_not_bill',
    on_payment_failure: 'prevent_change',
  };
}
export function upgradeAllowances(from: string, to: string, start: Date, end: Date, effective: Date) {
  if (changeTiming(from, to) !== 'immediate' || effective < start || effective >= end)
    throw new Error('Invalid upgrade period');
  const delta = (paddlePlan(to).minutes - paddlePlan(from).minutes) * 60;
  return paddleMonthlyPeriods(start, end, paddlePlan(from).billingMonths)
    .filter(p => p.end > effective).map(p => {
      const begin = new Date(Math.max(+p.start, +effective));
      return { start: begin, end: p.end, seconds: Math.floor(delta * (+p.end - +begin) / (+p.end - +p.start)) };
    }).filter(p => p.seconds > 0);
}
export function formatChangeAmount(amount: number, currency: PaddleCurrency, locale: string) {
  return new Intl.NumberFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {style:'currency',currency})
    .format(amount / (currency === 'JPY' ? 1 : 100));
}
export function assertUpgradeAmount(amount: number, from: string, to: string, currency: PaddleCurrency) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > paddleAmount(to,currency)-paddleAmount(from,currency))
    throw new Error('Unexpected upgrade amount');
}
