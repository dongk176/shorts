"use client";

import { useCallback, useEffect, useState } from "react";
import { formatLocale, type SiteLocale } from "@/lib/i18n/config";
import { formatKrw, formatSeoulDate } from "@/lib/i18n/format";
import { translateLegacyText } from "@/lib/i18n/legacy-phrases";
import { useI18n } from "@/lib/i18n/provider";

type ActivityResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: Array<Record<string, unknown>>;
  detail?: string;
};

type LocalizedLabel = Record<SiteLocale, string>;

function label(locale: SiteLocale, values: LocalizedLabel) {
  return values[locale];
}

function date(value: unknown, locale: SiteLocale) {
  if (!value) return "-";
  return formatSeoulDate(String(value), locale, { dateStyle: "medium", timeStyle: "short" });
}
function money(value: unknown, locale: SiteLocale) {
  const amount = Number(value || 0);
  return locale === "ko"
    ? `${amount.toLocaleString(formatLocale(locale))}원`
    : formatKrw(amount, locale);
}
function minutes(value: unknown, locale: SiteLocale) {
  const seconds = Number(value || 0);
  const sign = seconds < 0 ? "−" : "+";
  const amount = Math.ceil(Math.abs(seconds) / 60).toLocaleString(formatLocale(locale));
  return locale === "en" ? `${sign}${amount} min` : `${sign}${amount}분`;
}
const eventLabels: Record<string, LocalizedLabel> = {
  plan_grant: { ko: "플랜 시간 지급", en: "Plan time granted", ja: "プラン時間付与" },
  addon_grant: { ko: "추가시간 지급", en: "Additional time granted", ja: "追加時間付与" },
  feedback_reward: { ko: "피드백 보상", en: "Feedback reward", ja: "フィードバック特典" },
  update_event_bonus: { ko: "업데이트 이벤트 지급", en: "Update event bonus", ja: "アップデート特典" },
  welcome_grant: { ko: "로그인 무료 체험 지급", en: "Free trial granted", ja: "無料体験付与" },
  upgrade_grant: { ko: "업그레이드 새 플랜 지급", en: "New plan time granted", ja: "新プラン時間付与" },
  upgrade_carryover: { ko: "업그레이드 잔여시간 이월", en: "Remaining time carried over", ja: "残り時間を繰越" },
  annual_or_monthly_grant: { ko: "월별 플랜 지급", en: "Monthly plan time granted", ja: "月次プラン時間付与" },
  source_consumed: { ko: "작업 사용", en: "Job usage", ja: "処理利用" },
  reservation_released: { ko: "작업 시간 복구", en: "Job time restored", ja: "処理時間を復元" },
};
const productLabels: Record<string, LocalizedLabel> = {
  feedback_reward_30m: { ko: "원본 영상 처리시간 30분", en: "30 min of source-video processing", ja: "元動画処理時間30分" },
  editor_launch_bonus_20260728: { ko: "편집 기능 업데이트 월 사용량 100% 보너스", en: "Editor update · 100% monthly usage bonus", ja: "編集機能アップデート・月間利用量100%ボーナス" },
  onboarding_welcome_20min_v1: { ko: "무료 체험 원본 영상 처리시간 20분", en: "Free trial · 20 min of source-video processing", ja: "無料体験・元動画処理時間20分" },
};
const paymentStatusLabels: Record<string, LocalizedLabel> = {
  pending: { ko: "결제 대기", en: "Payment pending", ja: "決済待ち" },
  processing: { ko: "결제 처리 중", en: "Processing payment", ja: "決済処理中" },
  succeeded: { ko: "결제 완료", en: "Payment complete", ja: "決済完了" },
  failed: { ko: "결제 실패", en: "Payment failed", ja: "決済失敗" },
  unknown: { ko: "결과 확인 중", en: "Checking result", ja: "結果確認中" },
  manual_review: { ko: "확인 필요", en: "Review required", ja: "確認が必要" },
  canceled: { ko: "결제 취소", en: "Payment canceled", ja: "決済キャンセル" },
  expired: { ko: "요청 만료", en: "Request expired", ja: "リクエスト期限切れ" },
};

