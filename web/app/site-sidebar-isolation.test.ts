import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const desktopSidebarPages = [
  "./shorts-app.tsx",
  "./projects/page.tsx",
  "./templates/page.tsx",
  "./pricing/pricing-page-shell.tsx",
  "./settings/settings-page-content.tsx",
  "./실시간인기/popular-page-shell.tsx",
];

const editorPages = [
  "./projects/[projectNumber]/edit/[shortId]/page.tsx",
  "./templates/[templateId]/edit/page.tsx",
];

describe("site sidebar isolation", () => {
  it.each(desktopSidebarPages)(
    "enables the desktop sidebar on %s",
    (pagePath) => {
      const pageSource = source(pagePath);
      expect(pageSource).toContain("desktop-sidebar-layout");
      expect(pageSource).toContain("<SiteHeader desktopSidebar");
    },
  );

  it.each(editorPages)(
    "does not add site navigation chrome to %s",
    (pagePath) => {
      const pageSource = source(pagePath);
      expect(pageSource).not.toContain("desktop-sidebar-layout");
      expect(pageSource).not.toContain("SiteHeader");
    },
  );

  it("keeps site-only CSS out of both editor style namespaces", () => {
    const sidebarStyles = source("./site-sidebar.css");
    expect(sidebarStyles).not.toMatch(/\.editor-/);
    expect(sidebarStyles).not.toContain(".editor-v2-root");
  });
});
