import { editorFontOptions } from "@/lib/editor-fonts";
import { describe, expect, it } from "vitest";
import { messagesByLocale, interpolateMessage } from "./messages";
import { translateLegacyText } from "./legacy-phrases";
import { stockBackgrounds, templateConfigColorOptions } from "@/lib/template-config";
import { userOccupationOptions, userUsagePurposeOptions, userDiscoverySourceOptions } from "@/lib/user-onboarding";

describe("language audit regressions", () => {
  it.each(["en", "ja"] as const)("localizes complete editor labels and reward messages in %s", locale => {
    const labels = [
      "기본형 자막 위치·크기·텍스트 편집", "기본형 자막 위치·크기 설정", "강조형 자막 위치·크기 설정",
      "영상 구간 선택", "레이어", "영상 구간", "브랜드 색상", "롱폼 → 숏폼",
      "일부 작업을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.",
      ...stockBackgrounds.map(asset => `이미지 배경 ${asset.label}`),
      "솔직한 의견 감사합니다. 지급된 원본 영상 처리시간은 30일 동안 사용할 수 있어요.",
    ];
    for (const label of labels) expect(translateLegacyText(label, locale), label).not.toMatch(/[가-힣]/);
    expect(translateLegacyText(labels.at(-1)!, locale)).toContain("30");
    expect(translateLegacyText("이미지 배경 뉴스 블루", locale)).toContain(locale === "en" ? "News blue" : "ニュース・ブルー");
  });

  it("uses singular English counters", () => {
    expect(translateLegacyText("쇼츠 1개", "en")).toBe("1 Short");
    expect(translateLegacyText("1개월", "en")).toBe("1 month");
    expect(translateLegacyText("1일", "en")).toBe("1 day");
  });
  it.each(["en", "ja"] as const)("translates data-driven %s onboarding, background and color labels", (locale) => {
    const labels: string[] = [
      ...userOccupationOptions, ...userUsagePurposeOptions, ...userDiscoverySourceOptions,
      ...stockBackgrounds, ...editorFontOptions,
    ].map((item) => item.label);
    labels.push(...templateConfigColorOptions.map((color) => color.name));
    for (const label of labels) expect(translateLegacyText(label, locale), label).not.toMatch(/[가-힣]/);
  });

  it("uses whole sentences for dynamic metadata and preserves original filenames in labels", () => {
    expect(interpolateMessage(messagesByLocale.en["home.uploadMetadata"], { size: "3.2", duration: "3m 0s" }))
      .toBe("3.2 MB · 3m 0s · Video details checked");
    expect(interpolateMessage(messagesByLocale.ja["home.sourceSummary"], { duration: "10分 0秒", count: 8 }))
      .toBe("元動画：10分 0秒 · ショート動画の予想本数：8本");
    expect(interpolateMessage(messagesByLocale.en["background.select"], { title: "저장.png" }))
      .toBe("Select background: 저장.png");
  });

  it("keeps purchase consent clauses in the correct English and Japanese order", () => {
    const text = (locale: "en" | "ja") => {
      const m = messagesByLocale[locale];
      return m["consent.prefix"] + m["consent.purchaseTerms"] + m["consent.and"] + m["consent.refundRules"] + m["consent.suffix"];
    };
    expect(text("en")).toBe("I have read and agree to the Purchase Terms and Cancellation and Refund Policy.");
    expect(text("ja")).toBe("購入規約およびキャンセル・返金規定を確認し、同意します。");
  });
});
