import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { resolveAdminInquiry } from "./inquiry-actions";

const inquiryId = "d9766955-a413-4eaf-a8a6-39a323b35979";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminUser.mockResolvedValue({
    id: "850a1122-2dc5-481f-9c1b-147d6e5addaa",
    email: "admin@example.com",
  });
});

function mockDb(currentStatus: string) {
  const statements: string[] = [];
  const tx = Object.assign(vi.fn(async (strings: TemplateStringsArray) => {
    const statement = strings.join("?");
    statements.push(statement);
    if (statement.includes("select status")) {
      return [{ status: currentStatus }];
    }
    return [];
  }), {
    json: (value: unknown) => value,
  });
  const db = {
    begin: vi.fn(async (callback: (sql: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  mocks.getDb.mockReturnValue(db);
  return statements;
}

describe("administrator inquiry completion action", () => {
  it("marks the inquiry resolved without deleting it", async () => {
    const statements = mockDb("new");

    await resolveAdminInquiry(inquiryId);

    expect(mocks.requireAdminUser).toHaveBeenCalledOnce();
    expect(statements.some((statement) => (
      statement.includes("update shorts_mvp.customer_inquiries")
      && statement.includes("status='resolved'")
      && statement.includes("resolved_at=clock_timestamp()")
    ))).toBe(true);
    expect(statements.some((statement) => (
      statement.includes("insert into shorts_mvp.admin_audit_logs")
    ))).toBe(true);
    expect(statements.every((statement) => !statement.includes("delete"))).toBe(true);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/easycutcutcutcutcutcut",
    );
  });

  it("does not write again when the inquiry is already complete", async () => {
    const statements = mockDb("resolved");

    await resolveAdminInquiry(inquiryId);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("select status");
    expect(mocks.revalidatePath).toHaveBeenCalledOnce();
  });
});
