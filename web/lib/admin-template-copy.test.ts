import { describe, expect, it } from "vitest";
import {
  presetTemplateDisplayDescription,
  presetTemplateDisplayName,
} from "./admin-template-copy";

describe("admin preset template copy", () => {
  it("keeps the established names for regular users", () => {
    expect(presetTemplateDisplayName("dark-red", "다크 레드", false)).toBe("다크 레드");
    expect(presetTemplateDisplayName("white-yellow", "화이트 옐로", false)).toBe("화이트 옐로");
  });

  it("removes obsolete fixed color names only for the admin candidate", () => {
    expect(presetTemplateDisplayName("dark-red", "다크 레드", true)).toBe("다크");
    expect(presetTemplateDisplayName("white-yellow", "화이트 옐로", true)).toBe("화이트");
    expect(presetTemplateDisplayDescription(
      "dark-red",
      "기존 설명",
      true,
    )).toContain("브랜드 컬러");
  });
});
