import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  POPULAR_PRIVATE_DISMISSED_STORAGE_KEY,
  shouldShowPopularPrivateAnnouncement,
} from "@/lib/popular-private-announcement";

const source = readFileSync(
  new URL("./popular-private-announcement.tsx", import.meta.url),
  "utf8",
);
const popularExplorerSource = readFileSync(
  new URL("../app/실시간인기/popular-videos-explorer.tsx", import.meta.url),
  "utf8",
);

describe("popular private announcement", () => {
  it("is not mounted on the popular videos page", () => {
    expect(popularExplorerSource).not.toContain("PopularPrivateAnnouncement");
  });

  it("shows only on mobile while the permanent preference is unset", () => {
    expect(shouldShowPopularPrivateAnnouncement({ mobile: true, dismissed: null })).toBe(true);
    expect(shouldShowPopularPrivateAnnouncement({ mobile: false, dismissed: null })).toBe(false);
    expect(shouldShowPopularPrivateAnnouncement({ mobile: true, dismissed: "1" })).toBe(false);
  });

  it("links the confirm action directly to the EASYCUT PRIVATE open chat", () => {
    expect(source).toContain("https://open.kakao.com/o/gBO91xHi");
    expect(source).not.toContain("https://www.easycut.co.kr/easycut-private");
    expect(source).not.toContain("살펴보기");
    expect(source).toContain('text-[15px] font-black');
    expect(source).not.toContain('text-[17px] font-black');
    expect(source).toContain('title: "쇼츠 제작 정보를 한곳에서"');
    expect(source).toContain("재사용 허용으로 표시된 영상 추천과 쇼츠 제작 노하우");
    expect(source).not.toContain("큐레이션");
    expect(source).not.toContain("제작 인사이트");
    expect(source).not.toContain("대표가 직접 고른");
    expect(source).not.toContain("selected by Easy Cut");
    expect(source).not.toContain("代表が厳選した");
    expect(source).toContain('dismiss: "다시 보지 않기"');
    expect(source).toContain('confirm: "확인"');
  });

  it("persists only the do-not-show-again action", () => {
    expect(POPULAR_PRIVATE_DISMISSED_STORAGE_KEY).toBe(
      "easycut:popular-private-announcement-dismissed:v1",
    );
    expect(source).toContain("onClick={dismissPermanently}");
    expect(source).toContain("onClick={closeForVisit}");
    expect(source.match(/window\.localStorage\.setItem/g)).toHaveLength(1);
  });

  it("closes for the current visit when the backdrop is pressed", () => {
    expect(source).toContain("event.target === event.currentTarget");
    expect(source).toContain("if (event.target === event.currentTarget) closeForVisit()");
  });
});
