import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SUBTITLE_TEMPLATE_DISCOVERY_DEFAULT_ID,
  SUBTITLE_TEMPLATE_DISCOVERY_STORAGE_KEY,
  subtitleTemplateDiscoverySteps,
} from "./subtitle-template-discovery";

const shortsAppSource = readFileSync(
  new URL("../app/shorts-app.tsx", import.meta.url),
  "utf8",
);
const discoveryOverlaySource = readFileSync(
  new URL("../components/subtitle-template-discovery-overlay.tsx", import.meta.url),
  "utf8",
);
const sourceRangeGuideSource = readFileSync(
  new URL("../components/source-range-guide.tsx", import.meta.url),
  "utf8",
);

describe("subtitle template discovery", () => {
  it("introduces the highlight template with a direct CTA", () => {
    expect(SUBTITLE_TEMPLATE_DISCOVERY_DEFAULT_ID).toBe("highlight");
    expect(SUBTITLE_TEMPLATE_DISCOVERY_STORAGE_KEY).toBe(
      "easycut:subtitle-template-used:v1",
    );
    expect(subtitleTemplateDiscoverySteps[0].title).toBe(
      "자막 템플릿이 생겼어요!",
    );
    expect(discoveryOverlaySource).toContain(
      'lastStepPrimaryLabel="자막 템플릿 써보기"',
    );
  });

  it("waits for the source-range guide and skips known users", () => {
    expect(sourceRangeGuideSource).toContain("onClose={reportComplete}");
    expect(sourceRangeGuideSource).toContain("reportComplete();");
    expect(shortsAppSource).toContain("sourceRangeGuideComplete");
    expect(shortsAppSource).toContain("state?.hasUsedSubtitleTemplates === false");
    expect(shortsAppSource).toContain("onComplete={completeSourceRangeGuide}");
  });

  it("selects the highlight style before mounting the subtitle position guide", () => {
    expect(shortsAppSource).toContain(
      "setSubtitleTemplateId(SUBTITLE_TEMPLATE_DISCOVERY_DEFAULT_ID)",
    );
    expect(shortsAppSource).toContain('setTemplateId("dark-minimal")');
    expect(shortsAppSource).toContain(
      "enabled={subtitleTemplateSelectionEnabled && Boolean(subtitleTemplateId)}",
    );
  });
});
