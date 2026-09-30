import records from "./posts.json";
export type UpdatePost = typeof records[number];
export const updates: UpdatePost[] = records;
export const updateKinds = ["전체", "새 기능", "개선", "오류 수정"] as const;
export const displayDate = (date: string) => date.replaceAll("-", ".");
export function findUpdate(slug: string) { return updates.find(post => post.slug === slug); }
export type Annotation = {
    x: number;
    y: number;
    w: number;
    h: number;
    label: string;
};
export const captures: Record<string, {
    width: number;
    height: number;
    cropX: number;
    cropY: number;
    alt: string;
    annotations: Annotation[];
}> = {
    channels: { width: 900, height: 780, cropX: 635, cropY: 18, alt: "이지컷 채널 연동 화면. YouTube 연결하기와 준비 중인 다른 플랫폼", annotations: [{ x: 82, y: 18, w: 11, h: 8, label: "YouTube 연결하기" }, { x: 4, y: 40, w: 91, h: 58, label: "다른 플랫폼은 준비 중" }] },
    sns: { width: 1180, height: 780, cropX: 375, cropY: 25, alt: "프로필과 본문을 설정하는 실제 SNS 템플릿 편집 화면", annotations: [{ x: 4, y: 11, w: 30, h: 83, label: "SNS 스타일 미리보기" }, { x: 39, y: 12, w: 59, h: 68, label: "프로필·본문 설정" }] },
    popular: { width: 1140, height: 608, cropX: 515, cropY: 18, alt: "실시간 인기 영상 목록의 검색창, 언어 필터와 북마크 버튼", annotations: [{ x: 19.4, y: 46, w: 4.9, h: 9.5, label: "이 아이콘을 누르면 저장" }, { x: 57, y: 21, w: 41, h: 10, label: "언어·길이·재사용 조건" }] },
    search: { width: 1140, height: 590, cropX: 515, cropY: 18, alt: "여행 키워드를 검색한 실시간 인기 영상의 실제 결과", annotations: [{ x: 2, y: 11, w: 96, h: 10, label: "제목이나 채널명 검색" }, { x: 2, y: 47, w: 96, h: 47, label: "키워드에 맞는 영상" }] },
    period: { width: 1140, height: 590, cropX: 515, cropY: 18, alt: "인기 영상 수집 기간 선택 메뉴", annotations: [{ x: 9, y: 22, w: 20, h: 34, label: "원하는 수집 기간 선택" }] },
    templates: { width: 1070, height: 637, cropX: 548, cropY: 33, alt: "실제 템플릿 라이브러리의 새 템플릿과 팝형·강조형 자막", annotations: [{ x: 50, y: 24, w: 49, h: 73, label: "팝형·강조형 자막" }] },
    "template-editor": { width: 1500, height: 870, cropX: 0, cropY: 0, alt: "후킹 제목 글꼴과 색상, 크기를 조절하는 실제 템플릿 편집기", annotations: [{ x: 6, y: 18, w: 29, h: 69, label: "글꼴·크기·색상 설정" }, { x: 75, y: 24, w: 15, h: 11, label: "미리보기에서 확인" }] },
    subtitles: { width: 1500, height: 870, cropX: 0, cropY: 0, alt: "자막 방식·폰트·세로 위치를 조정하는 실제 자막 편집 화면", annotations: [{ x: 6, y: 16, w: 29, h: 71, label: "자막 스타일과 위치" }, { x: 74, y: 63, w: 18, h: 10, label: "자막 미리보기" }] },
    background: { width: 1500, height: 870, cropX: 0, cropY: 0, alt: "배경을 선택하는 이지컷 템플릿 편집 화면", annotations: [{ x: 6, y: 10, w: 29, h: 70, label: "배경 설정" }] },
    project: { width: 1420, height: 820, cropX: 480, cropY: 0, alt: "완성된 쇼츠와 스크립트, 다운로드 버튼이 보이는 실제 프로젝트 화면", annotations: [] },
    creation: { width: 1140, height: 510, cropX: 515, cropY: 55, alt: "유튜브 링크를 입력해 제작을 시작하는 이지컷 홈 화면", annotations: [] },
    upload: { width: 1140, height: 650, cropX: 525, cropY: 60, alt: "이지컷 홈의 파일 업로드 선택 화면", annotations: [] },
    guide: { width: 1060, height: 825, cropX: 555, cropY: 15, alt: "이지컷 쇼츠 가이드 실제 화면", annotations: [] },
    showcase: { width: 1160, height: 795, cropX: 515, cropY: 0, alt: "이지컷 홈의 카테고리별 쇼츠 예시", annotations: [] },
    language: { width: 1140, height: 650, cropX: 760, cropY: 0, alt: "이지컷 언어 선택 화면", annotations: [] },
    navigation: { width: 1650, height: 790, cropX: 0, cropY: 0, alt: "쇼츠 제작·영상 찾기·이용 안내로 분류된 실제 사이드바", annotations: [{ x: 1, y: 18, w: 13, h: 77, label: "기능별로 정리한 메뉴" }] },
    blog: { width: 1380, height: 775, cropX: 395, cropY: 85, alt: "이지컷 공식 블로그의 실제 콘텐츠 목록", annotations: [] },
    pricing: { width: 880, height: 560, cropX: 645, cropY: 15, alt: "현재 이지컷 요금제 안내 화면", annotations: [] },
    "saved-empty": { width: 1140, height: 390, cropX: 515, cropY: 0, alt: "저장한 영상이 없을 때 보이는 실제 보관함 안내", annotations: [] },
};
