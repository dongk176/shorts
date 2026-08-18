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
    expect(translateLegacyText("쇼츠 수익화 7가지 방법 다운로드", "en")).toBe(
      "7 ways to monetize Shorts Download",
    );
    expect(translateLegacyText("쇼츠 수익화 7가지 방법 표지", "ja")).toBe(
      "ショート動画を収益化する7つの方法 表紙",
    );
    expect(translateLegacyText("다크 자주 쓰는 템플릿에서 해제", "en")).toBe(
      "Dark Remove from favorites",
    );
    expect(translateLegacyText("어떤 영상을 쇼츠로 만들어야 할까? 가이드북 3페이지", "en")).toBe(
      "Which videos should you turn into Shorts? guidebook · Page 3",
    );
    expect(translateLegacyText("이 전자책을 2번 더 다운로드할 수 있습니다.", "ja")).toBe(
      "この電子書籍はあと2回ダウンロードできます。",
    );
    expect(translateLegacyText("1~3페이지 미리보기 · 전체 36페이지", "en")).toBe(
      "Preview pages 1–3 · 36 pages total",
    );
    expect(translateLegacyText("원본 영상 처리", "en")).toBe("Source-video processing");
    expect(translateLegacyText("10분 영상 기준", "ja")).toBe("10分動画基準");
    expect(translateLegacyText(" · 원본 영상 처리", "en")).toBe(" · Source-video processing");
    expect(translateLegacyText(" · 10분 영상 기준", "en")).toBe(" · Based on a 10-minute video");
    expect(translateLegacyText("AI 쇼츠 제작 자주 묻는 질문", "en")).toBe("AI Shorts FAQ");
    expect(translateLegacyText("이지컷·알파컷·피카클립", "ja")).toBe("Easy Cut・AlphaCut・FikaClip");
    expect(translateLegacyText("쇼츠가 정상적으로 생성되지 못했습니다. 사용량은 다시 복구되었습니다. 다시 시도해주세요.", "en")).toBe(
      "Shorts could not be created. Your usage was restored. Please try again.",
    );
  });

  it("does not translate arbitrary Korean content or source-video metadata", () => {
    const videoTitle = "세상에서 가장 신기한 영상";
    const channelName = "동민의 영상 채널";
    expect(translateLegacyText(videoTitle, "en")).toBe(videoTitle);
    expect(translateLegacyText(channelName, "ja")).toBe(channelName);
    expect(translateLegacyText(`${videoTitle} 다운로드`, "en")).toBe(`${videoTitle} Download`);
  });
});
