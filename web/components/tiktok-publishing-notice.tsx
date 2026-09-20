"use client";
import { LegalSection } from "./legal-document";
import { useI18n } from "@/lib/i18n/provider";
const copy = {
  ko: { title: "추가 안내: 선택적 TikTok 연결 및 게시", paragraphs: [
    "TikTok 게시 기능은 현재 승인된 관리자만 시험할 수 있습니다. 연결은 선택 사항이며 EasyCut 로그인과 별개입니다.",
    "연결 계정 식별자·표시 이름·사용자 이름·허용 권한과 인증 토큰을 처리합니다. 토큰은 서버에 암호화하여 저장합니다. 이용자가 게시를 요청할 때 선택한 완성 영상, 설명, 공개 범위, 상호작용 및 콘텐츠 표시 설정을 TikTok에 TLS 암호화 통신으로 보내고 게시 식별자와 처리 상태를 확인합니다.",
    "연결 정보와 게시·동의 기록은 연결 해제 또는 회원탈퇴까지 보관하며 해당 시점에 삭제합니다. 연결 해제 시 TikTok 권한 철회도 요청하고, 확인하지 못하면 수동 철회 안내를 표시합니다. 미완료 연결 요청은 10분, 영상 전송용 임시 링크는 최대 90분 후 만료합니다. 이미 TikTok에 게시한 영상은 TikTok에서 직접 관리해야 합니다.",
    "연결을 거부해도 다른 EasyCut 기능을 이용할 수 있습니다. 삭제 요청: easycut@easycut.co.kr. TikTok이 처리하는 영상과 관련 정보에는 TikTok의 개인정보처리방침과 이용약관이 적용됩니다."
  ] },
  en: { title: "Additional notice: optional TikTok connection and publishing", paragraphs: [
    "TikTok publishing is currently available for testing by authorized administrators only. Connecting TikTok is optional and separate from signing in to EasyCut.",
    "We process the connected account identifier, display name, username, granted permissions and authorization tokens. Tokens are encrypted on our server. When you request a post, we send your selected finished video, caption, audience, interaction and disclosure settings to TikTok over encrypted TLS connections and retrieve the publishing identifier and processing status.",
    "We retain connection information and post/consent records until you disconnect or delete your EasyCut account, then delete them. Disconnecting also requests TikTok authorization revocation; we show manual instructions if revocation cannot be confirmed. Pending connection requests expire after 10 minutes and temporary video-transfer links after at most 90 minutes. Manage videos already posted to TikTok directly in TikTok.",
    "You can decline connection and continue using other EasyCut features. For deletion requests, contact easycut@easycut.co.kr. TikTok's handling of videos and related data is subject to its Privacy Policy and Terms of Service."
  ] },
  ja: { title: "追加案内：任意のTikTok連携と投稿", paragraphs: [
    "TikTok投稿機能は現在、許可された管理者のみがテストできます。連携は任意であり、EasyCutへのログインとは別です。",
    "連携アカウントの識別子・表示名・ユーザー名・許可された権限・認証トークンを処理します。トークンはサーバーで暗号化して保存します。投稿を依頼すると、選択した完成動画・説明・公開範囲・交流およびコンテンツ表示の設定をTLS暗号化通信でTikTokへ送り、投稿識別子と処理状況を確認します。",
    "連携情報と投稿・同意記録は連携解除またはEasyCut退会まで保存し、その時点で削除します。解除時にTikTokの権限取消も依頼し、確認できない場合は手動解除の案内を表示します。未完了の認証要求は10分、動画転送用リンクは最大90分で失効します。投稿済み動画はTikTokで直接管理してください。",
    "連携を拒否しても他のEasyCut機能は利用できます。削除のご依頼：easycut@easycut.co.kr。TikTokによる動画・関連情報の取扱いには、TikTokのプライバシーポリシーと利用規約が適用されます。"
  ] },
};
export function TikTokPublishingNotice() {
  const { locale } = useI18n(), text = copy[locale];
  return <LegalSection id="tiktok-publishing" title={text.title}>{text.paragraphs.map(p => <p key={p}>{p}</p>)}<p><a href="https://www.tiktok.com/legal/page/row/privacy-policy/en" target="_blank" rel="noreferrer">TikTok Privacy Policy</a>{" · "}<a href="https://www.tiktok.com/legal/page/row/terms-of-service/en" target="_blank" rel="noreferrer">TikTok Terms of Service</a></p></LegalSection>;
}
