import { describe, expect, it } from "vitest";
import {
  isDesktopSidebarPath,
  shouldClaimSidebarNavigationAnnouncement,
} from "./sidebar-navigation-announcement";

describe("sidebar navigation announcement paths", () => {
  it.each([
    "/",
    "/projects",
    "/templates",
    "/pricing",
    "/settings",
    "/popular",
    "/실시간인기",
    "/%EC%8B%A4%EC%8B%9C%EA%B0%84%EC%9D%B8%EA%B8%B0",
  ])("accepts a page with the desktop site sidebar: %s", (pathname) => {
    expect(isDesktopSidebarPath(pathname)).toBe(true);
  });

  it.each([
    "/projects/1211/edit/short-id",
    "/auth/sign-in",
    "/admin",
  ])("does not accept excluded pages: %s", (pathname) => {
    expect(isDesktopSidebarPath(pathname)).toBe(false);
  });

  it("never claims on mobile or without the visible site sidebar", () => {
    const base = {
      authenticated: true,
      queueActive: true,
      pathname: "/",
      desktop: true,
      sidebarVisible: true,
    };
    expect(shouldClaimSidebarNavigationAnnouncement(base)).toBe(true);
    expect(shouldClaimSidebarNavigationAnnouncement({
      ...base,
      desktop: false,
    })).toBe(false);
    expect(shouldClaimSidebarNavigationAnnouncement({
      ...base,
      sidebarVisible: false,
    })).toBe(false);
  });
});
