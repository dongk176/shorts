import type { SiteLocale } from "./i18n/config";
import { formatPaddlePrice, paddlePlan, paddlePackageTerms, newPaddlePlanCode } from "./paddle/catalog";
import { tossPlan } from "./toss-subscription";

export function comparisonPricing(locale: SiteLocale, internationalEnabled: boolean) {
  if (locale !== "ko" && !internationalEnabled) return [];
  return (["pro", "starter", "expert"] as const).map((tier) => {
    const title = tier === "pro" ? "이지컷 프로" : tier === "starter" ? "스타터 패키지" : "전문가 패키지";
    if (locale === "ko") {
      const plan = tossPlan(tier === "pro" ? "toss_easycut_pro_1m" : `toss_${tier}_1m`);
      const priceLines = tier === "pro" ? [`월 ${plan.priceKrw.toLocaleString("ko-KR")}원 · 매월 자동결제`] : paddlePackageTerms.map(months => {
        const pack = tossPlan(`toss_${tier}_${months}m`);
        return `${months}개월 총 ${pack.priceKrw.toLocaleString("ko-KR")}원 (월 환산 ${pack.monthlyEquivalentKrw.toLocaleString("ko-KR")}원)`;
      });
      return { title, allowance: `매월 ${plan.monthlyQuotaSeconds / 60}분`, priceLines };
    }
    const currency = locale === "ja" ? "JPY" : "USD";
    const code = tier === "pro" ? "paddle_lite" : tier === "starter" ? "paddle_creator" : "paddle_pro";
    const plan = paddlePlan(code);
    const priceLines = tier === "pro"
      ? [locale === "ja" ? `月額 ${formatPaddlePrice(newPaddlePlanCode(code, currency), currency)}・毎月のお支払い` : `${formatPaddlePrice(newPaddlePlanCode(code, currency), currency)}/month, billed monthly`]
      : paddlePackageTerms.map(months => {
        const packCode = newPaddlePlanCode(`${code}_${months}m`, currency);
        const total = formatPaddlePrice(packCode, currency);
        const monthly = formatPaddlePrice(packCode, currency, true);
        return locale === "ja" ? `${months}か月合計 ${total}（月額換算 ${monthly}）` : `${total} for ${months} months (${monthly}/month equivalent)`;
      });
    return { title, allowance: locale === "ja" ? `毎月${plan.minutes}分` : `${plan.minutes} minutes/month`, priceLines };
  });
}
