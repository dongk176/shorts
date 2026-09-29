"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useUsageState } from "@/components/usage-provider";
import {
  nextWelcomeOverlayStage,
  type WelcomeOverlayStage,
} from "@/lib/welcome-overlay-queue";

type WelcomeOverlayQueueContextValue = {
  stage: WelcomeOverlayStage;
  complete: (stage: Exclude<WelcomeOverlayStage, "done">) => void;
};

const WelcomeOverlayQueueContext =
  createContext<WelcomeOverlayQueueContextValue | null>(null);

export function WelcomeOverlayQueueProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { accountId, authenticated } = useUsageState();
  const [stage, setStage] = useState<WelcomeOverlayStage>(
    "youtube-launch",
  );

  useEffect(() => {
    setStage("youtube-launch");
  }, [accountId, authenticated]);

  const complete = useCallback(
    (completedStage: Exclude<WelcomeOverlayStage, "done">) => {
      setStage((current) => (
        current === completedStage
          ? completedStage === "youtube-launch" && !authenticated ? "done" : nextWelcomeOverlayStage(completedStage)
          : current
      ));
    },
    [authenticated],
  );

  const value = useMemo(
    () => ({ stage, complete }),
    [complete, stage],
  );

  return (
    <WelcomeOverlayQueueContext.Provider value={value}>
      {children}
    </WelcomeOverlayQueueContext.Provider>
  );
}

export function useWelcomeOverlayStage(
  requestedStage: Exclude<WelcomeOverlayStage, "done">,
) {
  const value = useContext(WelcomeOverlayQueueContext);
  const completeStage = value?.complete;
  const completeRequestedStage = useCallback(() => {
    completeStage?.(requestedStage);
  }, [completeStage, requestedStage]);
  if (!value) {
    throw new Error(
      "useWelcomeOverlayStage must be used within WelcomeOverlayQueueProvider.",
    );
  }
  return {
    active: value.stage === requestedStage,
    complete: completeRequestedStage,
  };
}
