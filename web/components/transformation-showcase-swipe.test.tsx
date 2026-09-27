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

async function render(locale = "ko") {
  language.locale = locale;
  const { window, document } = parseHTML("<html><body><div id='app'></div></body></html>");
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
  return { cards, fan, capture, send, selected, document };
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
    const { document, send, cards } = await render(locale);
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
    const { document, send, capture } = await render();
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
