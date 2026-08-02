import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(
  new URL("./admin-shell.tsx", import.meta.url),
  "utf8",
);
const billingDashboardSource = readFileSync(
  new URL("./admin-billing-dashboard.tsx", import.meta.url),
  "utf8",
);
const billingOrderLoaderSource = readFileSync(
  new URL("../../../lib/admin-billing-orders.ts", import.meta.url),
  "utf8",
);
const billingOrderRouteSource = readFileSync(
  new URL("../../api/admin/billing/orders/route.ts", import.meta.url),
  "utf8",
);

describe("administrator shell recovery", () => {
  it("restores the latest administrator navigation and overview", () => {
    expect(shellSource).toContain("Admin Console");
    expect(shellSource).toContain("비즈니스 현황을 한눈에.");
    expect(shellSource).toContain("최근 14일 매출");
    expect(shellSource).toContain("최근 14일 회원 수 추이");
    expect(pageSource).toContain("<AdminShell");
  });

  it("keeps the editor release controls in the recovered shell", () => {
    expect(shellSource).toContain('tab: "editor-releases"');
    expect(shellSource).toContain('label: "편집기 릴리스"');
    expect(pageSource).toContain('tab === "editor-releases"');
    expect(pageSource).toContain("<AdminEditorReleases");
  });

  it("repairs a stalled local database pool before admin authentication", () => {
    const healthCheck = pageSource.indexOf("await ensureLocalDbReady();");
    const authentication = pageSource.indexOf("admin = await requireAdminUser();");

    expect(healthCheck).toBeGreaterThan(-1);
    expect(authentication).toBeGreaterThan(healthCheck);
  });

  it("presents approved positive payment amounts as sales", () => {
    expect(pageSource).toContain(
      "coalesce(sum(amount_krw),0)::bigint as sales",
    );
    expect(pageSource).toContain("and amount_krw>0");
  });

  it("loads billing orders in stable administrator-only pages of 100", () => {
    expect(billingOrderLoaderSource).toContain("ADMIN_BILLING_ORDER_PAGE_SIZE = 100");
    expect(billingOrderLoaderSource).toContain("order by o.created_at desc,o.id desc");
    expect(billingOrderLoaderSource).toContain("limit ${ADMIN_BILLING_ORDER_PAGE_SIZE + 1}");
    expect(billingOrderLoaderSource).toContain('productCode: row.productCode ? String(row.productCode) : "unknown"');
    expect(billingOrderRouteSource).toContain("await requireAdminUser();");
    expect(billingDashboardSource).toContain('"더보기"');
    expect(billingDashboardSource).toContain("setLoadedOrders");
  });
});
