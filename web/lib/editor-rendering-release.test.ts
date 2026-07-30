import { describe, expect, it, vi } from "vitest";
import {
  editorRenderingV2Enabled,
  editorRenderingV2MasterEnabled,
  editorRenderingV2TestUserIds,
} from "./editor-rendering-release";

describe("editor rendering v2 release gate", () => {
  it("requires the server-side master switch", () => {
    expect(editorRenderingV2MasterEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(editorRenderingV2MasterEnabled({
      NODE_ENV: "production",
      EDITOR_RENDERING_V2_ENABLED: " true ",
    })).toBe(true);
  });

  it("accepts only UUID-shaped internal tester ids", () => {
    const ids = editorRenderingV2TestUserIds({
      EDITOR_RENDERING_V2_TEST_USER_IDS:
        "bad,d164fb8d-d6e1-4232-8463-9115cdf7e561",
    });
    expect([...ids]).toEqual(["d164fb8d-d6e1-4232-8463-9115cdf7e561"]);
  });

  it("does not query the runtime flag while the master switch is off", async () => {
    const db = vi.fn();
    await expect(editorRenderingV2Enabled(
      db as never,
      "d164fb8d-d6e1-4232-8463-9115cdf7e561",
      {},
    )).resolves.toBe(false);
    expect(db).not.toHaveBeenCalled();
  });

  it("never enables saving for an anonymous session", async () => {
    const db = vi.fn();
    await expect(editorRenderingV2Enabled(
      db as never,
      null,
      { EDITOR_RENDERING_V2_ENABLED: "true" },
    )).resolves.toBe(false);
    expect(db).not.toHaveBeenCalled();
  });
});
