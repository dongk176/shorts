"use client";

import { useState } from "react";
import { AuthControls } from "@/components/auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import type { AuthProfile } from "@/lib/session";
import { PricingClient, type PricingState } from "./pricing-client";

export function PricingPageShell({
  user,
  initialState,
}: {
  user: AuthProfile | null;
  initialState: PricingState | null;
}) {
  const [loginOpen, setLoginOpen] = useState(false);

  return (
    <div className="app-shell site-chrome pricing-page min-h-screen text-neutral-100">
      <SiteHeader>
        <AuthControls
          user={user}
          next="/pricing"
          loginOpen={loginOpen}
          onLoginOpenChange={setLoginOpen}
        />
      </SiteHeader>
      <main className="pricing-main">
        <PricingClient
          initialState={initialState}
          onRequireLogin={() => setLoginOpen(true)}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
