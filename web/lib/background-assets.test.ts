import { readFileSync } from "node:fs";
import type { Sql, TransactionSql } from "postgres";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  lockAccess: vi.fn(), billing: vi.fn(), enterprise: vi.fn(), put: vi.fn(), get: vi.fn(),
}));
vi.mock("@/lib/custom-template-design-access", async (original) => ({
  ...await original<typeof import("@/lib/custom-template-design-access")>(),
  lockCustomTemplateDesignAccess: mocks.lockAccess,
}));
vi.mock("@/lib/billing", () => ({ getBillingSummary: mocks.billing }));
vi.mock("@/lib/enterprise-access", () => ({ assertEnterpriseServiceAccess: mocks.enterprise }));
vi.mock("@/lib/background-assets-storage", async (original) => ({
  ...await original<typeof import("@/lib/background-assets-storage")>(),
  putBackgroundAssetObject: mocks.put,
  getBackgroundAssetObject: mocks.get,
}));

import {
  assertBackgroundAssetUploadQuota,
  beginBackgroundAssetUpload,
  failBackgroundAssetUpload,
  finishBackgroundAssetUpload,
  getBackgroundAssetImage,
  listBackgroundAssets,
  lockOwnedBackgroundAssets,
  removeBackgroundAssetFromLibrary,
} from "@/lib/background-assets";
import { BACKGROUND_ASSET_MAX_OUTPUT_BYTES, BACKGROUND_ASSET_MAX_STORAGE_BYTES } from "@/lib/background-assets-contract";

const USER = "5576b6fc-edbf-4eb4-85df-f619e33befb0";
const ASSET = "710489ee-7318-48a1-b4d1-73573f3654ab";
const OTHER_ASSET = "cc34202a-5c3b-420c-ad48-d8508fdb3b76";
const KEY = `custom-backgrounds/${USER}/${ASSET}.webp`;
const row = {
  id: ASSET, userId: USER, objectKey: KEY, sha256: "a".repeat(64), state: "ready",
  byteSize: 4, width: 1080, height: 1920, displayName: "test.webp",
  createdAt: "2026-08-31T00:00:00Z", libraryRemovedAt: null,
};
const reservation = { assetId: ASSET, userId: USER, objectKey: KEY, originalByteSize: 20 };
const normalized = {
  body: Buffer.from("test"), sha256: row.sha256, byteSize: 4,
  originalByteSize: 20, width: 1080 as const, height: 1920 as const,
};

function database(...responses: unknown[][]) {
  let responseIndex = 0;
  let depth = 0;
  const calls: { sql: string; values: unknown[] }[] = [];
  const query = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = Array.from(strings).join("?");
    calls.push({ sql, values });
    if (sql.includes("pg_advisory_xact_lock")) return [];
    return responses[responseIndex++] || [];
  });
  const db = Object.assign(query, {
    begin: async <T>(fn: (tx: TransactionSql) => Promise<T>) => {
      depth++;
      try { return await fn(query as unknown as TransactionSql); } finally { depth--; }
    },
  }) as unknown as Sql;
  return { db, tx: query as unknown as TransactionSql, calls, depth: () => depth };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lockAccess.mockResolvedValue({ enabled: true });
  mocks.billing.mockResolvedValue({ activeProducts: [{ planCode: "plus" }] });
  mocks.enterprise.mockResolvedValue({ allowed: true });
  mocks.put.mockResolvedValue(undefined);
  mocks.get.mockResolvedValue(Buffer.from("test"));
});

