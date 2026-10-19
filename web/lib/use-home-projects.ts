"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { MvpState, VideoJob } from "./contracts";
import type { SiteLocale } from "./i18n/config";
import { mergeHomeProjects } from "./home-projects-state";

export function useHomeProjects(state: MvpState | null, setState: Dispatch<SetStateAction<MvpState | null>>, locale: SiteLocale) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const owner = state ? (state.user?.id ?? "guest") : null;
  const needed = state?.recentJobsLoaded === false;
  const allowed = state?.enterpriseAccess.allowed !== false;
  useEffect(() => {
    if (owner === null || !needed || !allowed) return;
    const controller = new AbortController();
    const requestedAt = Date.now();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    let stopped = false;
    setStatus("loading");
    void (async () => {
      try {
        const response = await fetch(`/api/mvp/recent-jobs?locale=${locale}`, {
          signal: controller.signal, cache: "no-store", credentials: "same-origin",
        });
        if (!response.ok) throw new Error("project_list_unavailable");
        const value = await response.json() as { userId: string | null; recentJobs: VideoJob[] };
        if ((value.userId ?? "guest") !== owner) throw new Error("project_list_account_changed");
        if (stopped) return;
        setState(current => mergeHomeProjects(current, value, requestedAt));
        setStatus("ready");
      } catch {
        if (!stopped) setStatus("error");
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => { stopped = true; window.clearTimeout(timeout); controller.abort(); };
  }, [owner, needed, allowed, locale, retry, setState]);
  return { status: needed ? status : "ready", retry: () => setRetry(value => value + 1) };
}
