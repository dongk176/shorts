export const SIDEBAR_NAVIGATION_CAMPAIGN_CODE = "sidebar_navigation_v1";

export type SidebarNavigationAnnouncement = {
  campaignCode: typeof SIDEBAR_NAVIGATION_CAMPAIGN_CODE;
};

const desktopSidebarPaths = [
  "/",
  "/projects",
  "/templates",
  "/pricing",
  "/settings",
  "/popular",
  "/실시간인기",
] as const;

export function isDesktopSidebarPath(pathname: string) {
  let decodedPathname = pathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    // Keep the framework-provided pathname when it is not URI encoded.
  }
  return desktopSidebarPaths.some((path) => decodedPathname === path);
}

export function shouldClaimSidebarNavigationAnnouncement(input: {
  authenticated: boolean;
  queueActive: boolean;
  pathname: string;
  desktop: boolean;
  sidebarVisible: boolean;
}) {
  return input.authenticated
    && input.queueActive
    && input.desktop
    && input.sidebarVisible
    && isDesktopSidebarPath(input.pathname);
}
