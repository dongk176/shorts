import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ owner: vi.fn(), wake: vi.fn(), query: vi.fn() }));
vi.mock("./db", () => ({ getDb: () => state.query }));
vi.mock("./ranking-access", () => ({ requireRankingProject: state.owner, rankingUuid: vi.fn() }));
vi.mock("./ranking-runtime", () => ({ wakeRankingRuntime: state.wake, rankingReceiverAccess: vi.fn() }));
import { rankingOperation } from "./ranking-jobs";
beforeEach(() => { vi.resetAllMocks(); state.query.mockResolvedValue([{ id: "op", status: "succeeded", action: "preview", result: { source: { id: "source", previewReady: true } }, error: null }]); });
it("withholds a finished preview until its receiver is healthy", async () => {
  state.wake.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  expect(await rankingOperation("project", "op", "owner")).toEqual({ status: "running", result: null, error: null });
  expect(await rankingOperation("project", "op", "owner")).toMatchObject({ status: "succeeded", result: { source: { id: "source" } } });
});
it("never starts the receiver for completed renders", async () => {
  state.query.mockResolvedValue([{ id: "op", status: "succeeded", action: "render", result: { duration: 3 }, error: null }]);
  expect(await rankingOperation("project", "op", "owner")).toMatchObject({ status: "succeeded" });
  expect(state.wake).not.toHaveBeenCalled();
});
it("checks ownership before probing capacity", async () => {
  state.owner.mockRejectedValue(new Error("denied"));
  await expect(rankingOperation("project", "op", "other")).rejects.toThrow("denied");
  expect(state.query).not.toHaveBeenCalled(); expect(state.wake).not.toHaveBeenCalled();
});
