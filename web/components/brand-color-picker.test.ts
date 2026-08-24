import { describe, expect, it } from "vitest";
import { compactBrandColorOptions } from "@/lib/brand-color-picker-options";

describe("compact brand color picker", () => {
  it("keeps a selected fifth compact color inside the four mobile slots", () => {
    expect(compactBrandColorOptions("#3B82F6").slice(0, 4).map(
      (option) => option.color,
    )).toContain("#3B82F6");
  });

  it("keeps an expanded-palette selection inside the four mobile slots", () => {
    expect(compactBrandColorOptions("#A78BFA").slice(0, 4).map(
      (option) => option.color,
    )).toContain("#A78BFA");
  });
});
