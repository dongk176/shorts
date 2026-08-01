import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./thepayone-payment-overlay.tsx", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

describe("ThePayOne payment overlay", () => {
  it("can hide the visible step title while retaining an accessible dialog name", () => {
    expect(source).toContain("title?: string | null");
    expect(source).toContain('aria-label={title ? undefined : "더페이원 결제"}');
    expect(source).toContain("{title && (");
  });

  it("allows checkout flows to handle the primary click before native validation", () => {
    expect(source).toContain("onPrimaryClick?:");
    expect(source).toContain("onClick={onPrimaryClick}");
  });

  it("grows with progressive checkout content on desktop before scrolling", () => {
    expect(source).toContain("sm:h-auto");
    expect(source).toContain("sm:max-h-[calc(100dvh-4rem)]");
    expect(source).toContain("sm:flex-auto");
    expect(source).toContain("thepayone-payment-dialog");
    expect(source).toContain("thepayone-payment-content");
    expect(globalStyles).toContain(
      '.thepayone-payment-dialog:has([data-card-issuer-trigger][aria-expanded="true"])',
    );
    expect(globalStyles).toContain("min-height: min(36rem,calc(100dvh - 4rem))");
    expect(globalStyles).toContain("padding-top: 4.5rem");
  });
});
