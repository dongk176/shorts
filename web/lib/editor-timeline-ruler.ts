/** Compact offsets for editor chrome; keep fractional seconds only when needed. */
export function formatEditorTimelineTime(seconds: number): string {
  const tenths = Math.round(Math.abs(seconds) * 10);
  const minutes = Math.floor(tenths / 600);
  const wholeSeconds = Math.floor(tenths / 10) % 60;
  const fraction = tenths % 10;
  return `${seconds < 0 && tenths > 0 ? "−" : ""}${minutes}:${String(wholeSeconds).padStart(2, "0")}${fraction ? `.${fraction}` : ""}`;
}

export function editorTimelineRulerTicks(start: number, duration: number, width: number) {
  // Include fractional precision in the width estimate and leave room at both edges.
  const longestLabel = Math.max(
    formatEditorTimelineTime(start).length,
    formatEditorTimelineTime(start + duration).length,
  ) + 2;
  const spacing = Math.max(72, longestLabel * 7 * 1.5 + 16);
  const capacity = Math.max(1, Math.floor(width / spacing));
  const intervals = [1, 2, 4, 8, 12, 16, 24, 32].filter((count) => count <= capacity).at(-1) ?? 1;
  return Array.from({ length: intervals + 1 }, (_, index) => ({
    position: index / intervals * 100,
    label: formatEditorTimelineTime(start + duration * index / intervals),
  }));
}
