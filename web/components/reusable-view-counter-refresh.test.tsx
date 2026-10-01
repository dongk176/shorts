import { afterEach, describe, expect, it, vi } from "vitest";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { ReusableViewCounter } from "./reusable-view-counter";

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const metrics = {
  reusableViewCounter: { startValue: 100, targetValue: 200, startedAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-02T00:00:00Z", serverNow: "2026-10-01T01:00:00Z" },
  generatedShortCount: 20,
};
async function setup(seeded = true) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(metrics.reusableViewCounter.serverNow));
  const { window, document } = parseHTML("<html><body><div id='app'></div></body></html>");
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.matchMedia = vi.fn(() => ({ matches: true })) as unknown as typeof window.matchMedia;
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
  const fetcher = vi.fn().mockImplementation(async () => Response.json(metrics));
  vi.stubGlobal("fetch", fetcher);
  root = createRoot(document.getElementById("app")! as unknown as Element);
  await act(async () => root!.render(<StrictMode><ReusableViewCounter counter={seeded ? metrics.reusableViewCounter : null} generatedShortCount={seeded ? 20 : null} locale="ko" /></StrictMode>));
  const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
  const visibility = async (hidden: boolean) => {
    Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
    await act(async () => { document.dispatchEvent(new window.Event("visibilitychange")); });
  };
  return { fetcher, advance, visibility };
}
describe("public metrics refresh", () => {
  it("renders server metrics without a hydration fetch and refreshes after one minute", async () => {
    const ui = await setup();
    expect(ui.fetcher).not.toHaveBeenCalled();
    await ui.advance(59_999);
    expect(ui.fetcher).not.toHaveBeenCalled();
    await ui.advance(1);
    expect(ui.fetcher).toHaveBeenCalledOnce();
  });
  it("recovers missing server data immediately", async () => {
    const ui = await setup(false);
    expect(ui.fetcher).toHaveBeenCalled();
  });
  it("pauses while hidden and revalidates when the tab becomes visible", async () => {
    const ui = await setup();
    await ui.visibility(true);
    await ui.advance(120_000);
    expect(ui.fetcher).not.toHaveBeenCalled();
    await ui.visibility(false);
    expect(ui.fetcher).toHaveBeenCalledOnce();
  });
});
