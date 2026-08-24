import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/session", () => ({
  requireAuthenticatedMvpSession: mocks.session,
}));

import { GET, POST } from "./route";

const userId = "6f856acc-5b6a-4f62-9971-d7feb1f2a624";
const requestId = "276a287d-8531-4cb5-9918-5811b12148e4";

function dbWithRows(...responses: unknown[][]) {
  const sql = vi.fn();
  for (const response of responses) sql.mockResolvedValueOnce(response);
  return sql;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ userId });
});

describe("user onboarding API", () => {
  it("requires onboarding when the account has no stored response", async () => {
    mocks.getDb.mockReturnValue(dbWithRows([]));

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      required: true,
      version: 2,
      storedVersion: null,
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("does not require onboarding after a response was stored", async () => {
    mocks.getDb.mockReturnValue(dbWithRows([{ onboardingVersion: 1 }]));

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      required: false,
      version: 2,
      storedVersion: 1,
    });
  });

  it("keeps older v2 rows without discovery data migration-compatible", () => {
    const migration = readFileSync(
      new URL(
        "../../../../supabase/migrations/202607300011_onboarding_discovery_source.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migration).toContain("or onboarding_version=2");
    expect(migration).not.toContain(
      "onboarding_version=2 and discovery_source is not null",
    );
    expect(migration).toContain(
      "drop constraint if exists user_onboarding_profiles_discovery_source_check",
    );
    expect(migration).toContain(
      "drop constraint if exists user_onboarding_profiles_discovery_source_version_check",
    );
  });

  it("keeps the database discovery-source constraint aligned with TikTok", () => {
    const migration = readFileSync(
      new URL(
        "../../../../supabase/migrations/202608030003_add_tiktok_onboarding_discovery_source.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migration).toContain("'tiktok'");
    expect(migration).toContain(
      "drop constraint if exists user_onboarding_profiles_discovery_source_check",
    );
  });

  it("stores a valid response without coupling onboarding to the login grant", async () => {
    const db = dbWithRows([]);
    mocks.getDb.mockReturnValue(db);

    const response = await POST(new Request("http://localhost/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId,
        occupation: "creator",
        occupationOther: null,
        usagePurposes: ["youtube_shorts", "save_editing_time"],
        usagePurposeOther: null,
        discoverySource: "tiktok",
        discoverySourceOther: null,
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ completed: true });
    expect(db).toHaveBeenCalledOnce();
  });

  it("rejects other without a direct answer", async () => {
    const response = await POST(new Request("http://localhost/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId,
        occupation: "other",
        occupationOther: null,
        usagePurposes: ["other"],
        usagePurposeOther: null,
        discoverySource: "direct_search",
        discoverySourceOther: null,
      }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects an other discovery source without a direct answer", async () => {
    const response = await POST(new Request("http://localhost/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId,
        occupation: "creator",
        occupationOther: null,
        usagePurposes: ["youtube_shorts"],
        usagePurposeOther: null,
        discoverySource: "other",
        discoverySourceOther: null,
      }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
