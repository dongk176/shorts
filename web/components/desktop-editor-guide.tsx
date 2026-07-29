"use client";

import { useMemo } from "react";
import { FeatureGuideOverlay } from "@/components/feature-guide-overlay";
import {
  DESKTOP_EDITOR_GUIDE_MEDIA_QUERY,
  DESKTOP_EDITOR_GUIDE_STORAGE_KEY,
  desktopEditorGuideStepsFor,
} from "@/lib/desktop-editor-guide";

export function DesktopEditorGuide({
  enabled,
  rangeControlsAvailable,
  commentControlsAvailable,
}: {
  enabled: boolean;
  rangeControlsAvailable: boolean;
  commentControlsAvailable: boolean;
}) {
  const guideSteps = useMemo(() => desktopEditorGuideStepsFor({
    rangeControlsAvailable,
    commentControlsAvailable,
  }), [commentControlsAvailable, rangeControlsAvailable]);

  return (
    <FeatureGuideOverlay
      enabled={enabled}
      steps={guideSteps}
      storageKey={DESKTOP_EDITOR_GUIDE_STORAGE_KEY}
      mediaQuery={DESKTOP_EDITOR_GUIDE_MEDIA_QUERY}
      closeAriaLabel="편집 가이드 닫기"
    />
  );
}
