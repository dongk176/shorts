export type TimelineZoomAnchor = { ratio: number; viewportX: number };

type GestureOptions = {
  getZoom: () => number;
  onZoom: (zoom: number, anchor: TimelineZoomAnchor) => void;
  min: number;
  max: number;
};

/** Native non-passive listeners keep a pinch local to the timeline. */
export function attachTimelineZoomGestures(area: HTMLElement, options: GestureOptions) {
  let pinch: { distance: number; zoom: number; ratio: number } | null = null;
  let suppressPointers = false;
  const pointers = new Map<number, { target: EventTarget; x: number; y: number }>();
  const clampZoom = (value: number) => Math.min(options.max, Math.max(options.min, value));
  const viewportX = (clientX: number) => Math.max(0, Math.min(area.clientWidth, clientX - area.getBoundingClientRect().left));
  const anchorAt = (clientX: number) => {
    const x = viewportX(clientX);
    return { viewportX: x, ratio: (area.scrollLeft + x) / Math.max(1, area.scrollWidth) };
  };
  const block = (event: Event) => { event.preventDefault(); event.stopPropagation(); };
  const cancelPointerEdits = () => {
    // Let the existing range/clip handlers finish their pointer lifecycle before zooming.
    for (const [pointerId, point] of [...pointers]) {
      point.target.dispatchEvent(new PointerEvent("pointercancel", {
        bubbles: true, pointerId, pointerType: "touch", clientX: point.x, clientY: point.y,
      }));
    }
    pointers.clear();
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "touch" || !event.target) return;
    pointers.set(event.pointerId, { target: event.target, x: event.clientX, y: event.clientY });
    if (pointers.size >= 2 || suppressPointers) {
      suppressPointers = true;
      cancelPointerEdits();
      block(event);
    }
  };
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === "touch" && suppressPointers) block(event);
  };
  const onPointerEnd = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (event.type === "pointerup" && suppressPointers) block(event);
  };
  const onWheel = (event: WheelEvent) => {
    if (!event.ctrlKey || pinch) return;
    event.preventDefault();
    // Trackpad pinches arrive as ctrl+wheel in Chromium; ordinary scrolling stays native.
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? area.clientHeight : 1);
    const next = clampZoom(options.getZoom() * Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.01));
    options.onZoom(next, anchorAt(event.clientX));
  };
  const touchPair = (event: TouchEvent) => {
    const a = event.touches[0];
    const b = event.touches[1];
    return { distance: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)), centerX: (a.clientX + b.clientX) / 2 };
  };
  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length < 2) return;
    suppressPointers = true;
    cancelPointerEdits();
    const pair = touchPair(event);
    pinch = { distance: pair.distance, zoom: options.getZoom(), ratio: anchorAt(pair.centerX).ratio };
    block(event);
  };
  const onTouchMove = (event: TouchEvent) => {
    if (!suppressPointers) return;
    block(event);
    if (!pinch || event.touches.length < 2) return;
    const pair = touchPair(event);
    options.onZoom(clampZoom(pinch.zoom * pair.distance / pinch.distance), {
      ratio: pinch.ratio, viewportX: viewportX(pair.centerX),
    });
  };
  const onTouchEnd = (event: TouchEvent) => {
    if (suppressPointers) block(event);
    if (event.touches.length < 2) pinch = null;
    // A remaining finger must not unexpectedly trim a clip after a pinch.
    if (event.touches.length === 0) { suppressPointers = false; pointers.clear(); }
  };

  area.addEventListener("wheel", onWheel, { passive: false });
  area.addEventListener("pointerdown", onPointerDown, true);
  area.addEventListener("pointermove", onPointerMove, true);
  area.addEventListener("pointerup", onPointerEnd, true);
  area.addEventListener("pointercancel", onPointerEnd, true);
  area.addEventListener("touchstart", onTouchStart, { passive: false, capture: true });
  area.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
  area.addEventListener("touchend", onTouchEnd, { passive: false, capture: true });
  area.addEventListener("touchcancel", onTouchEnd, { passive: false, capture: true });
  return () => {
    area.removeEventListener("wheel", onWheel);
    area.removeEventListener("pointerdown", onPointerDown, { capture: true });
    area.removeEventListener("pointermove", onPointerMove, { capture: true });
    area.removeEventListener("pointerup", onPointerEnd, { capture: true });
    area.removeEventListener("pointercancel", onPointerEnd, { capture: true });
    area.removeEventListener("touchstart", onTouchStart, { capture: true });
    area.removeEventListener("touchmove", onTouchMove, { capture: true });
    area.removeEventListener("touchend", onTouchEnd, { capture: true });
    area.removeEventListener("touchcancel", onTouchEnd, { capture: true });
  };
}
