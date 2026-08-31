import type { Sql, TransactionSql } from "postgres";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assertCustomTemplateDesignAccess,
  CUSTOM_TEMPLATE_DESIGN_ENABLED_FLAG,
  CUSTOM_TEMPLATE_DESIGN_PUBLIC_FLAG,
  getCustomTemplateDesignAccess,
  lockCustomTemplateDesignAccess,
  resolveCustomTemplateDesignAccess,
} from "@/lib/custom-template-design-access";

const USER = "5576b6fc-edbf-4eb4-85df-f619e33befb0";

function dbWith(...responses: unknown[][]) {
  let index = 0;
  return vi.fn(async (...args: unknown[]) => { void args; return responses[index++] || []; });
}

describe("custom template design release gate", () => {
  it.each([
    [false, false, false, false],
    [false, true, true, false],
    [true, false, false, false],
    [true, false, true, true],
    [true, true, false, true],
  ])("requires enabled and admin-or-public: %s %s %s", (featureEnabled, publicEnabled, isAdmin, expected) => {
    expect(resolveCustomTemplateDesignAccess({ featureEnabled, publicEnabled, isAdmin }).enabled).toBe(expected);
  });

  it("never reads flags or grants access to an anonymous user", async () => {
    const db = dbWith();
    expect((await getCustomTemplateDesignAccess(db as unknown as Sql, null)).enabled).toBe(false);
    expect(db).not.toHaveBeenCalled();
  });

  it("requires both migration seed rows even for administrators", async () => {
    const db = dbWith([{ flagKey: CUSTOM_TEMPLATE_DESIGN_ENABLED_FLAG, enabled: true }]);
    expect((await getCustomTemplateDesignAccess(db as unknown as Sql, USER)).enabled).toBe(false);
    expect(db).toHaveBeenCalledTimes(1);
  });

  it("locks flags and a nonwithdrawn user row for mutations", async () => {
    const db = dbWith([
      { flagKey: CUSTOM_TEMPLATE_DESIGN_ENABLED_FLAG, enabled: true },
      { flagKey: CUSTOM_TEMPLATE_DESIGN_PUBLIC_FLAG, enabled: false },
    ], [{ isAdmin: true }]);
    await expect(lockCustomTemplateDesignAccess(db as unknown as TransactionSql, USER))
      .resolves.toMatchObject({ enabled: true, adminEnabled: true, publicEnabled: false });
    const sql = db.mock.calls.map(([parts]) => Array.from(parts as TemplateStringsArray).join("")).join("\n");
    expect(sql.match(/for share/g)).toHaveLength(2);
    expect(sql).toContain("withdrawn_at is null");
    expect(sql).toContain("order by flag_key");
  });

  it("does not let a withdrawn/missing user use the public release", async () => {
    const db = dbWith([
      { flagKey: CUSTOM_TEMPLATE_DESIGN_ENABLED_FLAG, enabled: true },
      { flagKey: CUSTOM_TEMPLATE_DESIGN_PUBLIC_FLAG, enabled: true },
    ], []);
    expect((await getCustomTemplateDesignAccess(db as unknown as Sql, USER)).enabled).toBe(false);
  });

  it("fails closed with a stable user-facing error code", () => {
    expect(() => assertCustomTemplateDesignAccess({ enabled: false })).toThrowError(
      expect.objectContaining({ status: 403, code: "CUSTOM_TEMPLATE_DESIGN_DISABLED" }),
    );
    expect(() => assertCustomTemplateDesignAccess({ enabled: true })).not.toThrow();
  });
});
