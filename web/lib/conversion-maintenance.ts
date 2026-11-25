import type { SiteLocale } from "./i18n/config";

export const CONVERSION_MAINTENANCE_START_MS = Date.parse("2026-11-25T00:00:00Z");
export const CONVERSION_MAINTENANCE_END_MS = Date.parse("2026-11-25T05:00:00Z");

export function isConversionMaintenanceActive(nowMs = Date.now()) {
  return nowMs >= CONVERSION_MAINTENANCE_START_MS && nowMs < CONVERSION_MAINTENANCE_END_MS;
}

export const generationMaintenanceCopy = {
  ko: {
    title: "쇼츠 생성 기능을 점검하고 있습니다",
    detail: "반복되는 영상 생성 오류를 확인하고 있습니다. 11월 25일 오후 2시(한국 시간)까지 신규 쇼츠 생성을 잠시 중단합니다.",
    existing: "기존 프로젝트 열람·편집·다운로드는 계속 이용할 수 있습니다.",
    projects: "내 프로젝트 보기", time: "점검 종료 예정 · 11월 25일 오후 2시 (KST)",
  },
  en: {
    title: "Shorts creation is under maintenance",
    detail: "We are investigating repeated video creation failures. New Shorts creation is temporarily paused until November 25, 2:00 PM Korea Standard Time (05:00 UTC).",
    existing: "You can still view, edit, and download your existing projects.",
    projects: "View my projects", time: "Scheduled end · November 25, 14:00 KST / 05:00 UTC",
  },
  ja: {
    title: "ショート動画の作成機能をメンテナンス中です",
    detail: "動画作成で繰り返し発生しているエラーを調査しています。11月25日14:00（日本時間・韓国時間）まで、新規ショート動画の作成を一時停止します。",
    existing: "既存プロジェクトの閲覧・編集・ダウンロードは引き続きご利用いただけます。",
    projects: "マイプロジェクトを見る", time: "終了予定 · 11月25日 14:00（JST / KST）",
  },
} satisfies Record<SiteLocale, { title: string; detail: string; existing: string; projects: string; time: string }>;
