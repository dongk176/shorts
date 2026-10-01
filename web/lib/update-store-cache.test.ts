import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ db: vi.fn(), invalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: mocks.invalidate }));
import { saveUpdate } from "./update-store";
import { updateDraftSchema } from "./update-content";
import { RECENT_UPDATES_TAG } from "./recent-updates";
const seed = readFileSync(new URL("../../supabase/migrations/202610010100_update_cms.sql", import.meta.url), "utf8");
const draft = updateDraftSchema.parse(JSON.parse(seed.split("$seed$")[1])[0]);
const id = "11111111-1111-4111-8111-111111111111";

describe("public badge invalidation after admin changes", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it.each(["publish", "hide", "save"] as const)("invalidates committed %s only when the public snapshot changes", async action => {
    const tx = Object.assign(vi.fn().mockResolvedValue([{ version: 1, draft, firstPublishedAt: null }]), { json: (value: unknown) => value });
    const sql = Object.assign(vi.fn().mockResolvedValue([{ id, draft, version: 2, visible: true, firstPublishedAt: null, updatedAt: new Date(), hasChanges: false }]), { begin: vi.fn(async (fn: (tx: unknown) => Promise<void>) => { await fn(tx); }) });
    mocks.db.mockReturnValue(sql);
    await saveUpdate({ id, version: 1, action, draft }, id);
    if (action === "save") expect(mocks.invalidate).not.toHaveBeenCalled();
    else {
      expect(mocks.invalidate).toHaveBeenCalledExactlyOnceWith(RECENT_UPDATES_TAG);
      expect(sql.begin.mock.invocationCallOrder[0]).toBeLessThan(mocks.invalidate.mock.invocationCallOrder[0]);
    }
  });
  it("does not invalidate on a failed transaction", async () => {
    mocks.db.mockReturnValue({ begin: vi.fn().mockRejectedValue(new Error("conflict")) });
    await expect(saveUpdate({ id, version: 1, action: "hide", draft }, id)).rejects.toThrow("conflict");
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});
