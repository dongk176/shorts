import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { channelContrastStyle, channelContrastColor, editorHasChannelContrast } from "./channel-contrast";
const cases = JSON.parse(readFileSync(new URL("../../test-fixtures/channel-contrast.json", import.meta.url), "utf8"));
describe("channel contrast shared geometry", () => {
  for (const item of cases) it(item.name, () => {
    const [x, y, width, height] = item.video;
    const [cx, cy, maxWidth, fontSize] = item.channel;
    const result = channelContrastStyle({ video: { x, y, width, height } }, { x: cx, y: cy, maxWidth, fontSize, color: item.color, backgroundColor: item.background });
    expect(Boolean(result.WebkitTextStroke)).toBe(item.active);
    if (item.active) expect(channelContrastColor(item.color)).toBe(item.stroke);
  });
  it("responds to editor movement and scaling", () => {
    const video = { x: 0, y: 300, width: 1080, height: 1000 };
    const channel = { x: 540, y: 1700, maxWidth: 800, fontSize: 48, color: "#FFFFFF" };
    expect(channelContrastStyle({ video }, channel)).toEqual({});
    expect(channelContrastStyle({ video, offset: { x: 0, y: -450 }, scale: 1.5 }, channel).WebkitTextStroke).toBeDefined();
  });
});

it("keeps previews compatible with older pinned renderers", () => {
 expect(editorHasChannelContrast(null)).toBe(false);
 expect(editorHasChannelContrast("3c559307-a495-4082-9ac8-d5d9147452b9")).toBe(false);
});
