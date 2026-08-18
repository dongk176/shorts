import { describe, expect, it } from "vitest";
import { translateLegacyText } from "./legacy-phrases";

describe("legacy UI translations", () => {
  it("translates representative customer-facing controls in English and Japanese", () => {
    expect(translateLegacyText("빈 화면에서 직접 디자인하기", "en")).toBe("Design from scratch");
    expect(translateLegacyText("채팅방 입장", "ja")).toBe("チャットに参加");
    expect(translateLegacyText("스타터 패키지 6개월", "en")).toBe("Starter package · 6 months");
    expect(translateLegacyText("3개월", "en")).toBe("3 months");
    expect(translateLegacyText("300분", "ja")).toBe("300分");
    expect(translateLegacyText("1.3천", "en")).toBe("1.3K");
    expect(translateLegacyText("20% 할인", "ja")).toBe("20%割引");
    expect(translateLegacyText("2026. 11. 13.까지 이용", "en")).toBe("Available until 2026-11-13");
    expect(translateLegacyText("3개월 총 70,965원 (월 환산 23,655원)", "en")).toBe(
      "3 months · KRW 70,965 total (KRW 23,655/month equivalent)",
    );
    expect(translateLegacyText("300분 48,000원 · 600분 84,000원", "ja")).toBe(
      "300分 48,000ウォン · 600分 84,000ウォン",
    );
    expect(translateLegacyText("유튜브 링크 입력", "en")).toBe("Paste a YouTube link");
    expect(translateLegacyText("다시 결제하기", "ja")).toBe("もう一度支払う");
  });

  it("does not translate arbitrary Korean content or source-video metadata", () => {
    const videoTitle = "세상에서 가장 신기한 영상";
    const channelName = "동민의 영상 채널";
    expect(translateLegacyText(videoTitle, "en")).toBe(videoTitle);
    expect(translateLegacyText(channelName, "ja")).toBe(channelName);
  });
});
