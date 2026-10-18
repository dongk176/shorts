import type { SiteLocale } from "@/lib/i18n/config";
const ko = {
 title: "이지컷의 새로운 소식", lead: "새로운 기능과 개선 사항을 만나보세요.", feedback: "다음 업데이트의 시작은 여러분의 한마디입니다.", feedbackLink: "이지컷에 의견 보내기",
 archiveNote: "7월 25일 이후 사용자 기능 변경을 모은 기록입니다. 날짜는 변경 이력 기준이며 실제 공개일과 차이가 있을 수 있습니다. 이미지는 실제 서비스 화면이며, 각 이미지에 캡처 날짜를 표시했습니다.",
 updates: "업데이트", description: "이지컷의 새 기능과 개선 소식. 실제 화면으로 만나는 더 편리한 쇼츠 제작.", brand: "이지컷", notFound: "업데이트를 찾을 수 없습니다",
 all: "전체", feature: "새 기능", improvement: "개선", fix: "오류 수정", allTime: "전체 기간", list: "업데이트 목록", categories: "업데이트 분류", search: "업데이트 검색", month: "업데이트 월", latest: "최근 업데이트", read: "업데이트 살펴보기", empty: "아직 맞는 소식이 없어요.", emptyHelp: "다른 검색어를 입력하거나 필터를 바꿔보세요.", showAll: "전체 업데이트 보기", older: "이전 업데이트 더 보기", newer: "최신 업데이트", pages: "업데이트 페이지",
 back: "모든 업데이트", team: "이지컷 팀", changes: "변경 내용", changed: "이렇게 달라졌어요", screen: "화면으로 살펴보기", screenHelp: "실제 화면에서 사용할 위치를 확인해 보세요. 이미지를 누르면 더 크게 볼 수 있어요.", how: "사용 방법", try: "이렇게 사용해 보세요", open: "실제 기능 열기", newTab: "현재 서비스가 새 탭에서 열립니다.", related: "함께 보면 좋은 업데이트", returnAll: "전체 업데이트로 돌아가기", zoom: "크게 보기", zoomLabel: "화면 캡처 크게 보기", close: "닫기",
 count: (n: number) => `${n}개의 업데이트`, page: (n: number) => `${n}페이지`, minutes: (n: number) => `${n}분 읽기`, monthLabel: (m: string) => `${m.slice(0,4)}년 ${Number(m.slice(5))}월`,
 capture: (date: string) => `실제 이지컷 화면 · ${date} 캡처`,
 note: (date: string) => `이 글은 ${date} 변경 기록을 바탕으로 정리했어요. 캡처는 현재 화면으로, 업데이트 당시의 모습과 다를 수 있습니다. 사용 가능한 기능은 계정·플랜과 현재 서비스 안내를 확인해 주세요.`,
};
const en: typeof ko = {
 title: "What’s new at EasyCut", lead: "Discover new features and improvements.", feedback: "Your feedback inspires our next update.", feedbackLink: "Send feedback to EasyCut",
 archiveNote: "A record of user-facing changes since July 25. Dates follow the change history and may differ from release dates. Images show the actual service, with capture dates indicated. Screenshots may show the Korean interface.",
 updates: "Updates", description: "New features and improvements from EasyCut. Explore easier Shorts creation with real product screenshots.", brand: "EasyCut", notFound: "Update not found",
 all: "All", feature: "New features", improvement: "Improvements", fix: "Bug fixes", allTime: "All time", list: "Update list", categories: "Update categories", search: "Search updates", month: "Update month", latest: "Latest update", read: "Read the update", empty: "No matching updates yet.", emptyHelp: "Try another search or change the filters.", showAll: "View all updates", older: "Older updates", newer: "Newer updates", pages: "Update pages",
 back: "All updates", team: "The EasyCut team", changes: "What changed", changed: "Here’s what’s new", screen: "See it in action", screenHelp: "See where to find the feature. Select an image to enlarge it.", how: "How to use it", try: "Get started", open: "Open the feature", newTab: "The current service opens in a new tab.", related: "Related updates", returnAll: "Back to all updates", zoom: "Enlarge", zoomLabel: "Enlarge screenshot", close: "Close",
 count: n => `${n} update${n === 1 ? "" : "s"}`, page: n => `Page ${n}`, minutes: n => `${n} min read`, monthLabel: m => new Intl.DateTimeFormat("en", { year: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`)),
 capture: date => `Actual EasyCut screen · Captured ${date} · Interface may be in Korean`,
 note: date => `Based on the change history for ${date}. Screenshots may differ from the interface at the time of the update and may be in Korean. Check your account, plan and current service notices for feature availability.`,
};
const ja: typeof ko = {
 title: "EasyCutの最新情報", lead: "新機能や改善内容をご紹介します。", feedback: "皆さまの声が、次のアップデートにつながります。", feedbackLink: "EasyCutに意見を送る",
 archiveNote: "7月25日以降のユーザー向け機能の変更記録です。日付は変更履歴に基づくため、公開日と異なる場合があります。画像は実際のサービス画面で、撮影日を併記しています。スクリーンショットには韓国語の画面が含まれます。",
 updates: "アップデート", description: "EasyCutの新機能と改善のお知らせ。実際の画面とともに、より便利なショート動画制作をご紹介します。", brand: "EasyCut", notFound: "アップデートが見つかりません",
 all: "すべて", feature: "新機能", improvement: "改善", fix: "不具合修正", allTime: "すべての期間", list: "アップデート一覧", categories: "アップデートの分類", search: "アップデートを検索", month: "更新月", latest: "最新のアップデート", read: "詳しく見る", empty: "該当するお知らせはありません。", emptyHelp: "検索語やフィルターを変更してください。", showAll: "すべてのアップデートを見る", older: "過去のアップデート", newer: "新しいアップデート", pages: "アップデートのページ",
 back: "すべてのアップデート", team: "EasyCutチーム", changes: "変更内容", changed: "変更点をご紹介", screen: "画面で確認", screenHelp: "実際の画面で機能の場所を確認できます。画像を押すと拡大します。", how: "使い方", try: "使ってみましょう", open: "機能を開く", newTab: "現在のサービスが新しいタブで開きます。", related: "関連するアップデート", returnAll: "アップデート一覧に戻る", zoom: "拡大する", zoomLabel: "スクリーンショットを拡大", close: "閉じる",
 count: n => `${n}件のアップデート`, page: n => `${n}ページ`, minutes: n => `約${n}分で読めます`, monthLabel: m => `${m.slice(0,4)}年${Number(m.slice(5))}月`,
 capture: date => `実際のEasyCut画面 · ${date}撮影 · 韓国語の画面を含みます`,
 note: date => `${date}の変更履歴に基づく記事です。スクリーンショットは更新当時の画面と異なる場合があり、韓国語の画面も含まれます。利用できる機能は、アカウント・プランおよび現在のサービス案内をご確認ください。`,
};
export const updateCopy = (locale: SiteLocale) => ({ ko, en, ja })[locale];
export function updateKind(kind: string, locale: SiteLocale) {
 const c = updateCopy(locale);
 return ({ "전체": c.all, "새 기능": c.feature, "개선": c.improvement, "오류 수정": c.fix } as Record<string, string>)[kind] ?? kind;
}
