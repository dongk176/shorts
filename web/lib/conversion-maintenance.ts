export const CONVERSION_MAINTENANCE_START_MS = Date.parse("2026-08-18T01:40:00.000Z");
export const CONVERSION_MAINTENANCE_END_MS = Date.parse("2026-08-18T03:40:00.000Z");

export function isConversionMaintenanceActive(nowMs = Date.now()) {
  return nowMs >= CONVERSION_MAINTENANCE_START_MS
    && nowMs < CONVERSION_MAINTENANCE_END_MS;
}