describe("background asset quota", () => {
  const empty = { listedCount: 0, pendingCount: 0, bytesUsed: 0, recentUploads: 0 };

  it("admits the final visible slot and exact storage boundary", () => {
    expect(() => assertBackgroundAssetUploadQuota({ ...empty, listedCount: 99 })).not.toThrow();
    expect(() => assertBackgroundAssetUploadQuota({
      ...empty, bytesUsed: BACKGROUND_ASSET_MAX_STORAGE_BYTES - BACKGROUND_ASSET_MAX_OUTPUT_BYTES,
    })).not.toThrow();
  });

  it.each([
    [{ listedCount: 100 }, "BACKGROUND_LIBRARY_FULL"],
    [{ listedCount: 99, pendingCount: 1 }, "BACKGROUND_LIBRARY_FULL"],
    [{ bytesUsed: BACKGROUND_ASSET_MAX_STORAGE_BYTES - BACKGROUND_ASSET_MAX_OUTPUT_BYTES + 1 }, "BACKGROUND_STORAGE_FULL"],
    [{ recentUploads: 10 }, "BACKGROUND_UPLOAD_RATE_LIMIT"],
  ])("rejects concurrent reservation/full/rate boundaries", (values, code) => {
    expect(() => assertBackgroundAssetUploadQuota({ ...empty, ...values })).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it("checks paid/managed access before reserving a row", async () => {
    mocks.billing.mockResolvedValue({ activeProducts: [] });
    const fixture = database();
    await expect(beginBackgroundAssetUpload(fixture.db, USER, { originalByteSize: 20, displayName: "a.png" }))
      .rejects.toMatchObject({ code: "PAID_PROJECT_ACTION_REQUIRED" });
    expect(fixture.calls.some((call) => call.sql.includes("insert into"))).toBe(false);
  });

  it("reserves rate and worst-case output bytes under a per-user lock before decode", async () => {
    const fixture = database([{ listedCount: 0, pendingCount: 0, bytesUsed: 0, recentUploads: 0 }]);
    const result = await beginBackgroundAssetUpload(fixture.db, USER, {
      originalByteSize: 20, displayName: "../../my.png",
    });
    expect(result.objectKey).toBe(`custom-backgrounds/${USER}/${result.assetId}.webp`);
    expect(fixture.calls[0].values).toEqual([`background-assets:${USER}`]);
    const insert = fixture.calls.find((call) => call.sql.includes("insert into"))!;
    expect(insert.values).toContain(BACKGROUND_ASSET_MAX_OUTPUT_BYTES);
    expect(insert.values).toContain("my.png");
    const count = fixture.calls.find((call) => call.sql.includes("recent_uploads"))!.sql;
    expect(count).toContain("where state='pending'");
    expect(count).toContain("when state<>'deleted'");
    expect(count).toContain("where created_at>clock_timestamp()-interval '1 minute'");
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("serializes two admissions to the last slot so only one reservation succeeds", async () => {
    let held = 99;
    let lock = Promise.resolve();
    const db = { begin: async <T>(fn: (tx: TransactionSql) => Promise<T>) => {
      let unlock: (() => void) | undefined;
      const tx = async (strings: TemplateStringsArray) => {
        const sql = Array.from(strings).join("?");
        if (sql.includes("pg_advisory_xact_lock")) {
          const previous = lock;
          lock = new Promise<void>((resolve) => { unlock = resolve; });
          await previous;
          return [];
        }
        if (sql.includes("recent_uploads")) return [{ listedCount: held, pendingCount: 0, bytesUsed: 0, recentUploads: 0 }];
        if (sql.includes("insert into")) held++;
        return [];
      };
      try { return await fn(tx as unknown as TransactionSql); } finally { unlock?.(); }
    } } as unknown as Sql;
    const result = await Promise.allSettled([
      beginBackgroundAssetUpload(db, USER, { originalByteSize: 20, displayName: "a.png" }),
      beginBackgroundAssetUpload(db, USER, { originalByteSize: 20, displayName: "b.png" }),
    ]);
    expect(result.map((item) => item.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(held).toBe(100);
  });
});

describe("background persistence and per-account deduplication", () => {
  it("uploads outside transactions and publishes only after S3 succeeds", async () => {
    const fixture = database([{ id: ASSET, state: "pending" }], [], [], [row]);
    mocks.put.mockImplementation(async () => {
      expect(fixture.depth()).toBe(0);
      expect(fixture.calls.some((call) => call.sql.includes("set state='ready'"))).toBe(false);
    });
    const result = await finishBackgroundAssetUpload(fixture.db, reservation, normalized);
    expect(result.reused).toBe(false);
    expect(result.asset).toMatchObject({ id: ASSET, imageUrl: `/api/background-assets/${ASSET}` });
    expect(mocks.put).toHaveBeenCalledOnce();
    expect(fixture.calls.at(-1)?.sql).toContain("state='pending'");
  });

  it("restores a hidden identical owned image without writing a duplicate object", async () => {
    const hidden = { ...row, id: OTHER_ASSET, libraryRemovedAt: "2026-08-01T00:00:00Z" };
    const fixture = database([{ id: ASSET, state: "pending" }], [hidden], [hidden], []);
    const result = await finishBackgroundAssetUpload(fixture.db, reservation, normalized);
    expect(result.reused).toBe(true);
    expect(result.asset.id).toBe(OTHER_ASSET);
    expect(mocks.put).not.toHaveBeenCalled();
    const matching = fixture.calls.find((call) => call.sql.includes("sha256=?") && call.sql.includes("order by id"))!;
    expect(matching.values).toContain(USER);
    expect(matching.sql).toContain("where user_id=");
    expect(fixture.calls.some((call) => call.sql.includes("library_removed_at=null"))).toBe(true);
    expect(fixture.calls.at(-1)?.sql).toContain("state='deleted',reserved_bytes=0");
  });

  it.each(["pending", "deleting"])("does not duplicate an identical %s object", async (state) => {
    const fixture = database([{ id: ASSET }], [{ ...row, id: OTHER_ASSET, state }]);
    await expect(finishBackgroundAssetUpload(fixture.db, reservation, normalized))
      .rejects.toMatchObject({ code: "BACKGROUND_ASSET_BUSY" });
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("cannot finalize an expired or already claimed upload reservation", async () => {
    const fixture = database([]);
    await expect(finishBackgroundAssetUpload(fixture.db, reservation, normalized))
      .rejects.toMatchObject({ code: "BACKGROUND_ASSET_BUSY" });
    expect(mocks.put).not.toHaveBeenCalled();
    expect(fixture.calls.at(-1)?.sql).toContain("retain_until>clock_timestamp()");
  });

  it("keeps uncertain writes quota-charged for maintenance rather than deleting synchronously", async () => {
    const fixture = database();
    await failBackgroundAssetUpload(fixture.db, reservation);
    const sql = fixture.calls.at(-1)?.sql || "";
    expect(sql).toContain("case when sha256 is null then 'deleted' else 'deleting' end");
    expect(sql).toContain("interval '15 minutes'");
    expect(sql).toContain("and state='pending'");
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("keeps visible images indefinitely and exposes no storage keys", async () => {
    const fixture = database([{ listedCount: 1, pendingCount: 2, bytesUsed: 500 }], [row]);
    const result = await listBackgroundAssets(fixture.db, USER);
    expect(result.assets[0]).not.toHaveProperty("objectKey");
    expect(result.assets[0]).not.toHaveProperty("sha256");
    expect(result.quota).toMatchObject({ listedCount: 1, pendingCount: 2, bytesUsed: 500, maxListed: 100 });
    const select = fixture.calls.at(-1)?.sql || "";
    expect(select).toContain("library_removed_at is null");
    expect(select).not.toContain("retain_until");
    expect(mocks.lockAccess).not.toHaveBeenCalled();
    expect(mocks.billing).not.toHaveBeenCalled();
  });
});

describe("owner verification, leases and safe list removal", () => {
  it("never queries the new table for a legacy design without asset IDs", async () => {
    const fixture = database();
    await expect(lockOwnedBackgroundAssets(fixture.tx, USER, [])).resolves.toEqual([]);
    expect(fixture.calls).toEqual([]);
  });

  it("locks owned ready assets, including hidden ones, and pins draft/attachment leases", async () => {
    const fixture = database([{ ...row, libraryRemovedAt: "2026-08-01T00:00:00Z" }]);
    const result = await lockOwnedBackgroundAssets(fixture.tx, USER, [ASSET, ASSET]);
    expect(result).toEqual([{ assetId: ASSET, objectKey: KEY, sha256: row.sha256, byteSize: 4, width: 1080, height: 1920 }]);
    expect(fixture.calls[1].sql).toContain("and user_id=?");
    expect(fixture.calls[1].sql).toContain("for update");
    expect(fixture.calls[1].sql).not.toContain("library_removed_at is null");
    expect(fixture.calls.at(-1)?.sql).toContain("unreferenced_since=null");
    expect(fixture.calls.at(-1)?.values).toContain(30);
  });

  it.each([
    { rows: [] },
    { rows: [{ ...row, state: "deleting" }] },
    { rows: [{ ...row, objectKey: "custom-backgrounds/another-user/another-asset.webp" }] },
    { rows: [{ ...row, byteSize: BACKGROUND_ASSET_MAX_OUTPUT_BYTES + 1 }] },
    { rows: [{ ...row, width: 1920 }] },
    { rows: [{ ...row, sha256: "invalid" }] },
  ])("blocks missing/other-user/deleting or corrupted references before attaching", async ({ rows }) => {
    const fixture = database(rows);
    await expect(lockOwnedBackgroundAssets(fixture.tx, USER, [ASSET]))
      .rejects.toMatchObject({ code: "BACKGROUND_ASSET_NOT_FOUND" });
    expect(fixture.calls.some((call) => call.sql.includes("update shorts_mvp.background_assets"))).toBe(false);
  });

  it("allows owned reads with the feature off and performs storage I/O after commit", async () => {
    const fixture = database([row]);
    mocks.get.mockImplementation(async () => {
      expect(fixture.depth()).toBe(0);
      return Buffer.from("test");
    });
    const result = await getBackgroundAssetImage(fixture.db, USER, ASSET);
    expect(result.body.toString()).toBe("test");
    expect(mocks.get).toHaveBeenCalledWith(expect.objectContaining({ userId: USER, assetId: ASSET, objectKey: KEY }));
    expect(mocks.lockAccess).not.toHaveBeenCalled();
    expect(mocks.billing).not.toHaveBeenCalled();
  });

  it("removes only discovery and protects browser drafts for 30 days", async () => {
    const fixture = database([row]);
    await expect(removeBackgroundAssetFromLibrary(fixture.db, USER, ASSET)).resolves.toEqual({ removed: true, assetId: ASSET });
    const sql = fixture.calls.at(-1)?.sql || "";
    expect(sql).toContain("library_removed_at=clock_timestamp()");
    expect(sql).toContain("interval '30 days'");
    expect(sql).not.toContain("set state=");
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.lockAccess).not.toHaveBeenCalled();
  });

  it("is idempotent after removal and even after eventual physical deletion", async () => {
    const fixture = database([{ ...row, state: "deleted", libraryRemovedAt: "2026-08-01T00:00:00Z" }]);
    await expect(removeBackgroundAssetFromLibrary(fixture.db, USER, ASSET)).resolves.toEqual({ removed: true, assetId: ASSET });
    expect(fixture.calls).toHaveLength(2);
  });

  it("cannot remove another user's image", async () => {
    const fixture = database([]);
    await expect(removeBackgroundAssetFromLibrary(fixture.db, USER, ASSET)).rejects.toMatchObject({ status: 404 });
    expect(fixture.calls.at(-1)?.values).toEqual([ASSET, USER]);
  });
});

describe("additive background migration", () => {
  it("keeps the private prefix/schema, fail-closed flags and ownership lifecycle constraints", () => {
    const sql = readFileSync(new URL("../../supabase/migrations/202608310001_background_assets.sql", import.meta.url), "utf8");
    expect(sql).toContain("create table if not exists shorts_mvp.background_assets");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on shorts_mvp.background_assets from anon,authenticated");
    expect(sql).toContain("'custom_template_design_enabled',false");
    expect(sql).toContain("'custom_template_design_public',false");
    expect(sql).toContain("on conflict (flag_key) do nothing");
    expect(sql).toContain("background_assets_owner_digest_active_idx");
    expect(sql).toContain("custom-backgrounds/");
    expect(sql).not.toMatch(/alter\s+(?:table|schema)\s+public\./i);
    expect(sql).not.toContain("edit-sources/");
  });
});
