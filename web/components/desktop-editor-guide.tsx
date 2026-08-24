"use client";

import { useMemo } from "react";
import { FeatureGuideOverlay } from "@/components/feature-guide-overlay";
import {
  DESKTOP_EDITOR_GUIDE_MEDIA_QUERY,
  DESKTOP_EDITOR_GUIDE_STORAGE_KEY,
  OVERLAY_DESKTOP_EDITOR_GUIDE_STORAGE_KEY,
  desktopEditorGuideStepsFor,
} from "@/lib/desktop-editor-guide";

export function DesktopEditorGuide({
  enabled,
  rangeControlsAvailable,
  commentControlsAvailable,
  overlayPreviewEnabled,
  editorSaveEnabled,
}: {
  enabled: boolean;
  rangeControlsAvailable: boolean;
  commentControlsAvailable: boolean;
  overlayPreviewEnabled: boolean;
  editorSaveEnabled: boolean;
}) {
  const guideSteps = useMemo(() => desktopEditorGuideStepsFor({
    rangeControlsAvailable,
    commentControlsAvailable,
    overlayPreviewEnabled,
    editorSaveEnabled,
  }), [
    commentControlsAvailable,
    editorSaveEnabled,
    overlayPreviewEnabled,
    rangeControlsAvailable,
  ]);

  return (
    <FeatureGuideOverlay
      enabled={enabled}
      steps={guideSteps}
      storageKey={overlayPreviewEnabled
        ? OVERLAY_DESKTOP_EDITOR_GUIDE_STORAGE_KEY
        : DESKTOP_EDITOR_GUIDE_STORAGE_KEY}
      mediaQuery={DESKTOP_EDITOR_GUIDE_MEDIA_QUERY}
      closeAriaLabel="편집 가이드 닫기"
      smoothTransitions={overlayPreviewEnabled}
    />
  );
}
