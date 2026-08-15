import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202607290001_paid_usage_before_complimentary.sql",
    import.meta.url,
  ),
  "utf8",
);
describe("paid and complimentary usage accounting", () => {
  it("records an explicit funding source derived from the billing order", () => {
    expect(migration).toContain("add column if not exists funding_source text");
    expect(migration).toContain("when billing_order_id is not null then 'paid'");
    expect(migration).toContain("else 'complimentary'");
  });

  it("reserves every paid grant before complimentary grants", () => {
    expect(migration).toContain(
      "case when grant_item.funding_source='paid' then 0 else 1 end",
    );
    expect(migration).toContain(
      "when grant_item.funding_source='complimentary'",
    );
  });

});
