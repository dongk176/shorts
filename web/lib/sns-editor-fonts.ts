import type { SnsLanguage } from "./sns-editor-contract";

const loaded = new Map<string, Promise<void>>();
export const snsFontFamily = (language: SnsLanguage, weight: number) => language === "ja" ? "SnsJapanese" : weight === 600 ? "SnsBody" : weight === 400 ? "SnsTags" : "SnsTitle";
export function loadSnsFonts(language: SnsLanguage) {
  const definitions = language === "ja"
    ? [["SnsJapanese", "NotoSansCJKjp-Variable.ttf", "100 900"]]
    : [["SnsTitle", "Pretendard-Bold.woff2", "700"], ["SnsBody", "Pretendard-SemiBold.ttf", "600"], ["SnsTags", "NotoSansKR-Variable.ttf", "100 900"]];
  return Promise.all(definitions.map(([family, file, weight]) => {
    if (!loaded.has(family)) loaded.set(family, new FontFace(family, `url(/fonts/editor/${file})`, { weight }).load().then(face => { document.fonts.add(face); }).catch(error => { loaded.delete(family); throw error; }));
    return loaded.get(family)!;
  }));
}
export async function validateSnsTextWidths(content: { boardName?: string; title: string; body: string[]; hashtags: string[] }, ratio: string, language: SnsLanguage) {
  await loadSnsFonts(language);
  const context = document.createElement("canvas").getContext("2d");
  if (!context) throw new Error("미리보기 글꼴을 불러오지 못했습니다. 다시 시도해 주세요.");
  const width = (text: string, size: number, weight: number, spacing: number) => {
    context.font = `${weight} ${size}px ${snsFontFamily(language, weight)}`;
    return [...text].reduce((sum, c) => sum + context.measureText(c).width, 0) + Math.max(0, [...text].length - 1) * spacing;
  };
  if (content.boardName && width(content.boardName, 96, 700, -3) > 939) throw new Error("게시판 이름을 조금 더 짧게 입력해 주세요.");
  if (width(content.title, 80, 700, -3) > 899) throw new Error("제목이 한 줄을 넘습니다. 조금 더 짧게 입력해 주세요.");
  if (content.body.some(line => width(line, 72, 600, -1.7) > (ratio === "9:16" ? 719 : 959))) throw new Error("본문이 영상 폭을 넘습니다. 조금 더 짧게 입력해 주세요.");
  if (width(content.hashtags.join("  "), 47, 400, -0.5) > 959) throw new Error("해시태그를 조금 더 짧게 입력해 주세요.");
}
