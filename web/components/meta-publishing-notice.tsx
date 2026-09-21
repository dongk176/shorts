import { getRequestLocale } from "@/lib/i18n/server";

export async function MetaPublishingNotice() {
  const locale = await getRequestLocale();
  const text = locale === "en" ? {
    title: "Instagram and Threads publishing (administrator testing)",
    data: "When you connect an account, EasyCut stores its identifier, username, display name, granted permissions and encrypted access token to show the account and publish the finished video you select. EasyCut does not collect your Instagram or Threads password, inbox or contacts.",
    transfer: "Only after you confirm publication, EasyCut sends the selected video and caption to Meta through encrypted connections. Meta retrieves the video using a restricted link that expires within 90 minutes and is invalidated after publication or disconnection. Instagram Reels are public; Threads posts follow the profile's visibility.",
    retention: "Connection data and posting history are retained while the account is connected. Disconnecting or withdrawing your EasyCut account deletes the stored grant and posting history. Already published posts remain on Instagram or Threads and can be deleted there.",
    deletion: "To remove this data: open a finished project → Upload → Instagram or Threads → Manage accounts → Disconnect. EasyCut also attempts to revoke the grant; if the platform cannot confirm revocation, remove EasyCut in that platform's Apps and websites settings. You can request deletion at easycut@easycut.co.kr.",
  } : locale === "ja" ? {
    title: "Instagram・Threadsへの投稿（管理者テスト）",
    data: "アカウントを連携すると、EasyCutは識別子、ユーザー名、表示名、許可された権限、暗号化したアクセストークンを保存し、アカウントの表示と選択された完成動画の投稿に使用します。パスワード、受信トレイ、連絡先は収集しません。",
    transfer: "投稿の確認後にのみ、選択した動画とキャプションを暗号化通信でMetaへ送信します。動画取得用の制限付きリンクは90分以内に期限切れとなり、投稿完了または連携解除後に無効化されます。Instagramリールは公開され、Threadsの投稿はプロフィールの公開範囲に従います。",
    retention: "連携中は連携情報と投稿履歴を保持します。連携解除またはEasyCutの退会時に保存した認可情報と投稿履歴を削除します。投稿済みの動画は各プラットフォームに残り、そこで削除できます。",
    deletion: "データ削除：完成したプロジェクト → アップロード → InstagramまたはThreads → アカウント管理 → 連携解除。権限の取り消しも試みます。取り消しを確認できない場合は、各プラットフォームの「アプリとウェブサイト」からEasyCutを削除してください。削除の依頼先：easycut@easycut.co.kr。",
  } : {
    title: "Instagram·Threads 게시 기능 (관리자 테스트)",
    data: "계정 연결 시 계정 식별자, 사용자명, 표시 이름, 허용한 권한과 암호화된 액세스 토큰을 저장하며, 연결 계정을 표시하고 이용자가 선택한 완성 영상을 게시하는 데 사용합니다. Instagram·Threads 비밀번호, 받은 메시지와 연락처는 수집하지 않습니다.",
    transfer: "이용자가 게시를 확인한 뒤에만 선택한 영상과 설명을 암호화 통신으로 Meta에 전송합니다. Meta가 영상을 가져오는 제한된 링크는 최대 90분 후 만료되며 게시 완료 또는 연결 해제 후 무효화됩니다. Instagram 릴스는 공개되며, Threads 게시물은 프로필의 공개 범위를 따릅니다.",
    retention: "계정이 연결된 동안 연결정보와 게시 기록을 보관합니다. 연결 해제 또는 이지컷 탈퇴 시 저장된 권한 정보와 게시 기록을 삭제합니다. 이미 게시된 영상은 Instagram·Threads에 남으며 해당 플랫폼에서 삭제할 수 있습니다.",
    deletion: "정보 삭제 방법: 완성된 프로젝트 → 업로드 → Instagram 또는 Threads → 계정 관리 → 연결 해제. 플랫폼의 접근 권한 철회도 요청하며, 철회를 확인하지 못한 경우 해당 플랫폼의 ‘앱 및 웹사이트’에서도 EasyCut을 제거해 주세요. easycut@easycut.co.kr로 삭제를 요청할 수도 있습니다.",
  };
  return <section id="meta-publishing" data-i18n-skip className="mt-8 space-y-3"><h2>{text.title}</h2><p>{text.data}</p><p>{text.transfer}</p><p>{text.retention}</p><p>{text.deletion}</p><p><a href="https://privacycenter.instagram.com/policy/" target="_blank" rel="noreferrer">Meta Privacy Policy</a></p></section>;
}
