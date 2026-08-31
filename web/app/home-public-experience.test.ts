import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const homeSource = readFileSync(
  new URL("./shorts-app.tsx", import.meta.url),
  "utf8",
);
const backgroundShowcaseSource = readFileSync(
  new URL("../components/background-showcase.tsx", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(
  new URL("./globals.css", import.meta.url),
  "utf8",
);
const pricingStyles = readFileSync(
  new URL("./pricing/pricing.module.css", import.meta.url),
  "utf8",
);

describe("public home experience", () => {
  it("shows public example projects without exposing the signed-in usage pill", () => {
    expect(homeSource).toContain("{state?.recentJobs.length ? <section id=\"results\"");
    expect(homeSource).toContain('state.user ? t("home.projects") : t("home.exampleProjects")');
    expect(homeSource).not.toContain("state.billing.planCode.toUpperCase()");
  });

  it("keeps the URL workspace full width and removes the decorative convert icon", () => {
    expect(homeSource).toContain("hero mx-auto flex w-full max-w-4xl");
    expect(homeSource).toContain('className={`url-console w-full max-w-3xl ${uploadModeVisible ? "mt-3" : "mt-8"}`}');
    expect(homeSource).not.toContain('<span aria-hidden="true">✦</span>');
    expect(homeSource).not.toContain('t("home.heroDescription")');
  });
});

describe("continuous showcase motion", () => {
  it("uses animation frames and fractional movement for both rails", () => {
    expect(homeSource).toContain("animationFrame = window.requestAnimationFrame(animate)");
    expect(backgroundShowcaseSource).toContain("animationFrame = window.requestAnimationFrame(animate)");
    expect(homeSource).not.toContain("window.setInterval(animate, 16)");
    expect(backgroundShowcaseSource).not.toContain("window.setInterval(animate, 16)");
  });
});

describe("continuous public gradients", () => {
  it("joins the process and review sections on one transparent background", () => {
    expect(globalStyles).toMatch(/section\.three-step-process-section\s*\{[\s\S]*?background:\s*transparent;/);
    expect(globalStyles).toMatch(/\.background-showcase-rail\s*\{[\s\S]*?will-change:\s*scroll-position;/);
    expect(globalStyles).toMatch(/\.customer-review-rail\s*\{[\s\S]*?will-change:\s*scroll-position;/);
  });

  it("uses softened multi-stop gradients on the pricing surface and controls", () => {
    expect(globalStyles).toMatch(/\.pricing-main::after\s*\{\s*content:\s*none;/);
    expect(globalStyles).toContain("#ff8b7b 30%");
    expect(pricingStyles).toContain("#f75a49 48%");
    expect(pricingStyles).toContain("#c9aeff 52%");
  });
});
