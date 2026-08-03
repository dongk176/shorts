import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({
  requireAdminUser: mocks.requireAdminUser,
}));
vi.mock("@/lib/db", () => ({
  getDb: mocks.getDb,
}));

import { POST } from "./route";

const requestId = "1245836e-d0ca-4f60-8f40-ae138c703bef";
const userId = "f0c30f0b-99a1-45a1-a9b9-e7ca4f60d087";
const grantId = "af0ac715-dbb0-4548-9af2-f3b79ee82c27";

function request(overrides: Record<string, unknown> = {}) {
  return new Request("https://www.easycut.co.kr/api/admin/members/usage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://www.easycut.co.kr",
    },
    body: JSON.stringify({
      requestId,
      userId,
      minutes: 75,
      reason: "고객 보상",
      ...overrides,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminUser.mockResolvedValue({
    id: "850a1122-2dc5-481f-9c1b-147d6e5addaa",
    email: "admin@example.com",
  });
});

describe("administrator member usage grant API", () => {
  it("requires an authenticated administrator", async () => {
    mocks.requireAdminUser.mockRejectedValue(new HttpError(403, "관리자 권한이 필요합니다."));

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("inserts an immediately active grant and an audit record", async () => {
    const statements: string[] = [];
    const expiresAt = new Date("2027-07-30T00:00:00.000Z");
    const tx = Object.assign(vi.fn(async (strings: TemplateStringsArray) => {
      const statement = strings.join("?");
      statements.push(statement);
      if (statement.includes("from shorts_mvp.app_users")) {
        return [{
          id: userId,
          email: "member@example.com",
          displayName: "테스트 회원",
        }];
      }
      if (statement.includes("insert into shorts_mvp.usage_grants")) {
        return [{ id: grantId, expiresAt }];
      }
      return [];
    }), {
      json: (value: unknown) => value,
    });
    const db = Object.assign(vi.fn(), {
      begin: vi.fn(async (callback: (sql: typeof tx) => Promise<unknown>) => callback(tx)),
    });
    mocks.getDb.mockReturnValue(db);

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      minutes: 75,
      grantId,
      expiresAt: expiresAt.toISOString(),
      alreadyProcessed: false,
    });
    expect(statements.some((statement) => (
      statement.includes("pg_advisory_xact_lock")
    ))).toBe(true);
    expect(statements.some((statement) => (
      statement.includes("insert into shorts_mvp.usage_grants")
      && statement.includes("'addon'")
      && statement.includes("'active'")
    ))).toBe(true);
    expect(statements.some((statement) => (
      statement.includes("insert into shorts_mvp.admin_audit_logs")
      && statement.includes("'member.usage_granted'")
    ))).toBe(true);
  });

  it("returns the previous result for the same request id", async () => {
    const statements: string[] = [];
    const expiresAt = "2027-07-30T00:00:00.000Z";
    const tx = Object.assign(vi.fn(async (strings: TemplateStringsArray) => {
      const statement = strings.join("?");
      statements.push(statement);
      if (statement.includes("from shorts_mvp.admin_audit_logs")) {
        return [{ grantId, expiresAt }];
      }
      return [];
    }), {
      json: (value: unknown) => value,
    });
    const db = Object.assign(vi.fn(), {
      begin: vi.fn(async (callback: (sql: typeof tx) => Promise<unknown>) => callback(tx)),
    });
    mocks.getDb.mockReturnValue(db);

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      grantId,
      expiresAt,
      alreadyProcessed: true,
    });
    expect(statements.some((statement) => (
      statement.includes("insert into shorts_mvp.usage_grants")
    ))).toBe(false);
  });

  it("rejects a non-positive usage amount", async () => {
    const response = await POST(request({ minutes: 0 }));

    expect(response.status).toBe(400);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
