"use client";

import { useMemo } from "react";
import { FeatureGuideOverlay } from "@/components/feature-guide-overlay";
import {
  PROJECT_ACTION_GUIDE_STORAGE_KEY,
  projectActionGuideStepsFor,
} from "@/lib/project-action-guide";

export function ProjectActionGuide({
  enabled,
  editAvailable,
  downloadAvailable,
  bulkDownloadAvailable,
}: {
  enabled: boolean;
  editAvailable: boolean;
  downloadAvailable: boolean;
  bulkDownloadAvailable: boolean;
}) {
  const guideSteps = useMemo(() => projectActionGuideStepsFor({
    editAvailable,
    downloadAvailable,
    bulkDownloadAvailable,
  }), [bulkDownloadAvailable, downloadAvailable, editAvailable]);

  return (
    <FeatureGuideOverlay
      enabled={enabled}
      steps={guideSteps}
      storageKey={PROJECT_ACTION_GUIDE_STORAGE_KEY}
      closeAriaLabel="프로젝트 가이드 닫기"
      tone="blue"
    />
  );
}
