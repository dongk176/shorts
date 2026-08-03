import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  getDb: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({
  requireAdminUser: mocks.requireAdminUser,
}));
vi.mock("@/lib/db", () => ({
  getDb: mocks.getDb,
}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

import {
  updateFreeUsageGrantSetting,
  updateShortsThankYouEventSetting,
} from "./free-usage-grant-actions";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ONBOARDING_WELCOME_GRANT_ENABLED;
  delete process.env.SHORTS_10K_EVENT_ENABLED;
  mocks.requireAdminUser.mockResolvedValue({
    id: "850a1122-2dc5-481f-9c1b-147d6e5addaa",
    email: "admin@example.com",
  });
});

afterEach(() => {
  delete process.env.ONBOARDING_WELCOME_GRANT_ENABLED;
  delete process.env.SHORTS_10K_EVENT_ENABLED;
});

function mockDb(currentEnabled: boolean, updatedAt = "2026-07-29T00:00:00.000Z") {
  const statements: string[] = [];
  const json = vi.fn((value: unknown) => value);
  const tx = Object.assign(
    vi.fn(async (strings: TemplateStringsArray) => {
      const statement = strings.join("?");
      statements.push(statement);
      if (statement.includes("select enabled,updated_at")) {
        return [{ enabled: currentEnabled, updatedAt }];
      }
      if (statement.includes("update shorts_mvp.runtime_feature_flags")) {
        return [{ enabled: !currentEnabled, updatedAt: "2026-07-29T01:00:00.000Z" }];
      }
      return [];
    }),
    { json },
  );
  mocks.getDb.mockReturnValue({
    begin: vi.fn(async (callback: (sql: typeof tx) => Promise<unknown>) => callback(tx)),
  });
  return { statements, json };
}

describe("administrator free usage grant setting action", () => {
  it("locks, updates, and audits each real setting change", async () => {
    const { statements, json } = mockDb(true);

    await expect(updateFreeUsageGrantSetting(false)).resolves.toEqual({
      enabled: false,
      effectiveEnabled: false,
      updatedAt: "2026-07-29T01:00:00.000Z",
    });

    expect(mocks.requireAdminUser).toHaveBeenCalledOnce();
    expect(statements[0]).toContain("for update");
    expect(statements.some((statement) => (
      statement.includes("update shorts_mvp.runtime_feature_flags")
      && statement.includes("updated_by_user_id")
    ))).toBe(true);
    expect(statements.some((statement) => (
      statement.includes("insert into shorts_mvp.admin_audit_logs")
      && statement.includes("'runtime_feature_flag.changed'")
    ))).toBe(true);
    expect(json).toHaveBeenCalledWith({
      previousEnabled: true,
      enabled: false,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/easycutcutcutcutcutcut",
    );
  });

  it("does not create another audit entry for a stale no-op request", async () => {
    const { statements, json } = mockDb(false);

    await expect(updateFreeUsageGrantSetting(false)).resolves.toEqual({
      enabled: false,
      effectiveEnabled: false,
      updatedAt: "2026-07-29T00:00:00.000Z",
    });

    expect(statements).toHaveLength(1);
    expect(json).not.toHaveBeenCalled();
  });

  it("reports an environment emergency stop separately from the admin choice", async () => {
    process.env.ONBOARDING_WELCOME_GRANT_ENABLED = "false";
    mockDb(false);

    await expect(updateFreeUsageGrantSetting(true)).resolves.toMatchObject({
      enabled: true,
      effectiveEnabled: false,
    });
  });
});

describe("administrator shorts event setting action", () => {
  it("cannot enable the database flag while the deployment switch is off", async () => {
    await expect(updateShortsThankYouEventSetting(true)).rejects.toMatchObject({
      status: 409,
    });
    expect(mocks.requireAdminUser).toHaveBeenCalledOnce();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("can still turn a stale database flag off while the deployment switch is off", async () => {
    mockDb(true);

    await expect(updateShortsThankYouEventSetting(false)).resolves.toMatchObject({
      enabled: false,
      effectiveEnabled: false,
    });
  });
});
