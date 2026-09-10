import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/reusable-view-counter-server", () => ({
  getPublicSiteMetrics: vi.fn().mockResolvedValue({ generatedShortCount: 123, reusableViewCounter: null }),
}));

describe("public state cache", () => {
  beforeEach(() => vi.resetModules());

  it("shares only completed values, so a stalled request cannot stall another user", async () => {
    const { getPublicMvpState } = await import("./data");
    let rejectFirst!: (error: Error) => void;
    const stalled = vi.fn(() => new Promise((_, reject) => { rejectFirst = reject; }));
    const healthy = vi.fn().mockResolvedValue([]);
    const first = getPublicMvpState(stalled as unknown as Sql).catch((error) => error);
    await expect(getPublicMvpState(healthy as unknown as Sql)).resolves.toMatchObject({ generatedShortCount: 123 });
    rejectFirst(new Error("request closed"));
    await first;
    const unused = vi.fn();
    await expect(getPublicMvpState(unused as unknown as Sql)).resolves.toMatchObject({ generatedShortCount: 123 });
    expect(unused).not.toHaveBeenCalled();
  });
});
