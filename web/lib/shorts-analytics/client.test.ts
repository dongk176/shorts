import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
let storage: Map<string, string>;
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  storage = new Map();
  vi.stubGlobal("window", { addEventListener: vi.fn() });
  vi.stubGlobal("document", {
    addEventListener: vi.fn(),
    visibilityState: "visible",
  });
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response('{"saved":true}', { status: 200 })),
  );
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const payload = () =>
  JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string).events;
describe("non-blocking browser event delivery", () => {
  it("batches choices and sends immutable snapshots", async () => {
    const { trackGuideEvent, flushGuideEvents } = await import("./client");
    const answers = { category: "products" };
    trackGuideEvent({
      name: "answer_selected",
      locale: "ko",
      question: "category",
      answer: "products",
      answers,
    });
    answers.category = "food";
    trackGuideEvent({
      name: "answer_selected",
      locale: "ko",
      question: "category",
      answer: "food",
      answers,
    });
    await flushGuideEvents();
    expect(payload().map((e: { answers: unknown }) => e.answers)).toEqual([
      { category: "products" },
      { category: "food" },
    ]);
    expect(vi.mocked(fetch).mock.calls[0][1]?.keepalive).toBe(true);
  });
  it("retries failures with the same IDs and removes acknowledged events", async () => {
    const c = await import("./client");
    vi.mocked(fetch).mockResolvedValueOnce(new Response("", { status: 503 }));
    c.trackGuideEvent({ name: "quiz_started", locale: "ko" });
    await c.flushGuideEvents();
    const first = payload();
    await c.flushGuideEvents();
    expect(payload()).toEqual(first);
    expect(JSON.parse([...storage.values()][0]).pending).toHaveLength(0);
  });
  it("keeps the attempt ID on reload, but assigns a new ID on explicit restart", async () => {
    let c = await import("./client");
    c.trackGuideEvent({ name: "quiz_started", locale: "ko" });
    await c.flushGuideEvents();
    const first = payload()[0];
    vi.resetModules();
    c = await import("./client");
    c.trackGuideEvent({ name: "pricing_clicked", locale: "en" });
    await c.flushGuideEvents();
    expect(payload()[0].surveyId).toBe(first.surveyId);
    c.newGuideSurvey();
    c.trackGuideEvent({ name: "quiz_started", locale: "ko" });
    await c.flushGuideEvents();
    expect(payload()[0].surveyId).not.toBe(first.surveyId);
  });
  it("does not count start again when returning to a saved attempt", async () => {
    const c = await import("./client");
    c.trackGuideEvent({ name: "quiz_started", locale: "ko" });
    await c.flushGuideEvents();
    c.trackGuideEvent({ name: "quiz_started", locale: "ko" });
    await c.flushGuideEvents();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("continues without storage and does not throw on network failure", async () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw Error();
      },
      setItem: () => {
        throw Error();
      },
    });
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    const c = await import("./client");
    expect(() =>
      c.trackGuideEvent({ name: "quiz_started", locale: "ko" }),
    ).not.toThrow();
    await expect(c.flushGuideEvents()).resolves.toBeUndefined();
  });
});
