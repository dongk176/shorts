"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const RecentUpdatesContext = createContext(false);
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function RecentUpdatesProvider({ publishedAt, children }: {
  publishedAt: number[];
  children: ReactNode;
}) {
  const [hasRecentUpdate, setHasRecentUpdate] = useState(false);
  useEffect(() => {
    const refresh = () => {
      const now = Date.now();
      setHasRecentUpdate(publishedAt.some(date => date <= now && now < date + RECENT_WINDOW_MS));
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [publishedAt]);
  return <RecentUpdatesContext.Provider value={hasRecentUpdate}>{children}</RecentUpdatesContext.Provider>;
}

export function useRecentUpdates() {
  return useContext(RecentUpdatesContext);
}

export function NewUpdateBadge() {
  return <span className="nav-new-update-badge" aria-hidden="true">N</span>;
}
