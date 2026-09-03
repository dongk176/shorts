import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ADMIN_BILLING_ORDER_PAGE_SIZE,
  decodeBillingOrderCursor,
} from "./admin-billing-orders";

const loaderSource = readFileSync(new URL("./admin-billing-orders.ts", import.meta.url), "utf8");
const dashboardSource = readFileSync(
  new URL("../app/admin/easycutcutcutcutcutcut/admin-billing-dashboard.tsx", import.meta.url),
  "utf8",
);

describe("administrator billing pagination", () => {
  const filters = { status: "all", provider: "all", query: "" };

  it("validates that a cursor belongs to the active filters", () => {
    const value = Buffer.from(JSON.stringify({
      v: 1,
      createdAt: "2026-09-03T00:00:00.000Z",
      id: "11111111-1111-4111-8111-111111111111",
      filters,
    })).toString("base64url");
    expect(decodeBillingOrderCursor(value, filters)?.id).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(() => decodeBillingOrderCursor(value, { ...filters, status: "succeeded" }))
      .toThrow("결제 주문 목록 위치가 올바르지 않습니다.");
    expect(() => decodeBillingOrderCursor("broken", filters))
      .toThrow("결제 주문 목록 위치가 올바르지 않습니다.");
  });

  it("selects at most 21 order ids before detailed enrichment", () => {
    expect(ADMIN_BILLING_ORDER_PAGE_SIZE).toBe(20);
    const selected = loaderSource.indexOf("with selected_orders as materialized");
    const bounded = loaderSource.indexOf("limit ${ADMIN_BILLING_ORDER_PAGE_SIZE + 1}");
    const enrichment = loaderSource.indexOf("left join lateral", bounded);
    expect(selected).toBeGreaterThan(-1);
    expect(bounded).toBeGreaterThan(selected);
    expect(enrichment).toBeGreaterThan(bounded);
    expect(loaderSource).toContain("cursor?: string | null");
    expect(loaderSource).toContain("offset?: number");
  });

  it("auto-loads while retaining retry and manual fallback", () => {
    expect(dashboardSource).toContain("IntersectionObserver");
    expect(dashboardSource).toContain("orderRequestInFlight.current");
    expect(dashboardSource).toContain("knownIds.has(order.id)");
    expect(dashboardSource).toContain('"다시 시도"');
    expect(dashboardSource).toContain('"더보기"');
  });
});
