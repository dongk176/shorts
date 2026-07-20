import { describe, expect, it } from "vitest";
import { createDefaultTemplateConfig, templateConfigSchema, videoFrameForAspect } from "@/lib/template-config";

describe("personal template config", () => {
  it("creates bounded frames for every supported aspect ratio", () => {
    for (const ratio of ["16:9", "5:4", "1:1", "4:5", "9:16"] as const) {
      const frame = videoFrameForAspect(ratio);
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.width).toBeLessThanOrEqual(1080);
      expect(frame.y + frame.height).toBeLessThanOrEqual(1920);
    }
  });

  it("rejects an arbitrary color outside the fixed palette", () => {
    const config = createDefaultTemplateConfig();
    expect(() => templateConfigSchema.parse({
      ...config,
      background: { kind: "color", color: "#123456" },
    })).toThrow();
  });
});
