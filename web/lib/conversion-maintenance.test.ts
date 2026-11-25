import { describe, expect, it } from "vitest";
import {
  CONVERSION_MAINTENANCE_END_MS,
  CONVERSION_MAINTENANCE_START_MS,
  isConversionMaintenanceActive,
} from "./conversion-maintenance";

describe("conversion maintenance window", () => {
  it("ends exactly at November 25, 14:00 KST", () => {
    expect(isConversionMaintenanceActive(CONVERSION_MAINTENANCE_START_MS - 1, "scheduled")).toBe(false);
    expect(isConversionMaintenanceActive(CONVERSION_MAINTENANCE_START_MS, "scheduled")).toBe(true);
    expect(isConversionMaintenanceActive(CONVERSION_MAINTENANCE_END_MS - 1, "scheduled")).toBe(true);
    expect(isConversionMaintenanceActive(CONVERSION_MAINTENANCE_END_MS, "scheduled")).toBe(false);
  });
});


describe("recovery release pin", () => {
  it("keeps the button and API closed until the verified open release", () => {
    expect(isConversionMaintenanceActive(CONVERSION_MAINTENANCE_END_MS + 1, "recovery")).toBe(true);
    expect(isConversionMaintenanceActive(CONVERSION_MAINTENANCE_START_MS, "open")).toBe(false);
  });
});
