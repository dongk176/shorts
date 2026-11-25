import type { SiteLocale } from "./i18n/config";

export const CONVERSION_MAINTENANCE_START_MS = Date.parse("2026-11-25T00:00:00Z");
export const CONVERSION_MAINTENANCE_END_MS = Date.parse("2026-11-25T05:00:00Z");

export type GenerationMaintenanceMode = "scheduled" | "recovery" | "open";
// Release pin: the verified recovery deployment remains available for an exact rollback.
export const GENERATION_MAINTENANCE_MODE: GenerationMaintenanceMode = "open";

export function isConversionMaintenanceActive(nowMs = Date.now(), mode: GenerationMaintenanceMode = GENERATION_MAINTENANCE_MODE) {
  if (mode === "open") return false;
  if (mode === "recovery") return true;
  return nowMs >= CONVERSION_MAINTENANCE_START_MS && nowMs < CONVERSION_MAINTENANCE_END_MS;
}

const scheduledGenerationMaintenanceCopy = {
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

export function maintenanceCopy(mode: GenerationMaintenanceMode) {
  return mode === "scheduled"
  ? scheduledGenerationMaintenanceCopy
  : {
      ko: { ...scheduledGenerationMaintenanceCopy.ko,
        detail: "안정적인 영상 생성을 위해 잠시 점검하고 있습니다. 정상 작동을 확인하는 대로 신규 쇼츠 생성을 다시 열겠습니다.",
        time: "점검 완료 후 다시 이용하실 수 있습니다.",
      },
      en: { ...scheduledGenerationMaintenanceCopy.en,
        detail: "Shorts creation is temporarily paused while we check its reliability. We will reopen it as soon as normal operation is verified.",
        time: "Creation will resume after verification.",
      },
      ja: { ...scheduledGenerationMaintenanceCopy.ja,
        detail: "動画を安定して作成できるよう、一時的にメンテナンスしています。正常な動作を確認でき次第、新規ショート動画の作成を再開します。",
        time: "動作確認が完了次第、再開します。",
      },
    };
}

export const generationMaintenanceCopy = maintenanceCopy(GENERATION_MAINTENANCE_MODE);
