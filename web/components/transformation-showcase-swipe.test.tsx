import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { TransformationShowcase } from "./transformation-showcase";

const language = vi.hoisted(() => ({ locale: "ko" }));
vi.mock("@/lib/i18n/provider", () => ({ useI18n: () => language }));
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});

async function render(locale = "ko", storage = new Map<string, string>(), storageBlocked = false) {
  language.locale = locale;
  const { window, document } = parseHTML("<html><body><div id='app'></div></body></html>");
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => { if (storageBlocked) throw new Error("Storage unavailable"); return storage.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (storageBlocked) throw new Error("Storage unavailable"); storage.set(key, value); },
  });
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  Object.assign(window.HTMLElement.prototype, { pause() {}, load() {}, play: async () => {}, showModal() {}, close() {} });
  root = createRoot(document.getElementById("app")! as unknown as Element);
  await act(async () => root!.render(<TransformationShowcase />));
  const cards = Array.from(document.querySelectorAll('figure button[aria-pressed]')) as unknown as HTMLElement[];
  const fan = cards[0].parentElement!.parentElement!;
  const captured = { target: null as HTMLElement | null };
  const event = (type: string, x = 220, y = 100, extra = {}) => Object.assign(new window.Event(type, { bubbles: true, cancelable: true }), { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, clientX: x, clientY: y, ...extra });
  const capture = vi.fn(function (this: HTMLElement) {
    const previous = captured.target;
    captured.target = this;
    // Touch implicitly captures the starting button. Moving capture to the
    // carousel emits a bubbling lostpointercapture from that child button.
    if (previous && previous !== this) previous.dispatchEvent(event("lostpointercapture") as unknown as Event);
  });
  Object.assign(window.HTMLElement.prototype, { setPointerCapture: capture });
  const send = async (target: HTMLElement, type: string, x = 220, y = 100, extra = {}) => {
    if (type === "pointerdown") captured.target = target;
    const input = event(type, x, y, extra);
    await act(async () => { target.dispatchEvent(input as unknown as Event); });
    return input;
  };
  const selected = () => cards.findIndex(card => card.getAttribute("aria-pressed") === "true");
  const changeLocale = async (next: string) => {
    language.locale = next;
    await act(async () => root!.render(<TransformationShowcase />));
  };
  const touch = async (target: HTMLElement, type: string, x = 220, y = 100, fingers = 1) => {
    const changedTouches = [{ identifier: 7, clientX: x, clientY: y }];
    const touches = type === "touchend" || type === "touchcancel" ? [] : [
      ...changedTouches, ...(fingers > 1 ? [{ identifier: 8, clientX: x + 20, clientY: y }] : []),
    ];
    return send(target, type, x, y, { touches, changedTouches });
  };
  return { cards, fan, capture, send, touch, selected, document, storage, changeLocale, window };
}

describe("showroom touch capture", () => {
  it.each(["ko", "en", "ja"])("keeps a %s touch swipe alive when capture moves from a card to the fan", async locale => {
    const { cards, fan, send, selected } = await render(locale);
    expect(selected()).toBe(1);
    await send(cards[1], "pointerdown");
    await send(cards[1], "pointermove", 200);
    await send(fan, "pointerup", 100);
    expect(selected()).toBe(2);
    await send(fan, "click", 100, 100, { detail: 1 });
    expect(selected()).toBe(2);
    await send(cards[2], "pointerdown", 100);
    await send(cards[2], "pointermove", 120);
    await send(fan, "pointerup", 220);
    expect(selected()).toBe(1);
  });

  it("leaves vertical and near-diagonal touch movement to browser scrolling", async () => {
    const { cards, fan, capture, send, selected } = await render();
    await send(cards[1], "pointerdown", 100, 100);
    const vertical = await send(cards[1], "pointermove", 105, 140);
    await send(fan, "pointerup", 110, 230);
    expect(vertical.defaultPrevented).toBe(false);
    expect(capture).not.toHaveBeenCalled();
    expect(selected()).toBe(1);
    await send(cards[1], "pointerdown", 100, 100);
    const diagonal = await send(cards[1], "pointermove", 130, 130);
    await send(fan, "pointerup", 180, 180);
    expect(diagonal.defaultPrevented).toBe(false);
    expect(capture).not.toHaveBeenCalled();
    expect(selected()).toBe(1);
  });

  it.each(["pointercancel", "lostpointercapture"])("cancels on the fan's own %s", async type => {
    const { cards, fan, send, selected } = await render();
    await send(cards[1], "pointerdown");
    await send(cards[1], "pointermove", 200);
    await send(fan, type, 180);
    await send(fan, "pointerup", 100);
    expect(selected()).toBe(1);
  });
});


