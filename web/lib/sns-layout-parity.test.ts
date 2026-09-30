import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { SnsTemplatePreview, snsVideoFrames } from "../components/sns-template-preview";

describe("SNS top safe area", () => {
  it.each(["16:9", "5:4", "1:1", "4:5", "9:16"] as const)("preserves all content for %s", ratio => {
    const offset = ratio === "4:5" || ratio === "9:16" ? 0 : 150;
    const html = renderToStaticMarkup(createElement(SnsTemplatePreview, {
      ratio, brandColor: "#DB2777", channelName: "Channel",
      channelThumbnailUrl: null, thumbnailUrl: "https://example.com/image.jpg",
    }));
    expect(html).toContain(`transform="translate(0 ${offset})"`);
    const [, y, , height] = snsVideoFrames[ratio];
    expect(y + height + offset + 30).toBeLessThanOrEqual(1920);
  });
  it("uses the same offset as the worker", () => {
    const source = readFileSync(new URL("../../worker/shorts_worker/sns_template.py", import.meta.url), "utf8");
    expect(source).toContain('offset_y = 150 if ratio in {"16:9", "5:4", "1:1"} else 0');
  });
});
