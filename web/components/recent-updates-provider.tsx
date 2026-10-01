"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const RecentUpdatesContext = createContext(false);
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function RecentUpdatesProvider({ children }: {
  children: ReactNode;
}) {
  const [hasRecentUpdate, setHasRecentUpdate] = useState(false);
  useEffect(() => {
    let active = true;
    let pending = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const response = await fetch("/api/updates/recent", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json() as { publishedAt: number[] };
        const now = Date.now();
        if (active) setHasRecentUpdate(data.publishedAt.some(date => date <= now && now < date + RECENT_WINDOW_MS));
      } catch { /* Keep the last known badge during temporary network failures. */ }
      finally { pending = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { active = false; controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  return <RecentUpdatesContext.Provider value={hasRecentUpdate}>{children}</RecentUpdatesContext.Provider>;
}

export function useRecentUpdates() {
  return useContext(RecentUpdatesContext);
}

export function NewUpdateBadge() {
  return <span className="nav-new-update-badge" aria-hidden="true">N</span>;
}
