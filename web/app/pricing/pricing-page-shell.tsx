"use client";

import { useI18n } from "@/lib/i18n/provider";
import { useState } from "react";
import { StrategyGuideBenefit } from "@/components/strategy-guide-benefit";
import { AuthControls } from "@/components/auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import type { AuthProfile } from "@/lib/session";
import type { TossBillingState } from "@/lib/toss-billing-state";
import type { TossCatalogPlan } from "@/lib/toss-subscription";
import { PricingClient, type PricingState } from "./pricing-client";
import { TossPricingClient } from "./toss-pricing-client";
import styles from "./pricing.module.css";

export function PricingPageShell({
  user,
  paypalCheckout = false,
  initialState,
  tossExperience,
  initialTossState,
  guestTossCatalog,
}: {
  user: AuthProfile | null;
  paypalCheckout?: boolean;
  initialState: PricingState | null;
  tossExperience: boolean;
  initialTossState: TossBillingState | null;
  guestTossCatalog: TossCatalogPlan[] | null;
}) {
  const { locale } = useI18n();
  const [loginOpen, setLoginOpen] = useState(false);

  return (
    <div className={`app-shell site-chrome desktop-sidebar-layout pricing-page min-h-screen text-neutral-100 ${styles.page}`}>
      <SiteHeader desktopSidebar>
        <AuthControls
          user={user}
          next="/pricing"
          loginOpen={loginOpen}
          onLoginOpenChange={setLoginOpen}
        />
      </SiteHeader>
      <main className="pricing-main">
        {tossExperience ? (
          <>
            <TossPricingClient
              initialState={initialTossState}
              guestCatalog={guestTossCatalog}
              onRequireLogin={() => setLoginOpen(true)}
            />
            <PricingClient
              ancillaryOnly
              initialState={initialState}
              onRequireLogin={() => setLoginOpen(true)}
            />
          </>
        ) : (
          <PricingClient
            paypalCheckout={paypalCheckout}
            initialState={initialState}
            onRequireLogin={() => setLoginOpen(true)}
          />
        )}
        {locale !== "ko" ? <aside className="mx-auto my-8 max-w-4xl rounded-2xl border border-white/10 p-5 text-sm leading-7 text-neutral-300">
          <h2 className="mb-2 font-bold text-white">{locale === "en" ? "Buying from outside Korea" : "韓国以外からご利用の方へ"}</h2>
          <p>{paypalCheckout ? (locale === "en" ? "Prices and PayPal charges are in US dollars (USD). Subscriptions automatically renew at the displayed price and interval until canceled. Monthly processing allowances reset each month. Manage renewal in account settings." : "表示価格・PayPal請求通貨は米ドル（USD）です。解約するまで表示の料金・周期で自動更新され、動画処理枠は毎月更新されます。自動更新はアカウント設定から停止できます。") : locale === "en" ? "Prices marked ₩ are in South Korean won (KRW). Check the final currency, amount and available payment methods on the payment screen before confirming. Your card issuer may apply currency conversion or international transaction fees." : "₩表記の価格は韓国ウォン（KRW）です。確定前に決済画面で最終的な通貨・金額・利用可能なお支払い方法をご確認ください。カード会社によって為替換算や海外利用手数料が発生する場合があります。"}</p>
          <p className="mt-2">{locale === "en" ? "Guides marked Korean edition are provided in Korean. The website language does not change the language of those PDF files." : "韓国語版と記載されたガイドは韓国語で提供しています。サイトの表示言語を変えても、そのPDFの言語は変わりません。"}</p>
        </aside> : null}
        <StrategyGuideBenefit />
      </main>
      <SiteFooter />
    </div>
  );
}
