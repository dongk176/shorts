"use client";
import Script from "next/script";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { paddlePlans, formatPaddlePrice } from "@/lib/paddle/catalog";
import { localizedHref } from "@/lib/i18n/routing";
import { useUsageState } from "@/components/usage-provider";
import type { SiteLocale } from "@/lib/i18n/config";

type Subscription = {
  providerStatus: string;
  planCode: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
};
type PaddleJs = {
  Environment: { set: (env: "sandbox") => void };
  Initialize: (options: {
    token: string;
    eventCallback: (event: { name: string }) => void;
  }) => void;
  Checkout: {
    open: (options: {
      transactionId: string;
      settings: {
        locale: string;
        displayMode: "overlay";
        allowLogout: boolean;
        allowDiscountRemoval: boolean;
        showAddDiscounts: boolean;
      };
    }) => void;
  };
};
declare global {
  interface Window {
    Paddle?: PaddleJs;
  }
}
const copy = {
  en: {
    title: "Make more from every video",
    subtitle:
      "Choose your monthly editing time. All plans include subtitles, vertical layouts and video exports.",
    month: "/ month",
    tax: "Tax included · Billed monthly",
    recommend: "Recommended",
    start: "Choose plan",
    manage: "Manage subscription",
    minutes: (n: number) => `${n} source-video minutes each month`,
    jobs: (n: number) => `${n} concurrent ${n === 1 ? "job" : "jobs"}`,
    retention: "Projects stored for 30 days",
    terms:
      "Renews automatically each month until canceled. Unused minutes expire at the end of each billing period. Cancel before your next renewal in Manage subscription.",
    confirm: "Payment received. Confirming your editing time…",
    ready: "Your editing time is ready.",
    waiting:
      "Payment confirmation is taking longer than usual. You can safely leave this page and check your plan later.",
    error: "We couldn’t open checkout. Please try again or contact support.",
    existing:
      "You already have a subscription. Manage it before starting another.",
    pending:
      "You have an unfinished checkout. Continue with the same plan or discard it to choose another.",
    processing: "Your payment is being processed. Please wait and check your payment status before choosing another plan.",
    discard: "Discard unfinished checkout",
    retry: "Check payment status",
    refund: "Refund policy",
    legal: "Terms",
    support: "Contact support",
    end: "Current period ends",
    scheduled: "Your subscription will end after this period.",
    pastDue:
      "Your renewal payment needs attention. Please update your payment method.",
    canceled: "This subscription has ended.",
    go: "Start editing",
    portalError:
      "Unable to open subscription management. Please contact support.",
  },
  ja: {
    title: "ひとつの動画から、もっと多くのショート動画を",
    subtitle:
      "毎月の動画処理時間に合わせて選べます。全プランに字幕、縦型レイアウト、動画の書き出しが含まれます。",
    month: "/ 月",
    tax: "税込・毎月のお支払い",
    recommend: "おすすめ",
    start: "このプランを選ぶ",
    manage: "契約を管理",
    minutes: (n: number) => `毎月${n}分の元動画を処理`,
    jobs: (n: number) => `同時に${n}件まで処理`,
    retention: "プロジェクトを30日間保存",
    terms:
      "解約するまで毎月自動更新されます。未使用の処理時間は翌月に繰り越されません。次回更新前に「契約を管理」から解約できます。",
    confirm: "お支払いを確認し、処理時間を反映しています…",
    ready: "処理時間が反映されました。",
    waiting:
      "お支払いの確認に時間がかかっています。このページを閉じても問題ありません。後ほど契約状況をご確認ください。",
    error:
      "決済画面を開けませんでした。再度お試しいただくか、サポートにお問い合わせください。",
    existing:
      "ご利用中の契約があります。新しい契約の前に現在の契約をご確認ください。",
    pending:
      "未完了の決済があります。同じプランで続行するか、未完了の決済を取り消してから別のプランを選んでください。",
    processing: "お支払いを処理中です。しばらく待って決済状況を確認してから、別のプランをお選びください。",
    discard: "未完了の決済を取り消す",
    retry: "お支払い状況を確認",
    refund: "返金ポリシー",
    legal: "利用規約",
    support: "お問い合わせ",
    end: "現在の利用期間の終了日",
    scheduled: "現在の利用期間が終了すると解約されます。",
    pastDue:
      "更新のお支払いを確認できませんでした。お支払い方法をご確認ください。",
    canceled: "この契約は終了しています。",
    go: "動画を作成する",
    portalError: "契約管理を開けませんでした。サポートにお問い合わせください。",
  },
};
export function PaddlePricing({
  locale,
  loggedIn,
  onRequireLogin,
  subscription: initial = null,
  resumeId = null,
  managementOnly = false,
  checkoutEnabled = true,
}: {
  locale: SiteLocale;
  loggedIn: boolean;
  onRequireLogin: () => void;
  subscription?: Subscription | null;
  resumeId?: string | null;
  managementOnly?: boolean;
  checkoutEnabled?: boolean;
}) {
  const language = locale === "ja" ? "ja" : "en";
  const { refreshUsage } = useUsageState();
  const t = copy[language];
  const currency = language === "ja" ? "JPY" : "USD";
  const [scriptReady, setScriptReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [subscription, setSubscription] = useState(initial);
  const [paid, setPaid] = useState(false);
  const initialized = useRef(false);
  const resumed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  async function status(attempt = 0) {
    try {
      const response = await fetch("/api/paddle/state", { cache: "no-store" });
      const body = await response.json();
      if (!mounted.current) return;
      if (
        response.ok &&
        body.subscription &&
        new Date(body.subscription.currentPeriodEnd) > new Date() &&
        ["active", "trialing"].includes(body.subscription.providerStatus)
      ) {
        setSubscription(body.subscription);
        await refreshUsage();
        if (!mounted.current) return;
        setMessage(t.ready);
        setPaid(true);
        return;
      }
    } catch {
      /* Retry only the read; never retry a charge. */
    }
    if (!mounted.current) return;
    if (attempt < 14)
      timer.current = setTimeout(() => void status(attempt + 1), 2000);
    else setMessage(t.waiting);
  }
  async function checkout(planCode?: string, transactionId?: string) {
    if (!loggedIn) {
      onRequireLogin();
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      if (!window.Paddle) throw Error("sdk");
      const response = await fetch("/api/paddle/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          transactionId ? { transactionId } : { planCode, locale: language },
        ),
      });
      const body = await response.json();
      if (!response.ok) {
        setPending(body.code === "CHECKOUT_PENDING");
        setMessage(
          body.code === "EXISTING_SUBSCRIPTION"
            ? t.existing
            : body.code === "CHECKOUT_PENDING"
              ? t.pending
              : body.code === "CHECKOUT_PROCESSING"
                ? t.processing
                : t.error,
        );
        return;
      }
      setPending(false);
      if (!initialized.current) {
        if (body.environment === "sandbox")
          window.Paddle.Environment.set("sandbox");
        window.Paddle.Initialize({
          token: body.token,
          eventCallback: (event) => {
            if (event.name === "checkout.completed") {
              setMessage(t.confirm);
              setBusy(false);
              void status();
            }
          },
        });
        initialized.current = true;
      }
      window.Paddle.Checkout.open({
        transactionId: body.transactionId,
        settings: {
          locale: language,
          displayMode: "overlay",
          allowLogout: false,
          allowDiscountRemoval: false,
          showAddDiscounts: false,
        },
      });
    } catch {
      setMessage(t.error);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (resumeId && scriptReady && loggedIn && !resumed.current) {
      resumed.current = true;
      void checkout(undefined, resumeId);
    }
  }, [resumeId, scriptReady, loggedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  async function portal() {
    setBusy(true);
    try {
      const r = await fetch("/api/paddle/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const b = await r.json();
      if (!r.ok) throw Error();
      window.location.assign(b.url);
    } catch {
      setMessage(t.portalError);
      setBusy(false);
    }
  }
  async function discard() {
    setBusy(true);
    try {
      const r = await fetch("/api/paddle/checkout", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!r.ok) throw Error();
      setPending(false);
      setMessage("");
    } catch {
      setMessage(t.error);
    } finally {
      setBusy(false);
    }
  }
  const current = subscription && subscription.providerStatus !== "canceled";
  return (
    <section className="mx-auto max-w-6xl px-5 py-12 md:py-20">
      <Script
        src="https://cdn.paddle.com/paddle/v2/paddle.js"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
        onError={() => setMessage(t.error)}
      />
      <h1 className="text-center text-3xl font-semibold tracking-tight md:text-4xl">
        {managementOnly ? t.manage : t.title}
      </h1>
      {!managementOnly && (
        <p className="mx-auto mt-4 max-w-2xl text-center text-neutral-400">
          {t.subtitle}
        </p>
      )}
      {subscription && (
        <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-white/15 bg-white/5 p-6">
          <h2 className="text-xl font-semibold">
            EasyCut{" "}
            {paddlePlans.find((p) => p.code === subscription.planCode)?.name}
          </h2>
          <p className="mt-2 text-neutral-300">
            {t.end}:{" "}
            {new Date(subscription.currentPeriodEnd).toLocaleDateString(
              language === "ja" ? "ja-JP" : "en-US",
            )}
          </p>
          {subscription.cancelAtPeriodEnd && (
            <p className="mt-2">{t.scheduled}</p>
          )}
          {subscription.providerStatus === "past_due" && (
            <p className="mt-2 text-amber-300">{t.pastDue}</p>
          )}
          {subscription.providerStatus === "canceled" && (
            <p className="mt-2">{t.canceled}</p>
          )}
          <button
            disabled={busy}
            onClick={() => void portal()}
            className="mt-5 rounded-xl bg-white px-5 py-3 font-semibold text-black disabled:opacity-50"
          >
            {t.manage}
          </button>
        </div>
      )}
      {!managementOnly && !current && (
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {paddlePlans.map((p, i) => (
            <article
              key={p.code}
              className={`relative rounded-3xl border p-7 ${i === 1 ? "border-indigo-400 bg-indigo-400/10" : "border-white/15 bg-white/[.03]"}`}
            >
              {i === 1 && (
                <span className="absolute -top-3 left-6 rounded-full bg-indigo-400 px-3 py-1 text-xs font-semibold text-black">
                  {t.recommend}
                </span>
              )}
              <h2 className="text-xl font-semibold">{p.name}</h2>
              <p className="mt-6">
                <span className="text-4xl font-bold tracking-tight">
                  {formatPaddlePrice(p.code, currency)}
                </span>
                <span className="ml-2 text-neutral-400">{t.month}</span>
              </p>
              <p className="mt-2 text-sm text-neutral-400">{t.tax}</p>
              <ul className="my-8 space-y-4 text-sm text-neutral-200">
                <li>{t.minutes(p.minutes)}</li>
                <li>{t.jobs(p.jobs)}</li>
                <li>{t.retention}</li>
              </ul>
              <button
                onClick={() => void checkout(p.code)}
                disabled={busy || !scriptReady || !checkoutEnabled}
                className={`w-full rounded-xl px-4 py-3 font-semibold disabled:opacity-50 ${i === 1 ? "bg-indigo-400 text-black" : "bg-white text-black"}`}
              >
                {t.start}
              </button>
            </article>
          ))}
        </div>
      )}
      <div role="status" aria-live="polite" className="mt-6 text-center">
        <p>{message}</p>
        {paid && (
          <Link
            className="mt-3 inline-block underline"
            href={localizedHref("/", locale)}
          >
            {t.go}
          </Link>
        )}
      </div>
      {message === t.waiting && (
        <button
          className="mx-auto mt-3 block underline"
          onClick={() => void status()}
        >
          {t.retry}
        </button>
      )}
      {pending && (
        <button
          disabled={busy}
          className="mx-auto mt-3 block underline"
          onClick={() => void discard()}
        >
          {t.discard}
        </button>
      )}
      <p className="mx-auto mt-8 max-w-2xl text-center text-sm leading-6 text-neutral-400">
        {t.terms}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-5 text-sm text-neutral-300">
        <Link href={localizedHref("/refund", locale)}>{t.refund}</Link>
        <Link href={localizedHref("/terms", locale)}>{t.legal}</Link>
        <a href="mailto:easycut@easycut.co.kr">{t.support}</a>
      </div>
    </section>
  );
}
