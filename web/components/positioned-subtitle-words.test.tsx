import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  POSITIONED_SUBTITLE_JOINED_WORD_GAP_PX,
  POSITIONED_SUBTITLE_WORD_GAP_PX,
  centeredAdvanceWordBoxes,
} from "./positioned-subtitle-layout";

const componentSource = readFileSync(
  new URL("./positioned-subtitle-words.tsx", import.meta.url),
  "utf8",
);

describe("positioned subtitle words", () => {
  it("centers advance boxes with the V4 6px and 0px gap semantics", () => {
    const spaced = centeredAdvanceWordBoxes([
      { advanceWidth: 100, gapBefore: 0 },
      { advanceWidth: 80, gapBefore: POSITIONED_SUBTITLE_WORD_GAP_PX },
    ], 540, 1_100);
    const joined = centeredAdvanceWordBoxes([
      { advanceWidth: 100, gapBefore: 0 },
      { advanceWidth: 80, gapBefore: POSITIONED_SUBTITLE_JOINED_WORD_GAP_PX },
    ], 540, 1_100);

    expect(spaced).toEqual([
      { centerX: 497, centerY: 1_100, advanceWidth: 100, gapBefore: 0 },
      { centerX: 593, centerY: 1_100, advanceWidth: 80, gapBefore: 6 },
    ]);
    expect(joined).toEqual([
      { centerX: 500, centerY: 1_100, advanceWidth: 100, gapBefore: 0 },
      { centerX: 590, centerY: 1_100, advanceWidth: 80, gapBefore: 0 },
    ]);
  });

  it("renders absolute advance boxes without inserting separator text nodes", () => {
    expect(componentSource).toContain(
      'data-caption-layout-mode="absolute-word-positions-v1"',
    );
    expect(componentSource).toContain('data-positioned-subtitle-word=""');
    expect(componentSource).toContain("width: `${position.advanceWidth * layoutScale / canvasWidthUnit}cqw`");
    expect(componentSource).toContain(">{word.text}</span>");
    expect(componentSource).not.toContain('? " " : null');
    expect(componentSource).not.toContain("fontSizeScale");
    expect(componentSource).toContain("cssToAssScale < 0.5");
    expect(componentSource).toContain("cssToAssScale > 1.5");
    expect(componentSource).toContain(
      "word.fontSize * layoutScale * cssToAssScale / canvasWidthUnit",
    );
    expect(componentSource.match(
      /word\.fontSize \* layoutScale \* cssToAssScale/g,
    )).toHaveLength(1);
    expect(componentSource).toContain(
      "active && activeWordScale !== 1",
    );
    expect(componentSource.match(
      /`scale\(\$\{activeWordScale\}\)`/g,
    )).toHaveLength(1);
  });
});
