export const editorFontOptions = [
  {
    id: "pretendard",
    label: "프리텐다드",
    family: '"Editor Pretendard", "Noto Sans KR", sans-serif',
    renderFamily: '"Editor V3 Pretendard", sans-serif',
    fileName: "Pretendard-Bold.woff2",
    staticWeight: 700,
  },
  {
    id: "black-han-sans",
    label: "검은고딕",
    family: '"Editor Black Han Sans", "Noto Sans KR", sans-serif',
    renderFamily: '"Editor V3 Black Han Sans", sans-serif',
    fileName: "BlackHanSans-Regular.ttf",
    staticWeight: 400,
  },
  {
    id: "gmarket-sans",
    label: "G마켓 산스",
    family: '"Editor Gmarket Sans", "Noto Sans KR", sans-serif',
    renderFamily: '"Editor V3 Gmarket Sans", sans-serif',
    fileName: "GmarketSans-Bold.ttf",
    staticWeight: 700,
  },
  {
    id: "do-hyeon",
    label: "도현",
    family: '"Editor Do Hyeon", "Noto Sans KR", sans-serif',
    renderFamily: '"Editor V3 Do Hyeon", sans-serif',
    fileName: "DoHyeon-Regular.ttf",
    staticWeight: 400,
  },
  {
    id: "noto-serif-kr",
    label: "노토 명조",
    family: '"Editor Noto Serif KR", "Noto Serif KR", serif',
    renderFamily: '"Editor V3 Noto Serif KR", serif',
    fileName: "NotoSerifKR-Variable.ttf",
    staticWeight: null,
  },
  {
    id: "nanum-myeongjo",
    label: "나눔명조",
    family: '"Editor Nanum Myeongjo", "Noto Serif KR", serif',
    renderFamily: '"Editor V3 Nanum Myeongjo", serif',
    fileName: "NanumMyeongjo-Bold.ttf",
    staticWeight: 700,
  },
  {
    id: "suit",
    label: "수트",
    family: '"Editor SUIT", "Noto Sans KR", sans-serif',
    renderFamily: '"Editor V3 SUIT", sans-serif',
    fileName: "SUIT-Bold.woff2",
    staticWeight: 700,
  },
  {
    id: "spoqa-han-sans-neo",
    label: "스포카 한 산스",
    family: '"Editor Spoqa Han Sans Neo", "Noto Sans KR", sans-serif',
    renderFamily: '"Editor V3 Spoqa Han Sans Neo", sans-serif',
    fileName: "SpoqaHanSansNeo-Bold.woff2",
    staticWeight: 700,
  },
] as const;

export type EditorFontId = (typeof editorFontOptions)[number]["id"];
export const editorFontIds = editorFontOptions.map((font) => font.id) as [
  EditorFontId,
  ...EditorFontId[],
];

export const DEFAULT_EDITOR_FONT_ID: EditorFontId = "pretendard";

export type EditorFontRole = "title" | "channel" | "text";

export type ResolvedEditorFontFace = {
  fontId: EditorFontId;
  fileId: string;
  family: string;
  requestedWeight: 700 | 800;
  resolvedWeight: 400 | 700 | 800;
  variableWeight: 700 | 800 | null;
};

export function resolveEditorFontFace(
  fontId: EditorFontId | undefined,
  role: EditorFontRole,
): ResolvedEditorFontFace {
  const option = editorFontOptions.find((font) => font.id === fontId)
    || editorFontOptions[0];
  const requestedWeight = role === "text" ? 800 : 700;
  const variableWeight = option.id === "noto-serif-kr"
    ? requestedWeight
    : null;
  return {
    fontId: option.id,
    fileId: option.fileName,
    family: option.renderFamily,
    requestedWeight,
    resolvedWeight: variableWeight ?? option.staticWeight ?? 700,
    variableWeight,
  };
}

export function editorFontFamily(fontId: EditorFontId | undefined) {
  return editorFontOptions.find((font) => font.id === fontId)?.family
    || editorFontOptions[0].family;
}

export function editorFontLabel(fontId: EditorFontId | undefined) {
  return editorFontOptions.find((font) => font.id === fontId)?.label
    || editorFontOptions[0].label;
}
