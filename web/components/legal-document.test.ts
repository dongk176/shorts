import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const componentSource = readFileSync(
  new URL("./legal-document.tsx", import.meta.url),
  "utf8",
);
const globalCssSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const supportPageSource = readFileSync(
  new URL("../app/support/page.tsx", import.meta.url),
  "utf8",
);

describe("legal document text protection", () => {
  it("prevents selecting, copying, and dragging legal document text", () => {
    expect(componentSource).toContain('preventTextSelection = true');
    expect(componentSource).toContain('preventTextSelection ? "legal-document-page "');
    expect(componentSource).toContain("onCopy={preventTextSelection ? (event) => event.preventDefault() : undefined}");
    expect(componentSource).toContain("onDragStart={preventTextSelection ? (event) => event.preventDefault() : undefined}");
    expect(globalCssSource).toContain(".legal-document-page *");
    expect(globalCssSource).toContain("-webkit-user-select: none;");
    expect(globalCssSource).toContain("user-select: none;");
    expect(globalCssSource).toContain("-webkit-touch-callout: none;");
  });

  it("keeps customer support contact details selectable", () => {
    expect(supportPageSource).toContain("preventTextSelection={false}");
  });
});
