"use client";

import { useState } from "react";
import { AuthControls } from "@/components/auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import type { AuthProfile } from "@/lib/session";
import { PopularVideosExplorer } from "./popular-videos-explorer";

export function PopularPageShell({
  user,
  canUseFilters,
}: {
  user: AuthProfile | null;
  canUseFilters: boolean;
}) {
  const [loginOpen, setLoginOpen] = useState(false);

  return (
    <div className="app-shell site-chrome desktop-sidebar-layout min-h-screen overflow-visible text-neutral-100">
      <SiteHeader desktopSidebar>
        <AuthControls
          user={user}
          next="/popular"
          loginOpen={loginOpen}
          onLoginOpenChange={setLoginOpen}
        />
      </SiteHeader>
      <PopularVideosExplorer
        canUseFilters={canUseFilters}
        isAuthenticated={Boolean(user)}
        onRequireLogin={() => setLoginOpen(true)}
      />
      <SiteFooter />
    </div>
  );
}
