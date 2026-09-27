"use client";
import { useState } from "react";
import { StrategyGuideBenefit } from "@/components/strategy-guide-benefit";
import { AuthControls } from "@/components/auth-controls";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { PaddlePricing } from "@/components/paddle-pricing";
import type { AuthProfile } from "@/lib/session";
import type { SiteLocale } from "@/lib/i18n/config";
import type { ComponentProps } from "react";
import styles from "@/app/pricing/pricing.module.css";
import { localizedHref } from "@/lib/i18n/routing";
export function PaddlePage({
  user,
  locale,
  ...props
}: { user: AuthProfile | null; locale: SiteLocale } & Pick<
  ComponentProps<typeof PaddlePricing>,
  "subscription" | "resumeId" | "managementOnly" | "checkoutEnabled"
>) {
  const [loginOpen, setLoginOpen] = useState(false);
  return (
    <div className={`app-shell site-chrome desktop-sidebar-layout pricing-page min-h-screen text-neutral-100 ${styles.page}`}>
      <SiteHeader desktopSidebar>
        <AuthControls
          user={user}
          next={localizedHref(
            props.resumeId
              ? `/billing/paddle?_ptxn=${encodeURIComponent(props.resumeId)}`
              : "/pricing",
            locale,
          )}
          loginOpen={loginOpen}
          onLoginOpenChange={setLoginOpen}
        />
      </SiteHeader>
      <main className="pricing-main">
        <PaddlePricing
          {...props}
          locale={locale}
          loggedIn={Boolean(user)}
          onRequireLogin={() => setLoginOpen(true)}
        />
        {!props.managementOnly && !props.resumeId && <StrategyGuideBenefit />}
      </main>
      <SiteFooter />
    </div>
  );
}
