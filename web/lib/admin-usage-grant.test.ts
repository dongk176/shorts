import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ADMIN_USAGE_GRANT_PRODUCT_CODE,
  ADMIN_USAGE_GRANT_VALIDITY_DAYS,
} from "./admin-usage-grant";

const billingSource = readFileSync(new URL("./billing.ts", import.meta.url), "utf8");
const usageSource = readFileSync(new URL("./usage.ts", import.meta.url), "utf8");
const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202607300013_admin_member_usage_grants.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("administrator member usage grants", () => {
  it("uses an explicit product code and validity period", () => {
    expect(ADMIN_USAGE_GRANT_PRODUCT_CODE).toBe("admin_manual_usage_v1");
    expect(ADMIN_USAGE_GRANT_VALIDITY_DAYS).toBe(365);
  });

  it("is recognized by billing, usage display, and transactional reservation", () => {
    expect(billingSource).toContain("ADMIN_USAGE_GRANT_PRODUCT_CODE");
    expect(usageSource).toContain("ADMIN_USAGE_GRANT_PRODUCT_CODE");
    expect(migration).toContain("'admin_manual_usage_v1'");
    expect(migration).toContain(
      "create or replace function shorts_mvp.reserve_usage_grants",
    );
    expect(migration).toContain("complimentary_only");
  });
});
