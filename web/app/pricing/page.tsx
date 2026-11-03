import { paypalEnabled } from "@/lib/paypal/api";
import { oneTimeEnabled } from "@/lib/paypal/one-time-config";
import { hasLegacyPaymentHistory } from "@/lib/paypal/eligibility";
import { getRequestLocale } from "@/lib/i18n/server";
import { paddleEnabled, paddleConfigured } from "@/lib/paddle/config";
import { getPaddleState } from "@/lib/paddle/service";
import { PaddlePage } from "@/components/paddle-page";
import { createLocalizedPageMetadata } from "@/lib/i18n/metadata";
import { getBillingSummary } from "@/lib/billing";
import {
  resolveBillingCustomerCohort,
  shouldUseTossBillingExperience,
} from "@/lib/billing-cohort";
import { getDb } from "@/lib/db";
import { authProfile, requireMvpSession } from "@/lib/session";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { loadTossBillingRuntimeState } from "@/lib/toss-billing-runtime";
import {
  getTossBillingState,
  publicTossCatalog,
  type TossBillingState,
} from "@/lib/toss-billing-state";
import type { TossCatalogPlan } from "@/lib/toss-subscription";

import { PricingPageShell } from "./pricing-page-shell";

export async function generateMetadata() {
  return createLocalizedPageMetadata({
    title: "AI 쇼츠 제작 요금제·가격 | 이지컷",
    description: "이지컷 프로 월간 구독과 3·6·12개월 패키지, 얼리버드 추가시간을 확인하고 결제하세요.",
    path: "/pricing",
  });
}

export default async function PricingPage() {
  const user = await getAuthenticatedUser();
  const profile = user ? authProfile(user) : null;
  const locale = await getRequestLocale();
  const paypalSession = user && paypalEnabled() && locale !== "ko"
    ? await requireMvpSession(user, { createIfMissing: false }) : null;
  const paypalCheckout = paypalEnabled() && locale !== "ko" && !paypalSession?.isEnterprise
    && (!user || Boolean(paypalSession?.userId && !(await hasLegacyPaymentHistory(paypalSession.userId))));
  if (!paypalCheckout && paddleConfigured()) {
    const session = user ? await requireMvpSession(user, { createIfMissing: false }) : null;
    const billing = session?.userId ? await getBillingSummary(getDb(), session.userId) : null;
    const paddle = billing?.paymentProvider === "paddle";
    const domestic = billing && billing.paymentProvider !== "paddle"
      && ["pending", "active", "past_due"].includes(billing.status);
    if (paddle || (paddleEnabled() && locale !== "ko" && !domestic && !session?.isEnterprise)) {
      const state = session?.userId ? await getPaddleState(session.userId) : null;
      return (
        <PaddlePage
          user={profile}
          locale={locale}
          checkoutEnabled={paddleEnabled()}
          subscription={state ? {
            providerStatus: state.providerStatus,
            planCode: state.planCode,
            currentPeriodEnd: new Date(state.currentPeriodEnd).toISOString(),
            cancelAtPeriodEnd: state.cancelAtPeriodEnd,
            currency: state.currency,
            pendingChange: state.pendingChange ? {...state.pendingChange,effectiveAt:new Date(state.pendingChange.effectiveAt).toISOString()} : null,
          } : null}
        />
      );
    }
  }
  let initialState = null;
  let tossExperience = false;
  let initialTossState: TossBillingState | null = null;
  let guestTossCatalog: TossCatalogPlan[] | null = null;
  try {
    const db = getDb();
    const session = user
      ? await requireMvpSession(user, { createIfMissing: false })
      : null;
    const appUserId = session?.userId ?? null;
    if (paypalCheckout) {
      guestTossCatalog = publicTossCatalog();
    } else {
      if (!user) {
        const runtime = await loadTossBillingRuntimeState(db);
        tossExperience = runtime.effective.assignments && runtime.effective.charges;
        if (tossExperience) guestTossCatalog = publicTossCatalog();
      } else if (appUserId) {
        const cohort = await resolveBillingCustomerCohort(appUserId, db);
        tossExperience = shouldUseTossBillingExperience(cohort);
        if (tossExperience && session?.userId) {
          initialTossState = await getTossBillingState({
            userId: session.userId,
            session: session as typeof session & { userId: string },
            db,
          });
        }
      }
    }
    initialState = {
      user: profile,
      billing: await getBillingSummary(db, appUserId),
    };
  } catch (error) {
    console.error("pricing_initial_state_failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
  return (
    <PricingPageShell
      user={profile}
      paypalCheckout={paypalCheckout}
      paypalOneTime={paypalCheckout && oneTimeEnabled()}
      initialState={initialState}
      tossExperience={tossExperience}
      initialTossState={initialTossState}
      guestTossCatalog={guestTossCatalog}
    />
  );
}
