"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AuthControls } from "@/components/auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { billingPostJson } from "@/lib/billing-client";
import type { BillingSummary, MvpState } from "@/lib/contracts";
import { useI18n } from "@/lib/i18n/provider";
import { userFacingErrorMessage } from "@/lib/public-error";
import type { AuthProfile } from "@/lib/session";

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function SettingLink({ href, icon, title, description }: {
  href: string;
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-[78px] items-center gap-4 rounded-2xl border border-white/[.08] bg-white/[.025] px-4 py-3.5 transition hover:border-white/[.16] hover:bg-white/[.05]"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[.09] bg-black/20 text-[#ff9b8d]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block text-sm font-extrabold text-neutral-100">{title}</strong>
        <span className="mt-1 block text-xs leading-5 text-neutral-500">{description}</span>
      </span>
      <span className="text-neutral-600 transition group-hover:translate-x-0.5 group-hover:text-neutral-300">
        <ArrowIcon />
      </span>
    </Link>
  );
}

function PolicyLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="group flex min-h-12 items-center justify-between gap-3 rounded-xl px-3 text-sm font-bold text-neutral-300 transition hover:bg-white/[.05] hover:text-white"
    >
      <span>{children}</span>
      <span className="text-neutral-600 transition group-hover:translate-x-0.5 group-hover:text-neutral-300"><ArrowIcon /></span>
    </Link>
  );
}

function WithdrawalDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmWord = t("settings.withdrawConfirmWord");
  const confirmed = confirmation.trim() === confirmWord;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, submitting]);

  async function withdraw() {
    if (!confirmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/account/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: confirmation.trim() }),
      });
      const result = await response.json().catch(() => ({})) as { detail?: string; code?: string };
      if (!response.ok) {
        if (result.code === "ACCOUNT_WITHDRAWAL_ACTIVE_SUBSCRIPTION") {
          throw new Error(t("settings.withdrawSubscriptionWarning"));
        }
        throw new Error(result.detail || t("settings.withdrawError"));
      }
      window.location.assign("/");
    } catch (withdrawalError) {
      setError(userFacingErrorMessage(withdrawalError, t("settings.withdrawError")));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="withdraw-dialog-title"
        aria-describedby="withdraw-dialog-description"
        className="login-dialog relative w-full max-w-[500px] overflow-hidden rounded-[24px] border border-red-300/15 bg-[#232526] p-6 shadow-[0_30px_100px_rgba(0,0,0,.7)] sm:p-8"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-10 -top-24 h-40 rounded-full bg-red-500/10 blur-3xl" />
        <div className="relative">
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-red-300/15 bg-red-400/[.08] text-red-300">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4m0 4h.01" />
              <path d="M10.3 3.8 2.6 17.1A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.9L13.7 3.8a2 2 0 0 0-3.4 0Z" />
            </svg>
          </span>
          <h2 id="withdraw-dialog-title" className="mt-5 text-2xl font-black tracking-tight text-white">
            {t("settings.withdrawDialogTitle")}
          </h2>
          <p id="withdraw-dialog-description" className="mt-3 text-sm leading-7 text-neutral-400">
            {t("settings.withdrawDialogDescription")}
          </p>
          <p className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[.055] px-4 py-3 text-xs leading-5 text-amber-100/80">
            {t("settings.withdrawSubscriptionWarning")}
          </p>
          <label htmlFor="withdraw-confirmation" className="mt-6 block text-xs font-bold text-neutral-300">
            {t("settings.withdrawConfirmPrompt")}
          </label>
          <input
            id="withdraw-confirmation"
            autoFocus
            autoComplete="off"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={submitting}
            placeholder={t("settings.withdrawConfirmPlaceholder")}
            className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm font-bold text-white outline-none transition placeholder:text-neutral-600 focus:border-red-300/50 focus:ring-4 focus:ring-red-400/10 disabled:opacity-60"
          />
          {error ? (
            <p role="alert" className="mt-3 rounded-xl border border-red-300/15 bg-red-400/[.07] px-4 py-3 text-xs leading-5 text-red-200">
              {error}
            </p>
          ) : null}
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="min-h-11 rounded-xl border border-white/10 px-5 text-sm font-bold text-neutral-300 transition hover:border-white/20 hover:bg-white/[.05] hover:text-white disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={withdraw}
              disabled={!confirmed || submitting}
              className="min-h-11 rounded-xl bg-red-500 px-5 text-sm font-black text-white shadow-[0_10px_28px_rgba(239,68,68,.2)] transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? t("settings.withdrawSubmitting") : t("settings.withdrawFinalButton")}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function SubscriptionCancelDialog({ onClose, onCanceled }: {
  onClose: () => void;
  onCanceled: (billing: BillingSummary) => void;
}) {
  const { t } = useI18n();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, submitting]);

  async function cancelSubscription() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await billingPostJson("/api/billing/subscription/cancel", { cancelAtPeriodEnd: true });
      const response = await fetch("/api/mvp/state", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(t("settings.cancelSubscriptionError"));
      const state = await response.json() as MvpState;
      onCanceled(state.billing);
    } catch (cause) {
      setError(userFacingErrorMessage(cause, t("settings.cancelSubscriptionError")));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[130] flex items-end bg-black/80 pt-8 backdrop-blur-md sm:grid sm:place-items-center sm:px-5 sm:py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-subscription-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <div className="flex w-full max-w-md flex-col overflow-hidden rounded-t-[28px] border border-white/10 bg-[#191c1e] shadow-2xl sm:rounded-3xl">
        <div className="px-5 pb-7 pt-4 sm:px-7 sm:pt-7">
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20 sm:hidden" aria-hidden="true" />
          <h2 id="cancel-subscription-title" className="text-2xl font-black text-white">{t("settings.cancelSubscriptionTitle")}</h2>
          <p className="mt-4 text-sm leading-7 text-neutral-400">{t("settings.cancelSubscriptionDialogDescription")}</p>
          {error ? <p role="alert" className="mt-4 text-sm text-red-300">{error}</p> : null}
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-3 border-t border-white/10 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-7">
          <button type="button" disabled={submitting} onClick={onClose} className="min-h-12 rounded-xl border border-white/10 px-5 text-sm font-bold text-neutral-300 disabled:opacity-40">
            {t("common.cancel")}
          </button>
          <button type="button" disabled={submitting} onClick={() => void cancelSubscription()} className="min-h-12 rounded-xl bg-[#ff715e] px-5 text-sm font-black text-white disabled:opacity-40">
            {submitting ? t("settings.cancelSubscriptionSubmitting") : t("settings.cancelSubscriptionFinal")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SettingsPageContent({ user }: { user: AuthProfile | null }) {
  const { t } = useI18n();
  const [withdrawalOpen, setWithdrawalOpen] = useState(false);
  const [cancelSubscriptionOpen, setCancelSubscriptionOpen] = useState(false);
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [subscriptionMessage, setSubscriptionMessage] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const accountLabel = user?.displayName || user?.email || t("auth.myAccount");
  const accountInitial = useMemo(() => [...accountLabel.trim()][0]?.toUpperCase() || "E", [accountLabel]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/mvp/state", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (response.ok) setBilling((await response.json() as MvpState).billing);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const activeMonthlySubscription = billing?.activeProducts.find((product) =>
    !product.planCode.startsWith("starter_") && !product.planCode.startsWith("expert_")
  );

  async function signOut(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (signingOut) return;
    setSigningOut(true);
    const form = event.currentTarget;
    try {
      const response = await fetch("/auth/sign-out", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-EasyCut-Client-Navigation": "1",
        },
        body: new URLSearchParams({ next: "/" }),
      });
      if (!response.ok) throw new Error(`LOGOUT_FAILED_${response.status}`);
      window.location.replace("/");
    } catch {
      form.submit();
    }
  }

  return (
    <div className="app-shell site-chrome min-h-screen text-neutral-100">
      <SiteHeader><AuthControls user={user} next="/settings" /></SiteHeader>
      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-12 sm:px-8 sm:py-16">
        <header>
          <p className="text-xs font-black tracking-[.2em] text-[#ff8c7c]">{t("settings.eyebrow")}</p>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">{t("settings.title")}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-neutral-400">{t("settings.description")}</p>
        </header>

        <div className="mt-10 grid gap-6">
          <section className="rounded-[22px] border border-white/[.09] bg-[#191c1e]/80 p-5 shadow-[0_18px_60px_rgba(0,0,0,.16)] sm:p-6">
            <h2 className="text-lg font-black text-white">{t("settings.profile")}</h2>
            <div className="mt-5 flex items-center gap-4 rounded-2xl border border-white/[.08] bg-black/15 p-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#ff8c7c] to-[#8b5cf6] text-base font-black text-white shadow-lg">
                {accountInitial}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-neutral-500">{t("settings.signedInAs")}</span>
                <strong className="mt-1 block truncate text-sm font-extrabold text-neutral-100">{accountLabel}</strong>
                {user?.displayName && user.email ? <span className="mt-1 block truncate text-xs text-neutral-500">{user.email}</span> : null}
              </span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <SettingLink
                href="/account/activity"
                title={t("settings.activity")}
                description={t("settings.activityDescription")}
                icon={<svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 19V9m5 10V5m5 14v-7m5 7V3" /></svg>}
              />
              <SettingLink
                href="/pricing"
                title={t("settings.managePlan")}
                description={t("settings.managePlanDescription")}
                icon={<svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18m-13 5h3" /></svg>}
              />
            </div>
          </section>

          {activeMonthlySubscription ? (
            <section className="rounded-[22px] border border-white/[.09] bg-[#191c1e]/80 p-5 shadow-[0_18px_60px_rgba(0,0,0,.16)] sm:p-6">
              <h2 className="text-lg font-black text-white">{t("settings.subscription")}</h2>
              <p className="mt-2 text-sm leading-6 text-neutral-500">{t("settings.subscriptionDescription")}</p>
              <div className="mt-5 flex flex-col gap-4 rounded-2xl border border-white/[.08] bg-black/15 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <strong className="text-sm font-extrabold text-neutral-100">{activeMonthlySubscription.displayName}</strong>
                  <p className="mt-1 text-xs leading-5 text-neutral-500">
                    {activeMonthlySubscription.cancelAtPeriodEnd
                      ? t("settings.subscriptionCancelScheduled")
                      : t("settings.subscriptionActive")}
                  </p>
                </div>
                {!activeMonthlySubscription.cancelAtPeriodEnd ? (
                  <button type="button" onClick={() => setCancelSubscriptionOpen(true)} className="min-h-10 rounded-xl border border-white/10 px-4 text-xs font-extrabold text-neutral-400 transition hover:border-red-300/30 hover:bg-red-400/[.06] hover:text-red-200">
                    {t("settings.cancelSubscription")}
                  </button>
                ) : null}
              </div>
              {subscriptionMessage ? <p role="status" className="mt-3 text-xs leading-5 text-emerald-300">{subscriptionMessage}</p> : null}
            </section>
          ) : null}

          <section className="rounded-[22px] border border-white/[.09] bg-[#191c1e]/80 p-5 shadow-[0_18px_60px_rgba(0,0,0,.16)] sm:p-6">
            <h2 className="text-lg font-black text-white">{t("settings.legal")}</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-500">{t("settings.legalDescription")}</p>
            <nav className="mt-4 grid gap-1 sm:grid-cols-2" aria-label={t("settings.legal")}>
              <PolicyLink href="/terms">{t("settings.terms")}</PolicyLink>
              <PolicyLink href="/purchase-terms">{t("settings.purchaseTerms")}</PolicyLink>
              <PolicyLink href="/refund">{t("settings.refund")}</PolicyLink>
              <PolicyLink href="/privacy">{t("settings.privacy")}</PolicyLink>
              <PolicyLink href="/support">{t("settings.support")}</PolicyLink>
            </nav>
          </section>

          <section className="rounded-[22px] border border-white/[.09] bg-[#191c1e]/80 p-5 shadow-[0_18px_60px_rgba(0,0,0,.16)] sm:p-6">
            <h2 className="text-lg font-black text-white">{t("settings.account")}</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-500">{t("settings.accountDescription")}</p>
            <div className="mt-5 divide-y divide-white/[.07] overflow-hidden rounded-2xl border border-white/[.08]">
              <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <strong className="text-sm font-extrabold text-neutral-100">{t("auth.logout")}</strong>
                  <p className="mt-1 text-xs leading-5 text-neutral-500">{t("settings.logoutDescription")}</p>
                </div>
                <form action="/auth/sign-out" method="post" onSubmit={signOut}>
                  <input type="hidden" name="next" value="/" />
                  <button
                    type="submit"
                    disabled={signingOut}
                    aria-busy={signingOut}
                    className="min-h-10 rounded-xl border border-white/10 px-4 text-xs font-extrabold text-neutral-300 transition hover:border-white/20 hover:bg-white/[.05] hover:text-white disabled:cursor-wait disabled:opacity-60"
                  >
                    {t("auth.logout")}
                  </button>
                </form>
              </div>
              <div className="flex flex-col gap-4 bg-red-500/[.025] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <strong className="text-sm font-extrabold text-red-200">{t("settings.withdraw")}</strong>
                  <p className="mt-1 text-xs leading-5 text-neutral-500">{t("settings.withdrawDescription")}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setWithdrawalOpen(true)}
                  className="min-h-10 rounded-xl border border-red-300/20 px-4 text-xs font-extrabold text-red-200 transition hover:border-red-300/40 hover:bg-red-400/[.08] hover:text-red-100"
                >
                  {t("settings.withdrawButton")}
                </button>
              </div>
            </div>
          </section>
        </div>
      </main>
      <SiteFooter />
      {withdrawalOpen ? <WithdrawalDialog onClose={() => setWithdrawalOpen(false)} /> : null}
      {cancelSubscriptionOpen ? (
        <SubscriptionCancelDialog
          onClose={() => setCancelSubscriptionOpen(false)}
          onCanceled={(nextBilling) => {
            setBilling(nextBilling);
            setCancelSubscriptionOpen(false);
            setSubscriptionMessage(t("settings.cancelSubscriptionSuccess"));
          }}
        />
      ) : null}
    </div>
  );
}
