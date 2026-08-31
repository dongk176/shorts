import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(), getDb: vi.fn(), revalidate: vi.fn(), runtime: vi.fn(), canary: vi.fn(),
}));
vi.mock("@/lib/admin", () => ({ requireAdminUser: mocks.requireAdmin }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/custom-template-design-admin", () => ({
  assertCustomTemplateDesignRuntimeReady: mocks.runtime,
  assertCustomTemplateDesignCanaryResults: mocks.canary,
}));

import { setCustomTemplateDesignMode } from "./custom-template-design-actions";
import { HttpError } from "@/lib/http";

const ADMIN = "11111111-1111-4111-8111-111111111111";
const RELEASES = {
  projectReleaseId: "22222222-2222-4222-8222-222222222222",
  uploadReleaseId: "33333333-3333-4333-8333-333333333333",
};
const ENABLED = "custom_template_design_enabled";
const PUBLIC = "custom_template_design_public";
type Row = Record<string, unknown>;

function form(mode?: string) {
  const data = new FormData();
  if (mode !== undefined) data.set("mode", mode);
  return data;
}

function database(input?: { actors?: Row[]; flags?: Row[] }) {
  const statements: { sql: string; values: unknown[] }[] = [];
  const flags = input?.flags ?? [{ flagKey: ENABLED, enabled: false }, { flagKey: PUBLIC, enabled: false }];
  const tx = Object.assign(vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?").replace(/\s+/g, " ").trim();
    statements.push({ sql, values });
    if (sql.includes("select id from shorts_mvp.app_users")) return input?.actors ?? [{ id: ADMIN }];
    if (sql.includes("select flag_key,enabled from shorts_mvp.runtime_feature_flags")) return flags;
    if (sql.startsWith("update shorts_mvp.runtime_feature_flags")) return [];
    if (sql.startsWith("insert into shorts_mvp.admin_audit_logs")) return [];
    throw new Error(`Unexpected test query: ${sql}`);
  }), { json: vi.fn((value: unknown) => value) });
  const begin = vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx));
  mocks.getDb.mockReturnValue({ begin });
  return { tx, begin, statements };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAdmin.mockResolvedValue({ id: ADMIN });
  mocks.runtime.mockResolvedValue(RELEASES);
  mocks.canary.mockResolvedValue(undefined);
});

