import { describe, expect, it } from "vitest";
import {
  CONVERSION_MAINTENANCE_END_MS,
  CONVERSION_MAINTENANCE_START_MS,
  isConversionMaintenanceActive,
} from "./conversion-maintenance";

describe("conversion maintenance window", () => {
  it("ends exactly at November 25, 14:00 KST", () => {
    expect(isConversionMaintenanceActive(CONVERSION_MAINTENANCE_START_MS - 1)).toBe(false);
    expect(isConversionMaintenanceActive(CONVERSION_MAINTENANCE_START_MS)).toBe(true);
    expect(isConversionMaintenanceActive(CONVERSION_MAINTENANCE_END_MS - 1)).toBe(true);
    expect(isConversionMaintenanceActive(CONVERSION_MAINTENANCE_END_MS)).toBe(false);
  });
});
