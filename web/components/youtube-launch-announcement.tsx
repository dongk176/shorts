"use client";

import { useEffect } from "react";
import { usePathname } from "@/lib/i18n/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { useWelcomeOverlayStage } from "./welcome-overlay-queue";
import { YoutubeLaunchGuide } from "./youtube-launch-guide";

export function YoutubeLaunchAnnouncement() {
  const pathname = usePathname();
  const { locale } = useI18n();
  const { active, complete } = useWelcomeOverlayStage("youtube-launch");
  // Keep announcements out of OAuth callbacks, checkout, admin, and the editor.
  const eligible = locale === "ko" && (pathname === "/" || pathname === "/projects" || /^\/projects\/\d+$/.test(pathname));
  useEffect(() => { if (active && !eligible) complete(); }, [active, eligible, complete]);
  if (!active || !eligible) return null;
  return <YoutubeLaunchGuide preview={process.env.NODE_ENV === "development"} onDismiss={complete} />;
}
