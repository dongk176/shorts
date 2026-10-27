"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
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
  requestRankingEntry: () => void;
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
  // Start at an active stage. Resetting in a parent effect can overwrite a
  // child's synchronous completion and strand every later announcement.
  const identity = `${authenticated}:${accountId || "pending"}`;
  const initialStage = authenticated ? nextWelcomeOverlayStage("youtube-launch") : "done";
  const [queue, setQueue] = useState({ identity, stage: initialStage });
  // Reset before children render without remounting the application subtree.
  if (queue.identity !== identity) setQueue({ identity, stage: initialStage });
  const stage = queue.identity === identity ? queue.stage : initialStage;

  const complete = useCallback(
    (completedStage: Exclude<WelcomeOverlayStage, "done">) => {
      setQueue((current) => (
        current.identity === identity && current.stage === completedStage
          ? { identity, stage: nextWelcomeOverlayStage(completedStage) }
          : current
      ));
    },
    [identity],
  );

  const requestRankingEntry = useCallback(() => {
    setQueue(current => current.identity === identity && ["feedback", "done"].includes(current.stage)
      ? { ...current, stage: "ranking-launch" } : current);
  }, [identity]);
  const value = useMemo(
    () => ({ stage, complete, requestRankingEntry }),
    [complete, stage, requestRankingEntry],
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


export function useRequestRankingEntry() { return useContext(WelcomeOverlayQueueContext)!.requestRankingEntry; }
