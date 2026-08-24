import { describe, expect, it } from "vitest";
import {
  DEFAULT_FAVORITE_TEMPLATE_KEYS,
  MAX_FAVORITE_TEMPLATES,
  customTemplateFavoriteKey,
  favoriteCustomTemplateId,
  favoritePresetTemplateId,
  presetTemplateFavoriteKey,
  templateFavoriteKeysSchema,
  updateFavoriteTemplateKeys,
} from "@/lib/template-favorites";

describe("template favorites", () => {
  it("starts with the three templates already shown on home", () => {
    expect(DEFAULT_FAVORITE_TEMPLATE_KEYS).toEqual([
      "preset:comment-capture",
      "preset:dark-minimal",
      "preset:paper",
    ]);
  });

  it("adds, removes, and limits favorites to four", () => {
    const customKey = customTemplateFavoriteKey("6f856acc-5b6a-4f62-9971-d7feb1f2a624");
    const added = updateFavoriteTemplateKeys(DEFAULT_FAVORITE_TEMPLATE_KEYS, customKey);
    expect(added.status).toBe("added");
    expect(added.templateKeys).toHaveLength(MAX_FAVORITE_TEMPLATES);

    const limited = updateFavoriteTemplateKeys(added.templateKeys, presetTemplateFavoriteKey("dark-red"));
    expect(limited.status).toBe("limit");
    expect(limited.templateKeys).toEqual(added.templateKeys);

    const removed = updateFavoriteTemplateKeys(added.templateKeys, customKey);
    expect(removed.status).toBe("removed");
    expect(removed.templateKeys).toEqual(DEFAULT_FAVORITE_TEMPLATE_KEYS);
  });

  it("validates keys, uniqueness, and the maximum", () => {
    expect(templateFavoriteKeysSchema.safeParse(DEFAULT_FAVORITE_TEMPLATE_KEYS).success).toBe(true);
    expect(templateFavoriteKeysSchema.safeParse(["preset:unknown"]).success).toBe(false);
    expect(templateFavoriteKeysSchema.safeParse([DEFAULT_FAVORITE_TEMPLATE_KEYS[0], DEFAULT_FAVORITE_TEMPLATE_KEYS[0]]).success).toBe(false);
    expect(templateFavoriteKeysSchema.safeParse([
      ...DEFAULT_FAVORITE_TEMPLATE_KEYS,
      presetTemplateFavoriteKey("dark-red"),
      presetTemplateFavoriteKey("white-yellow"),
    ]).success).toBe(false);
  });

  it("reads preset and custom ids from stored keys", () => {
    const customId = "6f856acc-5b6a-4f62-9971-d7feb1f2a624";
    expect(favoritePresetTemplateId("preset:paper")).toBe("paper");
    expect(favoriteCustomTemplateId(customTemplateFavoriteKey(customId))).toBe(customId);
    expect(favoritePresetTemplateId(customTemplateFavoriteKey(customId))).toBeNull();
  });
});