function billingCycleLabel(value: unknown, locale: SiteLocale) {
  if (value === "monthly") return label(locale, { ko: "월간 구독", en: "Monthly subscription", ja: "月額サブスクリプション" });
  if (value === "yearly") return label(locale, { ko: "기간 패키지", en: "Term package", ja: "期間パッケージ" });
  return label(locale, { ko: "단건 결제", en: "One-time purchase", ja: "単発購入" });
}

function refundLabel(item: Record<string, unknown>, locale: SiteLocale) {
  const completed = Number(item.refundedAmountKrw || 0);
  const scheduled = Number(item.scheduledRefundAmountKrw || 0);
  if (scheduled > 0) return label(locale, {
    ko: `환불 예정 ${money(scheduled, locale)}`,
    en: `Refund scheduled · ${money(scheduled, locale)}`,
    ja: `返金予定・${money(scheduled, locale)}`,
  });
  if (completed > 0) return label(locale, {
    ko: `환불 완료 ${money(completed, locale)}`,
    en: `Refund complete · ${money(completed, locale)}`,
    ja: `返金完了・${money(completed, locale)}`,
  });
  return label(locale, { ko: "환불 없음", en: "No refund", ja: "返金なし" });
}

function localizedProductName(value: unknown, locale: SiteLocale) {
  const source = String(value || "-");
  if (locale === "ko") return source;
  const translated = translateLegacyText(source, locale);
  if (translated !== source) return translated;
  const match = /^(Easy Cut )?(스타터|전문가) 패키지 (\d+)개월$/.exec(source);
  if (!match) return source;
  const tier = match[2] === "스타터"
    ? (locale === "en" ? "Starter" : "スターター")
    : (locale === "en" ? "Expert" : "エキスパート");
  return locale === "en"
    ? `Easy Cut ${tier} package · ${match[3]} months`
    : `Easy Cut ${tier}パッケージ・${match[3]}か月`;
}

function localizedResult(value: unknown, locale: SiteLocale) {
  const key = String(value || "-");
  const labels: Record<string, LocalizedLabel> = {
    granted: { ko: "지급 완료", en: "Granted", ja: "付与完了" },
    carried: { ko: "이월 완료", en: "Carried over", ja: "繰越完了" },
    completed: { ko: "완료", en: "Complete", ja: "完了" },
    failed: { ko: "실패", en: "Failed", ja: "失敗" },
    deleted: { ko: "삭제됨", en: "Deleted", ja: "削除済み" },
    expired: { ko: "만료됨", en: "Expired", ja: "期限切れ" },
    queued: { ko: "대기 중", en: "Queued", ja: "待機中" },
    retry_waiting: { ko: "재시도 대기", en: "Waiting to retry", ja: "再試行待ち" },
  };
  return labels[key] ? label(locale, labels[key]) : key;
}

