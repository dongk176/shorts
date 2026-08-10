import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SUBTITLE_POSITION_GUIDE_STORAGE_KEY,
  subtitlePositionGuideSteps,
} from "./subtitle-position-guide";

const shortsAppSource = readFileSync(
  new URL("../app/shorts-app.tsx", import.meta.url),
  "utf8",
);
const guideComponentSource = readFileSync(
  new URL("../components/subtitle-position-guide.tsx", import.meta.url),
  "utf8",
);

describe("subtitle position guide", () => {
  it("explains lower and center use cases before completing", () => {
    expect(subtitlePositionGuideSteps.map((step) => step.id)).toEqual([
      "lower",
      "center",
      "complete",
    ]);
    expect(subtitlePositionGuideSteps[0].description).toContain("원본 영상에 자막이 없을 때");
    expect(subtitlePositionGuideSteps[1].description).toContain("자막이 간헐적으로 나오거나");
    expect(subtitlePositionGuideSteps.at(-1)?.targetSelector).toBeNull();
  });

  it("uses a versioned, one-time dismissal key", () => {
    expect(SUBTITLE_POSITION_GUIDE_STORAGE_KEY).toBe(
      "easycut:subtitle-position-guide-dismissed:v1",
    );
  });

  it("targets both position cards and mounts only after subtitle selection", () => {
    expect(subtitlePositionGuideSteps[0].targetSelector).toBe(
      '[data-subtitle-position-guide="lower"]',
    );
    expect(subtitlePositionGuideSteps[1].targetSelector).toBe(
      '[data-subtitle-position-guide="center"]',
    );
    expect(shortsAppSource).toContain("data-subtitle-position-guide={position.value}");
    expect(shortsAppSource).toContain(
      "enabled={subtitleTemplateSelectionEnabled && Boolean(subtitleTemplateId)}",
    );
    expect(guideComponentSource).toContain('closeAriaLabel="자막 위치 가이드 닫기"');
  });
});
