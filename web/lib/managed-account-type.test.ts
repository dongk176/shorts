import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MANAGED_ACCOUNT_TYPES,
  MANAGED_ACCOUNT_TYPE_LABELS,
} from "./managed-account-type";

const migrationSource = readFileSync(
  new URL("../../supabase/migrations/202608250002_managed_account_types.sql", import.meta.url),
  "utf8",
);
const routeSource = readFileSync(
  new URL("../app/api/admin/managed-accounts/route.ts", import.meta.url),
  "utf8",
);
const sectionSource = readFileSync(
  new URL(
    "../app/admin/easycutcutcutcutcutcut/admin-managed-accounts-section.tsx",
    import.meta.url,
  ),
  "utf8",
);
const dashboardSource = readFileSync(
  new URL(
    "../app/admin/easycutcutcutcutcutcut/admin-managed-accounts-dashboard.tsx",
    import.meta.url,
  ),
  "utf8",
);

describe("managed account types", () => {
  it("supports only personal and enterprise account categories", () => {
    expect(MANAGED_ACCOUNT_TYPES).toEqual(["personal", "enterprise"]);
    expect(MANAGED_ACCOUNT_TYPE_LABELS).toEqual({
      personal: "개인",
      enterprise: "기업",
    });
  });

  it("migrates every existing account to personal by default", () => {
    expect(migrationSource).toMatch(
      /add column if not exists account_type text not null default 'personal'/,
    );
    expect(migrationSource).toContain(
      "check (account_type in ('personal','enterprise'))",
    );
  });

  it("validates and persists the selected type when an account is issued", () => {
    expect(routeSource).toContain(
      'accountType: z.enum(MANAGED_ACCOUNT_TYPES).default("personal")',
    );
    expect(routeSource).toContain("${body.accountType},true");
    expect(routeSource).toContain("accountType: body.accountType");
  });

  it("loads, submits, and displays the selected account type", () => {
    expect(sectionSource).toContain("managed.account_type");
    expect(sectionSource).toContain(
      'row.accountType === "enterprise" ? "enterprise" : "personal"',
    );
    expect(dashboardSource).toContain('<option value="personal">개인</option>');
    expect(dashboardSource).toContain('<option value="enterprise">기업</option>');
    expect(dashboardSource).toContain("accountType,");
    expect(dashboardSource).toContain(
      "MANAGED_ACCOUNT_TYPE_LABELS[account.accountType]",
    );
  });
});
