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
  const skippedInitialRefresh = useRef(false);

  const loadUsage = useCallback(async (): Promise<UsageSnapshot | null> => {
    const response = await fetch("/api/mvp/usage", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) return null;
    const body = await response.json() as UsageState;
    setUsageState({
      authenticated: body.authenticated,
      accountId: body.authenticated ? body.accountId : null,
      usage: body.authenticated ? body.usage : null,
    });
    return body.authenticated ? body.usage : null;
  }, []);

  useEffect(() => {
    if (!skippedInitialRefresh.current) {
      skippedInitialRefresh.current = true;
      return;
    }
    void loadUsage();
  }, [loadUsage, pathname]);

  useEffect(() => {
    const onUsageUpdated = (event: Event) => {
      setUsageState((current) => current.authenticated
        ? { ...current, usage: usageFromEvent(event) }
        : current);
    };
    const onFocus = () => void loadUsage();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void loadUsage();
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadUsage();
    }, 30_000);
    window.addEventListener(USAGE_UPDATED_EVENT, onUsageUpdated);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(USAGE_UPDATED_EVENT, onUsageUpdated);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadUsage]);

  const contextValue = useMemo<UsageContextValue>(() => ({
    ...usageState,
    refreshUsage: loadUsage,
  }), [loadUsage, usageState]);

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