export function AccountActivity() {
  const { locale } = useI18n();
  const copy = {
    payments: label(locale, { ko: "내 결제 내역", en: "Payment history", ja: "決済履歴" }),
    usage: label(locale, { ko: "내 사용 내역", en: "Usage history", ja: "利用履歴" }),
    loadError: label(locale, { ko: "내역을 불러오지 못했습니다.", en: "Could not load your activity.", ja: "履歴を読み込めませんでした。" }),
    empty: label(locale, { ko: "표시할 내역이 없습니다.", en: "No activity to display.", ja: "表示する履歴がありません。" }),
    previous: label(locale, { ko: "이전", en: "Previous", ja: "前へ" }),
    next: label(locale, { ko: "다음", en: "Next", ja: "次へ" }),
    receipt: label(locale, { ko: "결제확인서", en: "Receipt", ja: "決済確認書" }),
  };
  const [tab, setTab] = useState<"payments" | "usage">("payments");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ActivityResponse>({ page: 1, pageSize: 25, total: 0, items: [] });
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(`/api/account/activity?type=${tab}&page=${page}`, { cache: "no-store" });
    const result = await response.json() as ActivityResponse;
    if (!response.ok) setError(copy.loadError);
    else { setData(result); setError(""); }
  }, [copy.loadError, page, tab]);
  useEffect(() => { void load(); }, [load]);
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <section className="mt-8 overflow-hidden rounded-3xl border border-white/10 bg-[#171a1b]">
      <div className="flex gap-2 border-b border-white/10 p-4">
        <button type="button" onClick={() => { setTab("payments"); setPage(1); }} className={`rounded-xl px-5 py-2.5 text-sm font-black ${tab === "payments" ? "bg-white text-black" : "text-neutral-400"}`}>{copy.payments}</button>
        <button type="button" onClick={() => { setTab("usage"); setPage(1); }} className={`rounded-xl px-5 py-2.5 text-sm font-black ${tab === "usage" ? "bg-white text-black" : "text-neutral-400"}`}>{copy.usage}</button>
      </div>
      {error && <p className="bg-red-400/10 px-5 py-3 text-sm text-red-200">{error}</p>}
      <div className="overflow-x-auto">
        {tab === "payments" ? <table className="w-full min-w-[1260px] table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[170px]" />
            <col className="w-[220px]" />
            <col className="w-[120px]" />
            <col className="w-[165px]" />
            <col className="w-[285px]" />
            <col className="w-[190px]" />
            <col className="w-[110px]" />
          </colgroup>
          <thead className="bg-black/20 text-xs text-neutral-500"><tr><th className="whitespace-nowrap px-5 py-3">{label(locale, { ko: "결제일시", en: "Payment date", ja: "決済日時" })}</th><th className="whitespace-nowrap px-4 py-3">{label(locale, { ko: "상품", en: "Product", ja: "商品" })}</th><th className="whitespace-nowrap px-4 py-3">{label(locale, { ko: "금액 / 할부", en: "Amount / installments", ja: "金額 / 分割" })}</th><th className="whitespace-nowrap px-4 py-3">{label(locale, { ko: "상태 / 환불", en: "Status / refund", ja: "状態 / 返金" })}</th><th className="whitespace-nowrap px-4 py-3">{label(locale, { ko: "주문번호", en: "Order ID", ja: "注文番号" })}</th><th className="whitespace-nowrap px-4 py-3">{label(locale, { ko: "승인 / PG 거래", en: "Approval / PG transaction", ja: "承認 / PG取引" })}</th><th className="whitespace-nowrap px-5 py-3">{label(locale, { ko: "확인서", en: "Receipt", ja: "確認書" })}</th></tr></thead>
          <tbody className="divide-y divide-white/[.06]">{data.items.map((item) => <tr key={String(item.id)}>
            <td className="whitespace-nowrap px-5 py-4 text-neutral-400">{date(item.approvedAt || item.createdAt, locale)}</td>
            <td className="px-4 py-4"><p className="whitespace-nowrap font-bold">{localizedProductName(item.orderName || item.productCode, locale)}</p><p className="mt-1 whitespace-nowrap text-xs text-neutral-500">{billingCycleLabel(item.billingCycle, locale)}</p></td>
            <td className="whitespace-nowrap px-4 py-4"><p className="font-black">{money(item.amountKrw, locale)}</p><p className="mt-1 text-xs text-neutral-500">{Number(item.installmentMonths || 0) > 0 ? label(locale, { ko: `${Number(item.installmentMonths)}개월 할부`, en: `${Number(item.installmentMonths)}-month installments`, ja: `${Number(item.installmentMonths)}回払い` }) : label(locale, { ko: "일시불", en: "One-time payment", ja: "一括払い" })}</p></td>
            <td className="whitespace-nowrap px-4 py-4"><p className="font-bold">{paymentStatusLabels[String(item.status)] ? label(locale, paymentStatusLabels[String(item.status)]) : String(item.status)}</p><p className={`mt-1 text-xs ${Number(item.refundedAmountKrw || 0) > 0 || Number(item.scheduledRefundAmountKrw || 0) > 0 ? "text-[#ff9b8d]" : "text-neutral-600"}`}>{refundLabel(item, locale)}</p></td>
            <td className="whitespace-nowrap px-4 py-4 font-mono text-[11px] tracking-[-.02em]">{String(item.orderId)}</td>
            <td className="whitespace-nowrap px-4 py-4 font-mono text-xs"><p>{String(item.providerAuthCode || "-")}</p><p className="mt-1 text-neutral-600">{String(item.providerTransactionId || "-")}</p></td>
            <td className="whitespace-nowrap px-5 py-4">{item.status === "succeeded" ? <a target="_blank" rel="noreferrer" href={`/api/account/receipts/${String(item.id)}`} className="inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-lg border border-white/10 px-3 text-xs font-black transition hover:border-white/25 hover:bg-white/[.05]">{copy.receipt}</a> : <span className="text-neutral-600">-</span>}</td>
          </tr>)}</tbody>
        </table> : <table className="w-full min-w-[960px] table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[180px]" />
            <col className="w-[190px]" />
            <col className="w-[390px]" />
            <col className="w-[100px]" />
            <col className="w-[140px]" />
          </colgroup>
          <thead className="bg-black/20 text-xs text-neutral-500"><tr><th className="whitespace-nowrap px-5 py-3">{label(locale, { ko: "시각", en: "Time", ja: "日時" })}</th><th className="whitespace-nowrap px-4 py-3">{label(locale, { ko: "구분", en: "Type", ja: "区分" })}</th><th className="whitespace-nowrap px-4 py-3">{label(locale, { ko: "플랜 / 작업", en: "Plan / job", ja: "プラン / 処理" })}</th><th className="whitespace-nowrap px-4 py-3">{label(locale, { ko: "시간", en: "Time", ja: "時間" })}</th><th className="whitespace-nowrap px-5 py-3">{label(locale, { ko: "결과", en: "Result", ja: "結果" })}</th></tr></thead>
          <tbody className="divide-y divide-white/[.06]">{data.items.map((item) => <tr key={String(item.id)}>
            <td className="whitespace-nowrap px-5 py-4 text-neutral-400">{date(item.occurredAt, locale)}</td>
            <td className="whitespace-nowrap px-4 py-4 font-bold">{eventLabels[String(item.eventType)] ? label(locale, eventLabels[String(item.eventType)]) : String(item.eventType)}</td>
            <td className="px-4 py-4"><p>{item.projectNumber ? label(locale, { ko: `프로젝트 #${String(item.projectNumber)}`, en: `Project #${String(item.projectNumber)}`, ja: `プロジェクト #${String(item.projectNumber)}` }) : productLabels[String(item.productCode)] ? label(locale, productLabels[String(item.productCode)]) : String(item.productCode || "-")}</p>{Boolean(item.videoTitle) && <p data-i18n-skip className="mt-1 max-w-md truncate text-xs text-neutral-500">{String(item.videoTitle)}</p>}</td>
            <td className={`whitespace-nowrap px-4 py-4 font-black ${Number(item.seconds || 0) < 0 ? "text-[#ff9b8d]" : "text-emerald-300"}`}>{minutes(item.seconds, locale)}</td>
            <td className="whitespace-nowrap px-5 py-4 text-neutral-400">{localizedResult(item.result, locale)}</td>
          </tr>)}</tbody>
        </table>}
        {!data.items.length && <p className="px-5 py-16 text-center text-neutral-500">{copy.empty}</p>}
      </div>
      <div className="flex items-center justify-between border-t border-white/10 p-4 text-sm">
        <span className="text-neutral-500">{label(locale, { ko: `총 ${data.total.toLocaleString(formatLocale(locale))}건 · ${page}/${pages}페이지`, en: `${data.total.toLocaleString(formatLocale(locale))} total · Page ${page}/${pages}`, ja: `全${data.total.toLocaleString(formatLocale(locale))}件・${page}/${pages}ページ` })}</span>
        <div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-white/10 px-3 py-2 disabled:opacity-30">{copy.previous}</button><button type="button" disabled={page >= pages} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-white/10 px-3 py-2 disabled:opacity-30">{copy.next}</button></div>
      </div>
    </section>
  );
}
