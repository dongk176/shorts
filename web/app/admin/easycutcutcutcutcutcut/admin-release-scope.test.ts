import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("./admin-shell.tsx", import.meta.url), "utf8");
const billingRouteSource = readFileSync(
  new URL("../../api/admin/billing/orders/route.ts", import.meta.url),
  "utf8",
);
const billingDashboardSource = readFileSync(
  new URL("./admin-billing-dashboard.tsx", import.meta.url),
  "utf8",
);
const overlayQueueSource = readFileSync(
  new URL("../../../lib/welcome-overlay-queue.ts", import.meta.url),
  "utf8",
);

describe("administrator onboarding release scope", () => {
  it("preserves production billing pagination and editor release management", () => {
    expect(pageSource).not.toContain("loadAdminBillingOrders");
    expect(pageSource).toContain("<AdminBillingDashboard");
    expect(billingRouteSource).toContain("loadAdminBillingOrders");
    expect(billingDashboardSource).toContain("nextOrderCursor");
    expect(billingDashboardSource).toContain("/api/admin/billing/supporting-data");
    expect(shellSource).toContain('{ tab: "editor-releases"');
    expect(pageSource).toContain('tab === "editor-releases"');
    expect(pageSource).toContain("<AdminEditorReleases");
  });

  it("adds the retired event stage without removing the sidebar announcement", () => {
    expect(overlayQueueSource).toContain('"sidebar-navigation"');
    expect(overlayQueueSource).toContain('"shorts-event"');
    expect(overlayQueueSource.indexOf('"sidebar-navigation"')).toBeLessThan(
      overlayQueueSource.indexOf('"shorts-event"'),
    );
  });
});