describe("custom template design mode action", () => {
  it.each([401, 403])("requires administrator authentication before any database access (%s)", async (status) => {
    mocks.requireAdmin.mockRejectedValue(new HttpError(status, "관리자 권한이 필요합니다."));
    await expect(setCustomTemplateDesignMode(form("off"))).rejects.toMatchObject({ status });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it.each([undefined, "true", "PUBLIC", ""])("rejects an invalid mode without opening a mutation transaction: %s", async (value) => {
    await expect(setCustomTemplateDesignMode(form(value))).rejects.toThrow();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rechecks the actor's current non-withdrawn administrator role inside the transaction", async () => {
    const { tx, statements } = database({ actors: [] });
    await expect(setCustomTemplateDesignMode(form("public"))).rejects.toMatchObject({ status: 403 });
    expect(tx).toHaveBeenCalledOnce();
    expect(statements[0].sql).toContain("where id=? and is_admin and withdrawn_at is null for share");
    expect(statements[0].values).toEqual([ADMIN]);
    expect(mocks.runtime).not.toHaveBeenCalled();
    expect(mocks.canary).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it.each([
    { flags: [] }, { flags: [{ flagKey: ENABLED, enabled: true }] },
    { flags: [{ flagKey: ENABLED, enabled: true }, { flagKey: PUBLIC, enabled: true }] },
  ])(
    "keeps OFF independent of runtime readiness and incomplete seed rows: %j", async ({ flags }) => {
      mocks.runtime.mockRejectedValue(new Error("runtime unavailable"));
      mocks.canary.mockRejectedValue(new Error("no canary results"));
      const { statements } = database({ flags });
      const result = await setCustomTemplateDesignMode(form("off"));
      expect(result).toMatchObject({ ok: true, mode: "off" });
      expect(result.message).toContain("기존 영상과 보관 배경은 유지");
      expect(mocks.runtime).not.toHaveBeenCalled();
      expect(mocks.canary).not.toHaveBeenCalled();
      expect(statements.find(({ sql }) => sql.startsWith("update"))?.values).toEqual([ENABLED, false, false, ADMIN, ENABLED, PUBLIC]);
      expect(statements.some(({ sql }) => /\bdelete\b/i.test(sql))).toBe(false);
    },
  );

  it("allows administrator-only testing after runtime checks, without substituting it for completed public canaries", async () => {
    const { tx, statements } = database();
    expect(await setCustomTemplateDesignMode(form("admin"))).toMatchObject({ ok: true, mode: "admin" });
    expect(mocks.runtime).toHaveBeenCalledWith(tx, false);
    expect(mocks.canary).not.toHaveBeenCalled();
    expect(mocks.runtime.mock.invocationCallOrder[0]).toBeLessThan(tx.mock.invocationCallOrder[1]);
    expect(statements.find(({ sql }) => sql.startsWith("update"))?.values).toEqual([ENABLED, true, false, ADMIN, ENABLED, PUBLIC]);
  });

  it("checks exact public runtime and both source canaries before updating only the two design flags", async () => {
    const { tx, statements } = database();
    expect(await setCustomTemplateDesignMode(form("public"))).toMatchObject({ ok: true, mode: "public" });
    expect(mocks.runtime).toHaveBeenCalledWith(tx, true);
    expect(mocks.canary).toHaveBeenCalledWith(tx, RELEASES);
    expect(mocks.runtime.mock.invocationCallOrder[0]).toBeLessThan(mocks.canary.mock.invocationCallOrder[0]);
    expect(mocks.canary.mock.invocationCallOrder[0]).toBeLessThan(tx.mock.invocationCallOrder[1]);
    const updates = statements.filter(({ sql }) => sql.startsWith("update"));
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain("where flag_key in (?,?)");
    expect(updates[0].values).toEqual([ENABLED, true, true, ADMIN, ENABLED, PUBLIC]);
    expect(statements[1].sql).toContain("order by flag_key for update");
    expect(tx.json).toHaveBeenCalledWith({ mode: "public", previous: [{ flag: ENABLED, enabled: false }, { flag: PUBLIC, enabled: false }] });
    const audit = statements.find(({ sql }) => sql.startsWith("insert"));
    expect(audit?.sql).toContain("'custom_template_design.mode_changed','runtime_feature','custom_template_design'");
    expect(audit?.values[0]).toBe(ADMIN);
    expect(mocks.revalidate.mock.calls).toEqual([["/admin/easycutcutcutcutcutcut"], ["/templates"]]);
  });

  it.each(["runtime", "canary"] as const)("does not write or claim success when the %s gate fails", async (gate) => {
    mocks[gate].mockRejectedValue(new HttpError(409, "검증이 필요합니다."));
    const { statements } = database();
    await expect(setCustomTemplateDesignMode(form("public"))).rejects.toMatchObject({ status: 409 });
    expect(statements).toHaveLength(1);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it.each(["admin", "public"])("does not enable %s until both seed flags exist", async (mode) => {
    const { statements } = database({ flags: [{ flagKey: ENABLED, enabled: false }] });
    await expect(setCustomTemplateDesignMode(form(mode))).rejects.toMatchObject({ status: 409 });
    expect(statements).toHaveLength(2);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("propagates a transaction failure without a success response or cache invalidation", async () => {
    const { begin } = database();
    begin.mockRejectedValue(new Error("transaction failed"));
    await expect(setCustomTemplateDesignMode(form("public"))).rejects.toThrow("transaction failed");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
