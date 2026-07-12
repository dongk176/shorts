import { describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import { getGeneratedShortCount } from "./data";

describe("generated shorts counter", () => {
  it("returns the persisted public counter as a number", async () => {
    const db = vi.fn().mockResolvedValue([{ value: "4327" }]) as unknown as Sql;

    await expect(getGeneratedShortCount(db)).resolves.toBe(4327);
  });
});
