import type { SiteLocale } from "@/lib/i18n/config";
export function uploadMaintenanceText(locale: SiteLocale) {
  return locale === "ko" ? {
    badge: "점검 중", heading: "업로드 기능을 잠시 점검하고 있어요",
    message: "더 안정적인 서비스를 제공하기 위해 업로드 기능을 개선하고 있습니다.",
    availability: "준비가 완료되면 다시 이용하실 수 있어요.",
    alternative: "지금은 영상을 다운로드한 뒤 YouTube에서 직접 업로드해 주세요.",
    channels: "채널 연결은 관리할 수 있지만, 바로 업로드 기능은 현재 점검 중이에요.",
    download: "영상 다운로드", apology: "이용에 불편을 드려 죄송합니다.", confirm: "확인",
  } : locale === "en" ? {
    badge: "Maintenance", heading: "Uploads are temporarily unavailable",
    message: "We are improving uploads to provide a more reliable service.",
    availability: "You can use this feature again once it is ready.",
    alternative: "For now, download your video and upload it directly on YouTube.",
    channels: "You can manage connected channels, but direct uploads are under maintenance.",
    download: "Download video", apology: "We apologize for the inconvenience.", confirm: "OK",
  } : {
    badge: "メンテナンス中", heading: "アップロード機能を一時的にメンテナンスしています",
    message: "より安定したサービスを提供するため、アップロード機能を改善しています。",
    availability: "準備が整い次第、再びご利用いただけます。",
    alternative: "現在は動画をダウンロードして、YouTubeから直接アップロードしてください。",
    channels: "チャンネル連携は管理できますが、直接アップロードはメンテナンス中です。",
    download: "動画をダウンロード", apology: "ご不便をおかけして申し訳ございません。", confirm: "確認",
  };
}
