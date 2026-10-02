"use client";

import { FeatureGuideOverlay } from "@/components/feature-guide-overlay";
import {
  SUBTITLE_TEMPLATE_DISCOVERY_STORAGE_KEY,
  subtitleTemplateDiscoverySteps,
} from "@/lib/subtitle-template-discovery";

// Retired automatic introduction; subtitle template selection stays available.
const AUTO_DISCOVERY_ENABLED = false;

export function SubtitleTemplateDiscoveryOverlay({
  enabled,
  onTry,
}: {
  enabled: boolean;
  onTry: () => void;
}) {
  return (
    <FeatureGuideOverlay
      enabled={AUTO_DISCOVERY_ENABLED && enabled}
      steps={subtitleTemplateDiscoverySteps}
      storageKey={SUBTITLE_TEMPLATE_DISCOVERY_STORAGE_KEY}
      closeAriaLabel="자막 템플릿 안내 닫기"
      tone="blue"
      lastStepSecondaryLabel="나중에"
      lastStepPrimaryLabel="자막 템플릿 써보기"
      onLastStepPrimaryAction={onTry}
    />
  );
}
