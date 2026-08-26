"use client";

import { useState } from "react";
import { AuthControls } from "@/components/auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import type { AuthProfile } from "@/lib/session";
import type { CustomTemplate } from "@/lib/template-config";
import type { TemplateFavoriteKey } from "@/lib/template-favorites";
import { TemplateLibrary } from "./template-library";

export function TemplatesPageShell({
  user,
  personalTemplates,
  canUseCustomTemplates,
  adminPresetNamesEnabled,
  unifiedSubtitleCanaryEnabled,
  unifiedSubtitlePreviewEnabled,
  initialFavoriteTemplateKeys,
}: {
  user: AuthProfile | null;
  personalTemplates: CustomTemplate[];
  canUseCustomTemplates: boolean;
  adminPresetNamesEnabled: boolean;
  unifiedSubtitleCanaryEnabled: boolean;
  unifiedSubtitlePreviewEnabled: boolean;
  initialFavoriteTemplateKeys: TemplateFavoriteKey[];
}) {
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginNext, setLoginNext] = useState("/templates");

  return (
    <div className="app-shell site-chrome desktop-sidebar-layout min-h-screen overflow-visible text-neutral-100">
      <SiteHeader desktopSidebar>
        <AuthControls
          user={user}
          next={loginNext}
          loginOpen={loginOpen}
          onLoginOpenChange={setLoginOpen}
        />
      </SiteHeader>
      <main className="w-full flex-1 px-5 pb-24 pt-10 sm:px-8 sm:pt-14">
        <TemplateLibrary
          personalTemplates={personalTemplates}
          authenticated={Boolean(user)}
          canUseCustomTemplates={canUseCustomTemplates}
          adminPresetNamesEnabled={adminPresetNamesEnabled}
          unifiedSubtitleCanaryEnabled={unifiedSubtitleCanaryEnabled}
          unifiedSubtitlePreviewEnabled={unifiedSubtitlePreviewEnabled}
          initialFavoriteTemplateKeys={initialFavoriteTemplateKeys}
          onLoginRequest={(next) => {
            setLoginNext(next);
            setLoginOpen(true);
          }}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
