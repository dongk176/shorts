import { describe, expect, it } from "vitest";
import {
  CONVERSION_MAINTENANCE_END_MS,
  CONVERSION_MAINTENANCE_START_MS,
  isConversionMaintenanceActive,
} from "./conversion-maintenance";

describe("conversion maintenance window", () => {
  it("starts at 10:40 KST and ends just before 12:40 KST", () => {
    expect(isConversionMaintenanceActive(CONVERSION_MAINTENANCE_START_MS - 1)).toBe(false);
    expect(isConversionMaintenanceActive(CONVERSION_MAINTENANCE_START_MS)).toBe(true);
    expect(isConversionMaintenanceActive(CONVERSION_MAINTENANCE_END_MS - 1)).toBe(true);
    expect(isConversionMaintenanceActive(CONVERSION_MAINTENANCE_END_MS)).toBe(false);
  });
});
