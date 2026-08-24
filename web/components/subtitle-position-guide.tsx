"use client";

import { FeatureGuideOverlay } from "@/components/feature-guide-overlay";
import {
  SUBTITLE_POSITION_GUIDE_STORAGE_KEY,
  subtitlePositionGuideSteps,
} from "@/lib/subtitle-position-guide";

export function SubtitlePositionGuide({ enabled }: { enabled: boolean }) {
  return (
    <FeatureGuideOverlay
      enabled={enabled}
      steps={subtitlePositionGuideSteps}
      storageKey={SUBTITLE_POSITION_GUIDE_STORAGE_KEY}
      closeAriaLabel="자막 위치 가이드 닫기"
      tone="blue"
      smoothTransitions
    />
  );
}
