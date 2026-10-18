import { describe, expect, it, vi } from "vitest";
import { attachTimelineZoomGestures, type TimelineZoomAnchor } from "./editor-timeline-gestures";

class Area extends EventTarget {
  clientWidth = 300;
  clientHeight = 200;
  scrollWidth = 600;
  scrollLeft = 100;
  getBoundingClientRect() { return { left: 20 }; }
}
function fire(area: EventTarget, type: string, values: Record<string, unknown>) {
  const event = Object.assign(new Event(type, { cancelable: true, bubbles: true }), values);
  area.dispatchEvent(event);
  return event;
}
function setup(initialZoom = 1) {
  const area = new Area();
  let zoom = initialZoom;
  const onZoom = vi.fn((next: number, anchor: TimelineZoomAnchor) => { zoom = next; return anchor; });
  const dispose = attachTimelineZoomGestures(area as unknown as HTMLElement, { getZoom: () => zoom, onZoom, min: 1, max: 3 });
  return { area, onZoom, dispose, zoom: () => zoom };
}
const touches = (left: number, right: number) => [
  { clientX: left, clientY: 100 }, { clientX: right, clientY: 100 },
];

describe("timeline pinch gestures", () => {
  it("keeps regular wheel scrolling native and handles a trackpad pinch at its anchor", () => {
    const { area, onZoom, zoom } = setup();
    expect(fire(area, "wheel", { ctrlKey: false, deltaY: -30, deltaMode: 0, clientX: 170 }).defaultPrevented).toBe(false);
    expect(onZoom).not.toHaveBeenCalled();
    expect(fire(area, "wheel", { ctrlKey: true, deltaY: -30, deltaMode: 0, clientX: 170 }).defaultPrevented).toBe(true);
    expect(zoom()).toBeCloseTo(Math.exp(0.3));
    expect(onZoom.mock.calls[0][1]).toEqual({ ratio: 250 / 600, viewportX: 150 });
  });
  it("scales around the original two-finger anchor while the midpoint moves", () => {
    const { area, onZoom, zoom } = setup();
    fire(area, "touchstart", { touches: touches(70, 170) });
    fire(area, "touchmove", { touches: touches(65, 215) });
    expect(zoom()).toBe(1.5);
    expect(onZoom.mock.calls[0][1]).toEqual({ ratio: 200 / 600, viewportX: 120 });
  });
  it("respects zoom limits for both gestures", () => {
    const { area, zoom } = setup(2);
    fire(area, "touchstart", { touches: touches(70, 170) });
    fire(area, "touchmove", { touches: touches(20, 320) });
    expect(zoom()).toBe(3);
    fire(area, "touchmove", { touches: touches(100, 110) });
    expect(zoom()).toBe(1);
    fire(area, "touchend", { touches: [] });
    fire(area, "wheel", { ctrlKey: true, deltaY: -10000, deltaMode: 0, clientX: 170 });
    expect(zoom()).toBe(3);
  });
  it("does not treat single-finger scrolling as zoom and blocks accidental trims after pinching", () => {
    const { area, onZoom } = setup();
    expect(fire(area, "touchmove", { touches: [{ clientX: 70, clientY: 100 }] }).defaultPrevented).toBe(false);
    expect(onZoom).not.toHaveBeenCalled();
    fire(area, "touchstart", { touches: touches(70, 170) });
    fire(area, "touchend", { touches: [{ clientX: 70, clientY: 100 }] });
    expect(fire(area, "pointermove", { pointerType: "touch", pointerId: 1 }).defaultPrevented).toBe(true);
    fire(area, "touchend", { touches: [] });
    expect(fire(area, "pointermove", { pointerType: "touch", pointerId: 3 }).defaultPrevented).toBe(false);
  });
  it("cancels existing pointer edits when a second finger arrives", () => {
    // Node has no PointerEvent; preserve browser-like fields on the cancellation event.
    vi.stubGlobal("PointerEvent", class extends Event {
      pointerId: number;
      pointerType: string;
      constructor(type: string, init: { pointerId: number; pointerType: string }) {
        super(type); this.pointerId = init.pointerId; this.pointerType = init.pointerType;
      }
    });
    try {
      const { area } = setup();
      const cancelled: number[] = [];
      area.addEventListener("pointercancel", (event) => cancelled.push((event as unknown as { pointerId: number }).pointerId));
      fire(area, "pointerdown", { pointerId: 1, pointerType: "touch", clientX: 70, clientY: 100 });
      const second = fire(area, "pointerdown", { pointerId: 2, pointerType: "touch", clientX: 170, clientY: 100 });
      expect(cancelled).toEqual([1, 2]);
      expect(second.defaultPrevented).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });
  it("removes listeners when the editor closes", () => {
    const { area, onZoom, dispose } = setup();
    dispose();
    expect(fire(area, "wheel", { ctrlKey: true, deltaY: -30, deltaMode: 0, clientX: 170 }).defaultPrevented).toBe(false);
    fire(area, "touchstart", { touches: touches(70, 170) });
    fire(area, "touchmove", { touches: touches(20, 220) });
    expect(onZoom).not.toHaveBeenCalled();
  });
});
