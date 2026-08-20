"use client";

import { useState } from "react";
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
  initialState,
  tossExperience,
  initialTossState,
  guestTossCatalog,
}: {
  user: AuthProfile | null;
  initialState: PricingState | null;
  tossExperience: boolean;
  initialTossState: TossBillingState | null;
  guestTossCatalog: TossCatalogPlan[] | null;
}) {
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
            initialState={initialState}
            onRequireLogin={() => setLoginOpen(true)}
          />
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
