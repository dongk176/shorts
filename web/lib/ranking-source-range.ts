// Only reconcile a small embedded-player/container tail discrepancy.
// Do not shift the start, pad a source, or shorten a materially wrong selection.
export function rankingSourceEnd(start: number, end: number, duration: unknown): number {
  return typeof duration === "number" && Number.isFinite(duration) && end > duration
    && end - duration <= 0.5 && duration - start >= 0.5 ? duration : end;
}
