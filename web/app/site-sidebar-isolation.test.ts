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
  "./easycut-private/page.tsx",
  "./account/activity/page.tsx",
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

  it("uses compact icon navigation and a gradient active state", () => {
    const header = source("../components/site-header.tsx");
    const sidebarStyles = source("./site-sidebar.css");

    expect(header).toContain("function NavigationIcon");
    expect(header).toContain("site-nav-icon-frame");
    expect(header).toContain("site-nav-icon");
    expect(sidebarStyles).toContain("--site-sidebar-width: 224px");
    expect(sidebarStyles).toContain("linear-gradient(100deg,rgba(91,68,210,.34),rgba(240,68,53,.28))");
    expect(sidebarStyles).toContain('nav-link[aria-current="page"]');
    expect(sidebarStyles).toContain("color: #fff;");
    expect(sidebarStyles).toContain("width: 22px;");
  });

  it("renders the signed-in nickname as text instead of an activity link", () => {
    const controls = source("../components/auth-controls.tsx");
    const nicknameBlock = controls.slice(
      controls.indexOf("const label = user.displayName"),
      controls.indexOf('href="/settings"'),
    );

    expect(nicknameBlock).toContain("<span");
    expect(nicknameBlock).not.toContain('href="/account/activity"');
  });
});
