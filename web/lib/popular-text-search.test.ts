import { describe, expect, it } from "vitest";
import { escapeSearchLike, normalizePopularQuery, popularQueryGroups } from "./popular-text-search";

describe("popular search normalization", () => {
  it("normalizes Unicode, spacing and case without changing literal wildcard characters", () => {
    expect(normalizePopularQuery("  ＡＩ\t강의　 ")).toBe("ai 강의");
    expect(normalizePopularQuery("한글")).toBe("한글");
    expect(escapeSearchLike("50% a_b\\c")).toBe("50\\% a\\_b\\\\c");
  });
  it("expands complete aliases while retaining every independent query term", () => {
    expect(popularQueryGroups("Elon Musk 인터뷰")).toEqual([["일론머스크", "일론 머스크", "elon musk"], ["인터뷰"]]);
    expect(popularQueryGroups("축구 실수")).toEqual([["축구"], ["실수"]]);
    expect(popularQueryGroups("train")).toEqual([["train"]]);
    expect(popularQueryGroups("챗GPT 사용법")[0]).toContain("chatgpt");
  });
});
