export const editorFontOptions = [
  {
    id: "pretendard",
    label: "프리텐다드",
    family: '"Editor Pretendard", "Noto Sans KR", sans-serif',
  },
  {
    id: "black-han-sans",
    label: "검은고딕",
    family: '"Editor Black Han Sans", "Noto Sans KR", sans-serif',
  },
  {
    id: "gmarket-sans",
    label: "G마켓 산스",
    family: '"Editor Gmarket Sans", "Noto Sans KR", sans-serif',
  },
  {
    id: "do-hyeon",
    label: "도현",
    family: '"Editor Do Hyeon", "Noto Sans KR", sans-serif',
  },
  {
    id: "noto-serif-kr",
    label: "노토 명조",
    family: '"Editor Noto Serif KR", "Noto Serif KR", serif',
  },
  {
    id: "nanum-myeongjo",
    label: "나눔명조",
    family: '"Editor Nanum Myeongjo", "Noto Serif KR", serif',
  },
  {
    id: "suit",
    label: "수트",
    family: '"Editor SUIT", "Noto Sans KR", sans-serif',
  },
  {
    id: "spoqa-han-sans-neo",
    label: "스포카 한 산스",
    family: '"Editor Spoqa Han Sans Neo", "Noto Sans KR", sans-serif',
  },
] as const;

export type EditorFontId = (typeof editorFontOptions)[number]["id"];
export const editorFontIds = editorFontOptions.map((font) => font.id) as [
  EditorFontId,
  ...EditorFontId[],
];

export const DEFAULT_EDITOR_FONT_ID: EditorFontId = "pretendard";

export function editorFontFamily(fontId: EditorFontId | undefined) {
  return editorFontOptions.find((font) => font.id === fontId)?.family
    || editorFontOptions[0].family;
}

export function editorFontLabel(fontId: EditorFontId | undefined) {
  return editorFontOptions.find((font) => font.id === fontId)?.label
    || editorFontOptions[0].label;
}
