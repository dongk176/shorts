// Embedded players can report a whole-second ceiling of the actual container.
// Accept that exact ceiling, or the existing half-second metadata discrepancy.
// Do not shift the start, pad a source, or shorten a materially wrong selection.
export function rankingSourceEnd(start: number, end: number, duration: unknown): number {
  return typeof duration === "number" && Number.isFinite(duration) && end > duration
    && (end - duration <= 0.5 || end === Math.ceil(duration))
    && duration - start >= 0.5 ? duration : end;
}
