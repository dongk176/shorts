import type { SiteLocale } from "@/lib/i18n/config";
export const youtubeLaunchCopy = (locale: SiteLocale) => ({
 ko: { title: "이지컷에 새로운 기능이 생겼어요!", close: "안내 닫기", previous: "이전", next: "다음", done: "확인했어요", replay: "업로드 안내 다시 보기", step: "단계", actionAlt: "프로젝트에서 편집하기·다운로드 버튼 아래에 있는 업로드 버튼", steps: [
  ["이제 유튜브에 바로 업로드", "프로젝트에서 완성한 쇼츠의 ‘업로드’를 누르면, 내 유튜브 채널로 바로 올릴 수 있어요.", "YouTube 채널 연결하기 버튼"],
  ["제목과 설명도 간편하게 입력", "업로드 전에 제목과 설명을 한곳에서 수정할 수 있어요.", "영상 제목과 설명을 간편하게 입력하는 화면"],
  ["공개 범위도 원하는 대로", "공개·일부 공개·비공개를 선택할 수 있어요.", "공개 범위와 콘텐츠 정보 선택"],
 ] },
 en: { title: "A new feature is here!", close: "Close guide", previous: "Back", next: "Next", done: "Got it", replay: "View upload guide", step: "Step", actionAlt: "Upload button below Edit and Download in the project", steps: [
  ["Upload straight to YouTube", "Select Upload on a finished Short in your project to post directly to your YouTube channel.", "Connect YouTube channel button"],
  ["Add a title and description", "Edit your video’s title and description in one place before uploading.", "Video title and description fields"],
  ["Choose who can watch", "Choose Public, Unlisted or Private.", "Visibility and content information options"],
 ] },
 ja: { title: "新機能が登場しました！", close: "案内を閉じる", previous: "戻る", next: "次へ", done: "確認しました", replay: "アップロードの案内を見る", step: "ステップ", actionAlt: "プロジェクトの編集・ダウンロードの下にあるアップロードボタン", steps: [
  ["YouTubeへ直接アップロード", "プロジェクトで完成したショート動画の「アップロード」を押すと、自分のYouTubeチャンネルに直接投稿できます。", "YouTubeチャンネル接続ボタン"],
  ["タイトルと説明も簡単に入力", "アップロード前に、タイトルと説明を一か所で編集できます。", "動画のタイトルと説明の入力欄"],
  ["公開範囲も自由に選択", "公開・限定公開・非公開を選択できます。", "公開範囲とコンテンツ情報の選択"],
 ] },
})[locale];
