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
const overviewSource = readFileSync(
  new URL("../../../lib/admin-overview.ts", import.meta.url),
  "utf8",
);
const membersDashboardSource = readFileSync(
  new URL("./admin-members-dashboard.tsx", import.meta.url),
  "utf8",
);
const memberLoaderSource = readFileSync(
  new URL("../../../lib/admin-members.ts", import.meta.url),
  "utf8",
);
const memberRouteSource = readFileSync(
  new URL("../../api/admin/members/route.ts", import.meta.url),
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
    expect(pageSource).toContain("tester_user.email");
    expect(pageSource).not.toContain("user.email,user.display_name");
  });

  it("does not prefetch every expensive administrator tab", () => {
    expect(shellSource).toContain("prefetch={false}");
    expect(shellSource).toContain("href={`/admin/easycutcutcutcutcutcut?tab=${item.tab}`}");
  });

  it("repairs a stalled local database pool before admin authentication", () => {
    const healthCheck = pageSource.indexOf("await ensureLocalDbReady();");
    const authentication = pageSource.indexOf("admin = await requireAdminUser();");

    expect(healthCheck).toBeGreaterThan(-1);
    expect(authentication).toBeGreaterThan(healthCheck);
  });

  it("presents approved positive payment amounts as sales", () => {
    expect(overviewSource).toContain(
      "coalesce(sum(amount_krw),0)::bigint as sales",
    );
    expect(overviewSource).toContain("and amount_krw>0");
    expect(overviewSource).toContain("revalidate: 30");
    expect(pageSource).toContain("loadAdminOverview()");
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

  it("loads only 100 detailed member rows at a time", () => {
    expect(memberLoaderSource).toContain("ADMIN_MEMBER_PAGE_SIZE = 100");
    expect(memberLoaderSource).toContain("with filtered_users as materialized");
    expect(memberLoaderSource).toContain("limit ${ADMIN_MEMBER_PAGE_SIZE + 1}");
    expect(memberRouteSource).toContain("await requireAdminUser();");
    expect(membersDashboardSource).toContain('"더보기"');
    expect(membersDashboardSource).toContain("setLoadedMembers");
    expect(pageSource).not.toContain("const memberRows");
  });
});
