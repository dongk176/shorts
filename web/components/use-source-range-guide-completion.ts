"use client";

import { useCallback, useState } from "react";

// Child guides can report an already-saved dismissal during their first effect.
// Derive completion from the source key instead of resetting it in a parent effect.
export function useSourceRangeGuideCompletion(sourceKey: string | null, required: boolean) {
  const [completedKey, setCompletedKey] = useState<string | null>(null);
  const complete = useCallback(() => setCompletedKey(sourceKey), [sourceKey]);
  const reset = useCallback(() => setCompletedKey(null), []);
  return { completed: sourceKey !== null && (!required || completedKey === sourceKey), complete, reset };
}
