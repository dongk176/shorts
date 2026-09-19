"use client";

import { usePathname } from "@/lib/i18n/navigation";
import type { ReactNode } from "react";

// Keep the queue mounted, but do not mount notices during the application.
// This also prevents claim/seen requests from consuming a postponed notice.
export function ApplicationOverlays({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/creator-support" || pathname === "/blog" || pathname.startsWith("/blog/")) return null;
  return children;
}
