"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { UsageSnapshot } from "@/lib/contracts";
import { USAGE_UPDATED_EVENT, usageFromEvent } from "@/lib/usage-client";

export type UsageState = {
  authenticated: boolean;
  accountId: string | null;
  isEnterprise: boolean;
  usage: UsageSnapshot | null;
};

type UsageContextValue = UsageState & {
  refreshUsage: () => Promise<UsageSnapshot | null>;
};

const UsageContext = createContext<UsageContextValue | null>(null);

export function UsageProvider({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState: UsageState;
}) {
  const pathname = usePathname();
  const [usageState, setUsageState] = useState(initialState);
  const lastSuccessfulLoadAt = useRef(initialState.usage ? Date.now() : 0);
  const inFlight = useRef<Promise<UsageSnapshot | null> | null>(null);
  const activeController = useRef<AbortController | null>(null);
  const isAdminPath = pathname.startsWith("/admin/");

  const loadUsageIfNeeded = useCallback((force = false): Promise<UsageSnapshot | null> => {
    if (isAdminPath) return Promise.resolve(null);
    if (!force && Date.now() - lastSuccessfulLoadAt.current < 30_000) {
      return Promise.resolve(usageState.usage);
    }
    if (inFlight.current) return inFlight.current;

    const controller = new AbortController();
    activeController.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    const request = fetch("/api/mvp/usage", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    }).then(async (response): Promise<UsageSnapshot | null> => {
      if (!response.ok) return null;
      const body = await response.json() as UsageState;
      setUsageState({
        authenticated: body.authenticated,
        accountId: body.authenticated ? body.accountId : null,
        isEnterprise: body.authenticated && body.isEnterprise === true,
        usage: body.authenticated ? body.usage : null,
      });
      lastSuccessfulLoadAt.current = Date.now();
      return body.authenticated ? body.usage : null;
    }).catch(() => null).finally(() => {
      window.clearTimeout(timeout);
      if (activeController.current === controller) activeController.current = null;
      if (inFlight.current === request) inFlight.current = null;
    });
    inFlight.current = request;
    return request;
  }, [isAdminPath, usageState.usage]);

  const refreshUsage = useCallback(
    () => loadUsageIfNeeded(true),
    [loadUsageIfNeeded],
  );

  useEffect(() => {
    if (isAdminPath) {
      activeController.current?.abort();
      return;
    }
    void loadUsageIfNeeded();
  }, [isAdminPath, loadUsageIfNeeded, pathname]);

  useEffect(() => {
    const onUsageUpdated = (event: Event) => {
      setUsageState((current) => current.authenticated
        ? { ...current, usage: usageFromEvent(event) }
        : current);
      lastSuccessfulLoadAt.current = Date.now();
    };
    const onFocus = () => void loadUsageIfNeeded();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void loadUsageIfNeeded();
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadUsageIfNeeded();
    }, 120_000);
    window.addEventListener(USAGE_UPDATED_EVENT, onUsageUpdated);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(USAGE_UPDATED_EVENT, onUsageUpdated);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadUsageIfNeeded]);

  const contextValue = useMemo<UsageContextValue>(() => ({
    ...usageState,
    refreshUsage,
  }), [refreshUsage, usageState]);

  return (
    <UsageContext.Provider value={contextValue}>
      {children}
    </UsageContext.Provider>
  );
}

export function useUsageState() {
  const value = useContext(UsageContext);
  if (!value) throw new Error("useUsageState must be used within UsageProvider.");
  return value;
}
