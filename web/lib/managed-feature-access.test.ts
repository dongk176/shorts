import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("administrator-issued account paid feature access", () => {
  it("derives every paid feature from an active issued account without an expiry dependency", () => {
    const billing = source("web/lib/billing.ts");
    const managedFeatureQuery = billing
      .split("as has_manual_service_access,")[1]
      ?.split("as has_onboarding_welcome_access")[0] || "";
    expect(managedFeatureQuery).toContain("managed.is_active=true");
    expect(managedFeatureQuery).not.toContain("manual_service_access_until");
  });

  it("uses the same unconditional issued-account rule for popular filters and usage evidence", () => {
    const entitlement = source("web/lib/popular-entitlements.ts");
    const usage = source("web/lib/popular-filter-usage.ts");
    const page = source("web/app/실시간인기/page.tsx");
    expect(entitlement).toContain("managed.is_active=true");
    expect(entitlement).not.toContain("popular_filter_enabled");
    expect(usage).toContain("managed.is_active=true");
    expect(usage).not.toContain("popular_filter_enabled");
    expect(page).toContain("managedPopularFilterOverride(db, appUserId)");
    expect(page).not.toContain("popular_filter_enabled");
  });

  it("removes the filter checkbox from both issued-account create and edit flows", () => {
    const dashboard = source("web/app/admin/easycutcutcutcutcutcut/admin-managed-accounts-dashboard.tsx");
    const createRoute = source("web/app/api/admin/managed-accounts/route.ts");
    const updateRoute = source("web/app/api/admin/managed-accounts/[accountId]/route.ts");
    expect(dashboard).toContain("유료 기능이 자동으로 허용됩니다");
    expect(dashboard).not.toContain("실시간 인기 필터 허용");
    expect(dashboard).not.toContain("실시간 인기 필터도 허용");
    expect(createRoute).not.toContain("popularFilterEnabled");
    expect(updateRoute).not.toContain("popularFilterEnabled");
  });

  it("backfills the legacy flag and makes future issued accounts default to enabled", () => {
    const migration = source("supabase/migrations/202608260002_managed_account_paid_features.sql");
    expect(migration).toContain("alter column popular_filter_enabled set default true");
    expect(migration).toContain("set popular_filter_enabled=true");
    expect(migration).not.toMatch(/\bpublic\./i);
  });
});
