"use client";
import Script from "next/script";
import { formatChangeAmount } from "@/lib/paddle/change-policy";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { paddlePlans, paddleDisplayPlans, paddlePackageTerms, formatPaddlePrice, paddleInitialTerm, paddleDiscount } from "@/lib/paddle/catalog";
import { localizedHref } from "@/lib/i18n/routing";
import { useUsageState } from "@/components/usage-provider";
import styles from "@/app/pricing/pricing.module.css";
import type { SiteLocale } from "@/lib/i18n/config";

type Subscription = {
  providerStatus: string;
  planCode: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  currency?: "USD"|"JPY"|null;
  pendingChange?: {id:string;planCode:string;timing:string;status:string;effectiveAt:string}|null;
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
type Change = {id:string;planCode:string;timing:string;amountMinor:number;currency:'USD'|'JPY';effectiveAt:string;status:string};
const copy = {
  en: {
    title: "Choose the plan that fits your needs",
    month: "/ month",
    tax: "Tax included · Billed monthly",
    recommend: "Best value",
    maximumSaving: "Best deal",
    equivalent: "/ month",
    monthlyEquivalent: "Monthly equivalent",
    discount: (n:number) => `${n}% off vs. the 3-month plan`,
    currencyNote: (c:string) => `Your subscription is billed in ${c}. Changing the site language does not change its currency.`,
    working: "Processing…",
    checking: "Checking…",
    cancelChange: "Cancel scheduled change",
    cancelQuestion: "Cancel your scheduled plan change?",
    cancelDetail: "You’ll keep your current plan and renewal date. No payment or refund today.",
    changeCanceled: "Scheduled change canceled. You can now choose another plan.",
    scheduledPlan: "Scheduled plan",
    keep: "Go back",
    proceed: "Confirm change",
    clips: (n:number) => `About ${n} short clips / month*`,
    clipsNote: "*Estimate based on source content and clip settings. Actual output varies.",
    nextPayment: "Next payment",
    includedTax: "Tax included",
    term: "Package duration",
    duration: (n: number) => `${n} months`,
    package: "Package",
    names: ["EasyCut Pro", "Starter package", "Expert package"],
    descriptions: ["Start with a monthly plan", "More editing time for regular creators", "For creators with a larger workflow"],
    billed: (n: number, total: string) => `${total} billed upfront every ${n} months`,
    start: "Choose plan",
    current: "Current plan",
    change: "Change plan",
    changeQuestion: (name:string) => `Switch to ${name}?`,
    nowCharge: (amount:string) => `Pay ${amount} now for the remaining period.`,
    renewalChange: (date:string) => `Starts on ${date}. Your current plan stays active until then. No payment or refund today.`,
    changed: "Plan change confirmed.",
    changing: "Your change is being confirmed. Please do not submit again. Refresh this page shortly.",
    changeError: "Unable to change this plan. Refresh the page or contact support.",
    pendingChange: (name:string,date:string) => `Scheduled: ${name} from ${date}`,
    settings: "Billing management",
    compare: "Compare and change plans",
    manage: "Manage subscription",
    minutes: (n: number) => `${n} source-video minutes each month`,
    jobs: (n: number) => `${n} concurrent ${n === 1 ? "job" : "jobs"}`,
    retention: "Projects stored for 30 days",
    popular: "Trending-video search filters",
    terms:
      "EasyCut Pro renews monthly. Packages are paid upfront and renew every 3, 6 or 12 months, as selected. Editing minutes reset each month and do not roll over. Manage payment methods or cancel before renewal in Settings → Billing management.",
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
    title: "必要な分だけ、選べるプラン",
    month: "/ 月",
    tax: "税込・毎月のお支払い",
    recommend: "高コスパ",
    maximumSaving: "最大割引",
    equivalent: "/ 月換算",
    monthlyEquivalent: "月額換算",
    discount: (n:number) => `3か月プラン比 ${n}%OFF`,
    currencyNote: (c:string) => `ご契約の決済通貨は${c}です。サイトの言語を変更しても通貨は変わりません。`,
    working: "処理中…",
    checking: "確認中…",
    cancelChange: "変更予約を取り消す",
    cancelQuestion: "プランの変更予約を取り消しますか？",
    cancelDetail: "現在のプランと次回のお支払い日は変わりません。本日の請求・返金はありません。",
    changeCanceled: "変更予約を取り消しました。別のプランをお選びいただけます。",
    scheduledPlan: "変更予定のプラン",
    keep: "戻る",
    proceed: "変更を確定",
    clips: (n:number) => `月約${n}本のショート動画を作成*`,
    clipsNote: "*元動画やクリップの設定による目安です。実際の作成本数は異なります。",
    nextPayment: "次回のお支払い日",
    includedTax: "税込",
    term: "パッケージの契約期間",
    duration: (n: number) => `${n}か月`,
    package: "パッケージ",
    names: ["EasyCut Pro", "スターターパッケージ", "エキスパートパッケージ"],
    descriptions: ["月額プランで気軽にスタート", "定期的に動画を制作する方に", "より多くの動画を制作する方に"],
    billed: (n: number, total: string) => `${n}か月ごとに${total}を一括払い`,
    start: "このプランを選ぶ",
    current: "ご利用中のプラン",
    change: "プランを変更",
    changeQuestion: (name:string) => `${name}に変更しますか？`,
    nowCharge: (amount:string) => `残りの利用期間の差額として、今すぐ${amount}をお支払いいただきます。`,
    renewalChange: (date:string) => `${date}から適用されます。それまでは現在のプランをご利用いただけます。本日の請求・返金はありません。`,
    changed: "プラン変更を受け付けました。",
    changing: "変更内容を確認しています。再度申し込まず、しばらくしてからページを更新してください。",
    changeError: "プランを変更できませんでした。ページを更新するか、サポートにお問い合わせください。",
    pendingChange: (name:string,date:string) => `変更予定：${date}から${name}`,
    settings: "お支払い・契約管理",
    compare: "プランの比較・変更",
    manage: "契約を管理",
    minutes: (n: number) => `毎月${n}分の元動画を処理`,
    jobs: (n: number) => `同時に${n}件まで処理`,
    retention: "プロジェクトを30日間保存",
    popular: "リアルタイム急上昇の検索フィルター",
    terms:
      "EasyCut Proは毎月、パッケージは選択した3・6・12か月ごとの一括払いで自動更新されます。処理時間は毎月リセットされ、翌月に繰り越されません。お支払い方法の変更・解約は、設定の「お支払い・契約管理」から行えます。",
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
  const currency = initial?.currency || (language === "ja" ? "JPY" : "USD");
  const [months, setMonths] = useState<(typeof paddlePackageTerms)[number]>(() => paddleInitialTerm(initial?.providerStatus !== "canceled" ? initial?.planCode : undefined));
  const displayedPlans = paddleDisplayPlans(months, currency, initial?.providerStatus !== "canceled" ? initial?.planCode : undefined);
  const [scriptReady, setScriptReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionPlan, setActionPlan] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{quote:Change} | {cancelId:string} | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (confirmation) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [confirmation]);
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
    setActionPlan(planCode ?? null);
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
      setActionPlan(null);
    }
  }
  useEffect(() => {
    if (resumeId && scriptReady && loggedIn && !resumed.current) {
      resumed.current = true;
      void checkout(undefined, resumeId);
    }
  }, [resumeId, scriptReady, loggedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  function planName(code: string) {
    const p=paddlePlans.find(p=>p.code===code);
    if(!p) return code;
    const label=code.startsWith('paddle_lite')?t.names[0]:code.startsWith('paddle_creator')?t.names[1]:t.names[2];
    return `${label} · ${p.billingMonths===1?(language==='ja'?'月額':'Monthly'):t.duration(p.billingMonths)}`;
  }
  const displayDate=(value:string)=>new Date(value).toLocaleDateString(language==='ja'?'ja-JP':'en-US');
  async function requestChange(body:unknown) {
    const response=await fetch('/api/paddle/change',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();
    if(!response.ok) throw new Error(data.code);
    return data.change as Change;
  }
  async function refreshSubscription() {
    const response=await fetch('/api/paddle/state',{cache:'no-store'});
    if(response.ok) {const body=await response.json();setSubscription(body.subscription);await refreshUsage();}
  }
  function changeError(error:unknown) {
    setMessage(error instanceof Error && ['CHANGE_UNCONFIRMED','CHANGE_PENDING'].includes(error.message)?t.changing:t.changeError);
  }
  async function changePlan(planCode:string) {
    if(busy) return;
    setBusy(true); setActionPlan(planCode); setMessage('');
    try {setConfirmation({quote:await requestChange({action:'preview',planCode})});}
    catch(error) {changeError(error);}
    finally {setBusy(false);setActionPlan(null);}
  }
  async function confirmChange() {
    if(!confirmation || busy) return;
    setBusy(true);setMessage('');
    try {
      const cancel='cancelId' in confirmation;
      const result=await requestChange(cancel?{action:'cancel',changeId:confirmation.cancelId}:{action:'confirm',quoteId:confirmation.quote.id});
      setMessage(cancel?(result.status==='superseded'?t.changeCanceled:t.changing):(['applied','scheduled'].includes(result.status)?t.changed:t.changing));
    } catch(error) {changeError(error);}
    finally {await refreshSubscription().catch(()=>{});setBusy(false);setConfirmation(null);}
  }
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
    <>
      <Script
        src="https://cdn.paddle.com/paddle/v2/paddle.js"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
        onError={() => setMessage(t.error)}
      />
      <section className={`hero pricing-hero ${styles.hero}`}>
        <h1><span>{managementOnly ? t.manage : t.title}</span></h1>
      </section>
      <dialog ref={dialogRef} className={styles.paddleDialog} aria-labelledby="paddle-confirm-title"
        onCancel={(event) => {if(busy) event.preventDefault();else setConfirmation(null);}}>
        {confirmation && <>
          <h2 id="paddle-confirm-title">{'cancelId' in confirmation ? t.cancelQuestion : t.changeQuestion(planName(confirmation.quote.planCode))}</h2>
          <p>{'cancelId' in confirmation ? t.cancelDetail : confirmation.quote.timing === 'immediate'
            ? t.nowCharge(formatChangeAmount(confirmation.quote.amountMinor,confirmation.quote.currency,language))
            : t.renewalChange(displayDate(confirmation.quote.effectiveAt))}</p>
          <div className={styles.paddleDialogActions}>
            <button type="button" disabled={busy} onClick={()=>setConfirmation(null)}>{t.keep}</button>
            <button type="button" disabled={busy} onClick={()=>void confirmChange()}>{busy?t.working:'cancelId' in confirmation?t.cancelChange:t.proceed}</button>
          </div>
        </>}
      </dialog>
      {subscription && (
        <div className={managementOnly ? styles.paddleManagement : styles.paddleSubscription}>
          <h2>
            {planName(subscription.planCode)}
          </h2>
          <p>
            {subscription.providerStatus === "active" && !subscription.cancelAtPeriodEnd ? t.nextPayment : t.end}:{" "}
            {new Date(subscription.currentPeriodEnd).toLocaleDateString(
              language === "ja" ? "ja-JP" : "en-US",
            )}
          </p>
          {subscription.currency && subscription.currency !== (language==='ja'?'JPY':'USD') && <p className={styles.paddleCurrencyNote}>{t.currencyNote(subscription.currency)}</p>}
          {subscription.cancelAtPeriodEnd && (
            <p className="mt-2">{t.scheduled}</p>
          )}
          {subscription.providerStatus === "past_due" && (
            <p className="mt-2 text-amber-300">{t.pastDue}</p>
          )}
          {subscription.providerStatus === "canceled" && (
            <p className="mt-2">{t.canceled}</p>
          )}
          {subscription.pendingChange && <p className="mt-3 text-sm text-neutral-300">{subscription.pendingChange.timing==='renewal' && subscription.pendingChange.status==='scheduled'?t.pendingChange(planName(subscription.pendingChange.planCode),displayDate(subscription.pendingChange.effectiveAt)):t.changing}</p>}
          {subscription.pendingChange?.timing==='renewal' && subscription.pendingChange.status==='scheduled' && (
            <button className={styles.paddleCancelChange} disabled={busy} onClick={()=>setConfirmation({cancelId:subscription.pendingChange!.id})}>{t.cancelChange}</button>
          )}
          {managementOnly && <button
            disabled={busy}
            onClick={() => void portal()}
            className="mt-5 rounded-xl bg-white px-5 py-3 font-semibold text-black disabled:opacity-50"
          >
            {busy?t.working:t.manage}
          </button>}
          {managementOnly && <Link className="ml-5 underline" href={localizedHref("/pricing",locale)}>{t.compare}</Link>}
        </div>
      )}
      {!managementOnly && (
        <>
          <div className={`${styles.planToolbar} ${styles.localPlanToolbar} ${styles.paddleToolbar}`}>
            <span>{t.term}</span>
            <div className={`${styles.packageTermPicker} ${styles.localTermPicker}`} role="group" aria-label={t.term}>
              {paddlePackageTerms.map((term) => (
                <button key={term} type="button" aria-pressed={months === term}
                  className={months === term ? styles.packageTermActive : ""}
                  onClick={() => setMonths(term)}>{t.duration(term)}</button>
              ))}
            </div>
          </div>
          <section id="pricing-plans" className={`pricing-grid ${styles.localPlanGrid} ${styles.paddlePlanGrid}`} aria-label={t.title}>
            {displayedPlans.map((p, i) => {
              const discount=paddleDiscount(p.code,currency);
              const discountPercent=discount ? Math.ceil(discount.percent) : 0;
              return (
              <article key={p.code}
                className={`pricing-card ${i === 1 ? "pricing-card-popular" : i === 2 ? "pricing-card-pro" : ""} ${styles.planCard} ${styles.localPlanCard} ${styles.paddlePlanCard} ${i === 1 ? styles.mobilePlanStarter : i === 2 ? styles.mobilePlanExpert : styles.mobilePlanPro}`}>
                {i === 1 && (months === 6 || months === 12) && (
                  <span className={`pricing-badge ${styles.localReasonableBadge} ${styles.paddleBadge}`}>{months === 12 ? t.maximumSaving : t.recommend}</span>
                )}
                {discount && discount.percent > 0 && (
                  <span className={`${styles.planEyebrow} ${styles.discountEyebrow} ${i === 2 ? styles.discountEyebrowViolet : ""}`}>
                    {discountPercent}%{language === "ja" ? "OFF" : " off"}
                  </span>
                )}
                <div className="pricing-plan-name"><h2>{t.names[i]}</h2></div>
                <p className={styles.localPlanDescription}>{t.descriptions[i]}</p>
                {months !== 3 && <div className={styles.paddleDiscount}>
                  {discount && <><span>{t.discount(discountPercent)}</span><del>{formatPaddlePrice(discount.baseline,currency,true)} {t.month}</del></>}
                </div>}
                <div className={`pricing-price ${styles.localPlanPrice}`}>
                  <strong>{formatPaddlePrice(p.code, currency, true)}</strong><span>{p.billingMonths === 1 ? t.month : t.equivalent}</span>
                </div>
                <div className={styles.paddleBilling}>
                  {p.billingMonths !== 1 && language==='en' && <span>{t.monthlyEquivalent}</span>}
                  <p>{p.billingMonths === 1 ? t.tax : t.billed(p.billingMonths, formatPaddlePrice(p.code, currency))}</p>
                  {p.billingMonths !== 1 && <span>{t.includedTax}</span>}
                </div>
                <ul>
                  {[t.minutes(p.minutes), t.clips(Math.floor(p.minutes * .8)), t.jobs(p.jobs), t.retention, t.popular].map((feature) => (
                    <li key={feature}><span>✓</span><span>{feature}</span></li>
                  ))}
                </ul>
                <button type="button" onClick={() => void (current ? changePlan(p.code) : checkout(p.code))}
                  disabled={busy || !checkoutEnabled || (!current && !scriptReady) || !!(current && (subscription.planCode===p.code || subscription.pendingChange || subscription.cancelAtPeriodEnd || subscription.providerStatus!=="active"))}
                  className={`pricing-cta ${i === 1 ? "pricing-cta-primary" : ""} ${styles.planCta} ${styles.paddleCta}`}>
                  {busy && actionPlan===p.code ? t.checking : current ? subscription.planCode===p.code?t.current:subscription.pendingChange?.planCode===p.code?t.scheduledPlan:t.change : t.start}
                </button>
              </article>
            );})}
          </section>
          <p className={styles.paddleEstimate}>{t.clipsNote}</p>
        </>
      )}
      <div role="status" aria-live="polite" className={message || paid || busy ? "mt-6 text-center" : undefined}>
        <p>{busy && !confirmation ? t.working : message}</p>
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
      <p className={styles.paddleTerms}>
        {t.terms}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-5 text-sm text-neutral-300">
        {!managementOnly && current && <Link href={localizedHref("/settings/plan",locale)}>{t.settings}</Link>}
        <Link href={localizedHref("/refund", locale)}>{t.refund}</Link>
        <Link href={localizedHref("/terms", locale)}>{t.legal}</Link>
        <a href="mailto:easycut@easycut.co.kr">{t.support}</a>
      </div>
    </>
  );
}
