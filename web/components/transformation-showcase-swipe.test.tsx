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
  Object.assign(window.HTMLElement.prototype, { pause() {}, load() {}, play: async () => {} });
  root = createRoot(document.getElementById("app")! as unknown as Element);
  await act(async () => root!.render(<TransformationShowcase />));
  const cards = Array.from(document.querySelectorAll('figure button[aria-pressed]')) as unknown as HTMLElement[];
  const fan = cards[0].parentElement!.parentElement!;
  let captured: HTMLElement | null = null;
  const event = (type: string, x = 220, y = 100, extra = {}) => Object.assign(new window.Event(type, { bubbles: true, cancelable: true }), { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, clientX: x, clientY: y, ...extra });
  const capture = vi.fn(() => {
    const previous = captured;
    captured = fan;
    // Touch implicitly captures the starting button. Moving capture to the
    // carousel emits a bubbling lostpointercapture from that child button.
    if (previous && previous !== fan) previous.dispatchEvent(event("lostpointercapture") as unknown as Event);
  });
  Object.assign(window.HTMLElement.prototype, { setPointerCapture: capture });
  const send = async (target: HTMLElement, type: string, x = 220, y = 100, extra = {}) => {
    if (type === "pointerdown") captured = target;
    const input = event(type, x, y, extra);
    await act(async () => { target.dispatchEvent(input as unknown as Event); });
    return input;
  };
  const selected = () => cards.findIndex(card => card.getAttribute("aria-pressed") === "true");
  return { cards, fan, capture, send, selected };
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
