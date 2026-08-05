import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./feature-guide-overlay.tsx", import.meta.url),
  "utf8",
);

describe("feature guide step transitions", () => {
  it("measures the next target before paint and avoids unnecessary scrolling", () => {
    expect(source).toContain("useLayoutEffect(() => {");
    expect(source).toContain("if (!smoothTransitions) return;");
    expect(source).toContain("targetNeedsScroll(initialRect)");
    expect(source).toContain("setTargetRect(elementRect(activeTarget))");
  });

  it("animates the card and spotlight between nearby targets", () => {
    expect(source).toContain(
      "transition-[left,top,width,height,border-radius] duration-200 ease-out",
    );
    expect(source).toContain(
      "transition-[left,top,width,transform] duration-200 ease-out",
    );
  });

  it("can center a requested target without changing other guides", () => {
    expect(source).toContain('step.scrollBlock === "center"');
    expect(source).toContain('block: step.scrollBlock || "nearest"');
  });
});