describe("source video category swipes", () => {
  it.each(["ko", "en", "ja"])("cycles categories in both directions in %s without opening the preview", async locale => {
    const { document, send: input, cards } = await render(locale);
    const send: typeof input = (target, type, x, y, extra) => input(target, type, x, y, { pointerType: "mouse", ...extra });
    const source = () => document.querySelector('figure button:not([aria-pressed])') as unknown as HTMLElement;
    const categoryIndex = () => Array.from(document.querySelectorAll('[role="tablist"] [role="tab"]')).findIndex(tab => tab.getAttribute("aria-selected") === "true");
    const initial = categoryIndex();
    const originalLabel = source().querySelector("video")!.getAttribute("aria-label");
    await send(cards[2], "click", 0, 0, { detail: 1 });
    for (let step = 1; step <= 6; step++) {
      const button = source();
      const video = button.querySelector("video")!;
      await send(video, "pointerdown", 220);
      await send(video, "pointermove", 200);
      await send(button, "pointerup", 100);
      expect(categoryIndex()).toBe((initial + step) % 6);
      await send(source(), "click", 100, 100, { detail: 1 });
      expect(document.querySelector("dialog")).toBeNull();
      const currentCards = Array.from(document.querySelectorAll('figure button[aria-pressed]'));
      expect(currentCards.map(card => card.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
      if (step === 1) expect(source().querySelector("video")!.getAttribute("aria-label")).not.toBe(originalLabel);
    }
    const button = source();
    await send(button.querySelector("video")!, "pointerdown", 100);
    await send(button.querySelector("video")!, "pointermove", 120);
    await send(button, "pointerup", 220);
    expect(categoryIndex()).toBe((initial + 5) % 6);
  });

  it("preserves vertical scrolling, cancellation, and tapping the source preview", async () => {
    const { document, send: input, capture } = await render();
    const send: typeof input = (target, type, x, y, extra) => input(target, type, x, y, { pointerType: "mouse", ...extra });
    const button = document.querySelector('figure button:not([aria-pressed])') as unknown as HTMLElement;
    const video = button.querySelector("video")!;
    const originalTab = document.querySelector('[role="tab"][aria-selected="true"]')?.id;
    await send(video, "pointerdown", 100, 100);
    const move = await send(video, "pointermove", 105, 160);
    await send(button, "pointerup", 105, 220);
    expect(move.defaultPrevented).toBe(false);
    expect(capture).not.toHaveBeenCalled();
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe(originalTab);
    await send(video, "pointerdown", 220);
    await send(video, "pointermove", 200);
    await send(button, "pointercancel");
    await send(button, "pointerup", 100);
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe(originalTab);
    await send(button, "pointerdown");
    await send(button, "pointerup");
    await send(button, "click", 220, 100, { detail: 1 });
    expect(document.querySelector("dialog")).not.toBeNull();
  });
});


describe("first-swipe guidance", () => {
  const key = "easycut.showcase.swiped.v1";
  it.each([["ko", "좌우로 넘겨보세요!"], ["en", "Swipe left or right!"], ["ja", "左右にスワイプしてみてね！"]])("shows localized guidance in %s without dismissing it on taps or scrolling", async (locale, label) => {
    const { document, cards, fan, send, storage } = await render(locale);
    expect(Array.from(document.querySelectorAll("[data-swipe-guide]")).map(x => x.textContent)).toEqual(["↔" + label, "↔" + label]);
    await send(cards[0], "click", 0, 0, { detail: 1 });
    await send(cards[0], "pointerdown", 100, 100);
    await send(cards[0], "pointermove", 103, 160);
    await send(fan, "pointerup", 103, 200);
    await send(cards[0], "pointerdown", 220);
    await send(cards[0], "pointermove", 200);
    await send(fan, "pointerup", 195);
    await send(cards[0], "pointerdown", 220);
    await send(cards[0], "pointermove", 200);
    await send(fan, "pointercancel");
    await send(fan, "pointerup", 100);
    expect(document.querySelectorAll("[data-swipe-guide]").length).toBe(2);
    expect(storage.has(key)).toBe(false);
  });
  it.each(["source", "short"])("remembers a successful %s swipe across locale changes and remounts", async area => {
    const { document, cards, fan, send, touch, storage, changeLocale } = await render();
    const surface = area === "source" ? document.querySelector('figure button:not([aria-pressed])') as unknown as HTMLElement : fan;
    const target = area === "source" ? surface.querySelector("video")! : cards[1];
    if (area === "source") {
      await touch(surface, "touchstart");
      await touch(surface, "touchmove", 200);
      await touch(surface, "touchend", 100);
    } else {
      await send(target, "pointerdown");
      await send(target, "pointermove", 200);
      await send(surface, "pointerup", 100);
    }
    expect(document.querySelectorAll("[data-swipe-guide]").length).toBe(0);
    expect(storage.get(key)).toBe("1");
    await changeLocale("en");
    expect(document.querySelectorAll("[data-swipe-guide]").length).toBe(0);
    await act(async () => root!.unmount()); root = undefined;
    const nextVisit = await render("ja", storage);
    expect(nextVisit.document.querySelectorAll("[data-swipe-guide]").length).toBe(0);
  });
  it("keeps navigation working when browser storage is unavailable", async () => {
    const { document, cards, fan, send, selected, changeLocale } = await render("ko", new Map(), true);
    expect(document.querySelectorAll("[data-swipe-guide]").length).toBe(2);
    await send(cards[1], "pointerdown");
    await send(cards[1], "pointermove", 200);
    await send(fan, "pointerup", 100);
    expect(selected()).toBe(2);
    expect(document.querySelectorAll("[data-swipe-guide]").length).toBe(0);
    await changeLocale("ja");
    expect(document.querySelectorAll("[data-swipe-guide]").length).toBe(0);
  });
  it("dismisses guidance when another tab records a successful swipe", async () => {
    const { document, window } = await render();
    const event = Object.assign(new window.Event("storage"), { key, newValue: "1" });
    await act(async () => { window.dispatchEvent(event); });
    expect(document.querySelectorAll("[data-swipe-guide]").length).toBe(0);
  });
});


describe("source native touch input", () => {
  it.each(["ko", "en", "ja"])("handles %s touch swipes even if pointer capture is cancelled, once per gesture", async locale => {
    const { document, send, touch, capture, storage } = await render(locale);
    const source = () => document.querySelector('figure button:not([aria-pressed])') as unknown as HTMLElement;
    const index = () => Array.from(document.querySelectorAll('[role="tablist"] [role="tab"]')).findIndex(tab => tab.getAttribute("aria-selected") === "true");
    const initial = index();
    for (let step = 1; step <= 6; step++) {
      const button = source();
      await send(button, "pointerdown", 240);
      await touch(button, "touchstart", 240);
      await send(button, "pointermove", 210);
      await touch(button, "touchmove", 210);
      await send(button, "pointercancel", 180);
      await send(button, "lostpointercapture", 180);
      await touch(button, "touchend", 90);
      expect(index()).toBe((initial + step) % 6);
      await send(source(), "click", 90, 100, { detail: 1 });
      expect(document.querySelector("dialog")).toBeNull();
    }
    expect(capture).not.toHaveBeenCalled();
    expect(storage.get("easycut.showcase.swiped.v1")).toBe("1");
    const button = source();
    await touch(button, "touchstart", 90);
    await touch(button, "touchend", 240);
    expect(index()).toBe((initial + 5) % 6);
  });

  it("allows vertical scrolling and pinch zoom, rejects cancellation, and keeps tap-to-preview", async () => {
    const { document, send, touch, capture, storage } = await render();
    const button = document.querySelector('figure button:not([aria-pressed])') as unknown as HTMLElement;
    const selected = () => document.querySelector('[role="tab"][aria-selected="true"]')?.id;
    const initial = selected();
    await touch(button, "touchstart", 220, 100);
    const vertical = await touch(button, "touchmove", 225, 160);
    await touch(button, "touchend", 320, 180);
    expect(vertical.defaultPrevented).toBe(false);
    expect(selected()).toBe(initial);
    await touch(button, "touchstart");
    await touch(button, "touchmove", 200);
    await touch(button, "touchcancel");
    await touch(button, "touchend", 90);
    expect(selected()).toBe(initial);
    await touch(button, "touchstart");
    await touch(button, "touchstart", 220, 100, 2);
    const pinch = await touch(button, "touchmove", 150, 100, 2);
    await touch(button, "touchend", 90);
    expect(pinch.defaultPrevented).toBe(false);
    expect(selected()).toBe(initial);
    expect(capture).not.toHaveBeenCalled();
    expect(storage.size).toBe(0);
    await touch(button, "touchstart");
    await touch(button, "touchend");
    await send(button, "click", 220, 100, { detail: 1 });
    expect(document.querySelector("dialog")).not.toBeNull();
  });
});
