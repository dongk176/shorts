"use client";

import { FeatureGuideOverlay } from "@/components/feature-guide-overlay";
import {
  SOURCE_RANGE_GUIDE_STORAGE_KEY,
  sourceRangeGuideSteps,
} from "@/lib/source-range-guide";

export function SourceRangeGuide({ enabled }: { enabled: boolean }) {
  return (
    <FeatureGuideOverlay
      enabled={enabled}
      steps={sourceRangeGuideSteps}
      storageKey={SOURCE_RANGE_GUIDE_STORAGE_KEY}
      closeAriaLabel="구간 선택 가이드 닫기"
      smoothTransitions
    />
  );
}
