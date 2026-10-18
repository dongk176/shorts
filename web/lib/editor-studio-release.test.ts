import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { publicationIssues, updateDraftSchema } from "./update-content";
import { localizeUpdate, missingUpdateTexts } from "./update-localization";
import { createUiText } from "./i18n/ui-text";
const post = updateDraftSchema.parse(JSON.parse(readFileSync(new URL("../../docs/reviews/editor-studio-update-20261018.json", import.meta.url), "utf8")));
describe("editor release announcement", () => {
 it("is publishable with complete English and Japanese copy", () => {
  expect(publicationIssues(post, "2026-10-18")).toEqual([]);
  for (const locale of ["en", "ja"] as const) {
   expect(missingUpdateTexts(post, locale)).toEqual([]);
   const translated = localizeUpdate(post, locale)!;
   expect(translated).not.toBeNull();
   expect(translated.title).not.toMatch(/[가-힣]/);
   expect(translated.shot?.src).toBe(post.shot?.src);
  }
 });
 it("translates the new timeline accessibility labels", () => {
  for (const locale of ["en", "ja"] as const) {
   const ui = createUiText(locale);
   for (const label of ["타임라인 확대", "타임라인 축소", "타임라인 확대 비율", "타임라인 시간 눈금", "타임라인 높이 조절", "텍스트 수정", "영상 레이아웃 설정", "변경사항 적용 필요", "현재 영상과 같음", "적용 요청됨", "편집 내용을 전달하고 있습니다.", "영상 시작 구간 조절", "영상 끝 구간 조절", "재생 위치", "이 템플릿은 배치가 고정되어 있습니다. 아래 타임라인에서 영상 구간을 조절할 수 있습니다."]) expect(ui(label)).not.toMatch(/[가-힣]/);
  }
 });
});
