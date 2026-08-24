export const CENTER_SNAP_THRESHOLD_PX = 8;

export type AxisSnap = {
  value: number;
  snapped: boolean;
};

export function snapAxisToCenter(value: number, center: number, threshold: number): AxisSnap {
  if (Math.abs(value - center) <= threshold) return { value: center, snapped: true };
  return { value, snapped: false };
}
