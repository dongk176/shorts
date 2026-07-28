"use client";

import { useState } from "react";
import { AuthControls } from "@/components/auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import type { AuthProfile } from "@/lib/session";
import { PricingThreeClient } from "./pricing-three-client";

interface PricingThreePageShellProps {
  user: AuthProfile | null;
}

export function PricingThreePageShell({ user }: PricingThreePageShellProps) {
  const [loginOpen, setLoginOpen] = useState(false);

  return (
    <div className="app-shell site-chrome pricing-page min-h-screen text-neutral-100">
      <SiteHeader>
        <AuthControls
          user={user}
          next="/pricing-3"
          loginOpen={loginOpen}
          onLoginOpenChange={setLoginOpen}
        />
      </SiteHeader>
      <main className="pricing-main">
        <PricingThreeClient
          initialName={user?.displayName || ""}
          initialEmail={user?.email || ""}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
