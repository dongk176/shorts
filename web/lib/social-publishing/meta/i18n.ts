const copy = {
  connect: ["계정 연결", "Connect account", "アカウントを連携"],
  intro: ["영상을 게시할 계정을 연결해 주세요.", "Connect the account you want to post to.", "投稿先のアカウントを連携してください。"],
  loading: ["불러오는 중…", "Loading…", "読み込み中…"],
  setup: ["계정 연결 설정을 준비 중입니다.", "Account connection setup is pending.", "アカウント連携を準備中です。"],
  manage: ["계정 관리", "Manage accounts", "アカウント管理"],
  disconnect: ["연결 해제", "Disconnect", "連携解除"],
  disconnectHelp: ["연결정보와 이지컷의 게시 기록을 삭제합니다. 이미 게시된 영상은 플랫폼에 남습니다.", "Remove the connection and its posting history from EasyCut. Published videos stay on the platform.", "EasyCutの連携情報と投稿履歴を削除します。投稿済み動画はプラットフォームに残ります。"],
  cancel: ["취소", "Cancel", "キャンセル"], back: ["돌아가기", "Back", "戻る"],
  connected: ["계정이 연결되었습니다.", "Account connected.", "アカウントを連携しました。"],
  disconnected: ["연결이 해제되었습니다.", "Account disconnected.", "連携を解除しました。"],
  manual: ["이지컷의 연결정보를 삭제했습니다. 플랫폼의 ‘앱 및 웹사이트’ 설정에서도 EasyCut의 접근 권한을 제거해 주세요.", "EasyCut's connection data was deleted. Also remove EasyCut access in the platform's Apps and websites settings.", "EasyCutの連携情報を削除しました。プラットフォームの「アプリとウェブサイト」設定でもEasyCutのアクセスを削除してください。"],
  cancelled: ["계정 연결을 취소했습니다.", "Account connection cancelled.", "アカウント連携をキャンセルしました。"],
  channel: ["게시할 계정", "Post to", "投稿先"], caption: ["설명 · 해시태그", "Caption · hashtags", "キャプション・ハッシュタグ"],
  visibility: ["계정의 공개 범위로 게시", "Post using account visibility", "アカウントの公開範囲で投稿"],
  instagramVisibility: ["Instagram 릴스로 게시됩니다. 프로페셔널 계정의 릴스는 공개되므로 테스트 영상도 다른 사람이 볼 수 있습니다.", "This posts an Instagram Reel. Professional account Reels are public, so other people can see your test video.", "Instagramリールとして公開されます。プロアカウントのリールは公開されるため、テスト動画も他の人に表示されます。"],
  threadsVisibility: ["Threads 프로필의 공개 범위에 따라 게시됩니다. 공개 프로필이면 다른 사람이 테스트 영상을 볼 수 있습니다.", "This follows your Threads profile's visibility. With a public profile, other people can see your test video.", "Threadsプロフィールの公開範囲で投稿します。公開プロフィールの場合、他の人にもテスト動画が表示されます。"],
  rights: ["이 영상을 게시할 권리가 있습니다.", "I have the rights to post this video.", "この動画を投稿する権利を持っています。"],
  consent: ["위 계정과 공개 범위를 확인했으며, 영상과 설명을 전송하여 게시하는 데 동의합니다.", "I have checked the account and visibility, and authorize sending this video and caption for publication.", "投稿先と公開範囲を確認し、この動画とキャプションの送信・投稿に同意します。"],
  upload: ["게시하기", "Publish", "投稿する"], history: ["게시 기록", "Posting history", "投稿履歴"],
  processing: ["게시 처리 중", "Processing", "処理中"], complete: ["게시 완료", "Published", "投稿完了"], failed: ["게시 실패", "Failed", "投稿失敗"], unknown: ["결과 확인 필요", "Check result", "結果を確認"], initiating: ["전송 중", "Sending", "送信中"],
  keepOpen: ["게시 완료가 표시될 때까지 이 창을 열어 두세요.", "Keep this window open until publication is confirmed.", "投稿完了が表示されるまでこの画面を開いたままにしてください。"],
  unavailable: ["요청을 완료하지 못했습니다. 잠시 후 다시 확인해 주세요.", "The request could not be completed. Please check again shortly.", "リクエストを完了できませんでした。しばらくして再度確認してください。"],
  reconnect: ["계정을 다시 연결하고 게시 권한을 허용해 주세요.", "Reconnect the account and allow publishing access.", "アカウントを再連携し、投稿権限を許可してください。"],
  video: ["영상이 변경되었거나 지원하지 않는 형식입니다. 완성된 영상을 다시 확인해 주세요.", "The video changed or its format is unsupported. Check your finished video.", "動画が変更されたか、非対応の形式です。完成した動画を確認してください。"],
  professional: ["Instagram 비즈니스 또는 크리에이터 계정으로 연결해 주세요.", "Connect an Instagram business or creator account.", "Instagramのビジネスまたはクリエイターアカウントを連携してください。"],
  wait: ["연결 해제를 처리 중입니다. 표시된 시간이 지난 뒤 다시 연결해 주세요.", "Disconnection is being processed. Reconnect after the displayed wait.", "連携解除を処理中です。表示された時間の後で再連携してください。"],
  limit: ["플랫폼의 요청 한도에 도달했습니다. 잠시 후 상태를 확인해 주세요.", "The platform's request limit was reached. Check the status again later.", "プラットフォームの制限に達しました。後で状態を確認してください。"],
};
export type MetaText = keyof typeof copy;
export const metaText = (locale: string) => (key: MetaText) => copy[key][locale === "en" ? 1 : locale === "ja" ? 2 : 0];
export function metaError(code: string, locale: string) {
  const key: MetaText = code === "META_SETUP_REQUIRED" ? "setup" : ["META_RECONNECT_REQUIRED", "META_PERMISSION_REQUIRED", "META_STATE_EXPIRED"].includes(code) ? "reconnect" : code === "META_PROFESSIONAL_REQUIRED" ? "professional" : code === "META_RECONNECT_WAIT" ? "wait" : code === "META_RATE_LIMIT" ? "limit" : ["META_MEDIA_UNAVAILABLE", "META_SOURCE_CHANGED", "META_VIDEO_DURATION", "META_PROCESSING_FAILED"].includes(code) ? "video" : "unavailable";
  return metaText(locale)(key);
}
