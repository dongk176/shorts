"use client";

import { LegalSection } from "@/components/legal-document";
import { useI18n } from "@/lib/i18n/provider";

const copy = {
  ko: {
    privacyTitle: "YouTube 채널 연결 및 업로드 추가 안내",
    termsTitle: "선택적 YouTube 연동",
    availability: "YouTube 채널 연결·업로드는 현재 제한된 테스트 환경에서 준비 중이며 일반 이용자에게 아직 제공되지 않습니다. 아래 내용은 이 기능의 이용에 동의한 테스트 이용자에게 적용됩니다.",
    purpose: "Easy Cut은 YouTube API Services를 사용합니다. 채널 연결은 Easy Cut 로그인과 별도로 선택하며, 연결한 본인 채널을 표시하고 이용자가 선택한 완성 영상을 업로드한 뒤 처리 결과를 확인하는 데 사용합니다.",
    data: "연결하면 채널 식별자·채널명, 동의한 권한과 인증 토큰을 처리합니다. 이용자가 업로드를 요청할 때 선택한 영상, 제목·설명, 공개 범위, 아동용 콘텐츠 여부 및 사실적인 변경·합성 콘텐츠 표시를 Google에 전송하고 영상 식별자·실제 공개 범위·처리 상태를 확인합니다. 비공개 영상의 상태 조회도 포함됩니다.",
    protection: "인증 토큰은 서버에서 암호화해 보관하고 계정별로 접근을 제한합니다. 토큰을 브라우저나 원본 영상 수집 작업에 제공하지 않습니다. Google API로 받은 연동 데이터를 판매하거나 광고 타기팅 또는 범용 AI 모델 학습에 사용하지 않습니다. Easy Cut의 Google API 정보 이용과 다른 앱으로의 전송은 Google API Services User Data Policy의 Limited Use 요건을 따릅니다.",
    retention: "연결 정보는 정기적으로 권한과 채널 정보를 확인합니다. 29일 동안 사용하지 않았거나 유효성을 확인하지 못한 연결은 삭제합니다. 업로드 상세 정보는 생성 후 29일에 삭제하며 중복 업로드 방지를 위한 내부 사용자·결과물·연결 식별자와 결과물 버전 등 최소 기록만 남깁니다. 이 최소 기록도 연결 해제 또는 회원탈퇴 시 삭제합니다. 미완료 연결 요청은 10분 후 사용할 수 없으며 정리 작업이 정상 실행되는 경우 약 70분 이내 삭제됩니다.",
    deletion: "채널 연결 화면에서 연결 해제 및 데이터 삭제를 요청할 수 있습니다. 해당 Easy Cut 계정의 모든 YouTube 연결 정보·인증 토큰·업로드 기록·미완료 연결 요청을 삭제하고 Google 권한 철회를 요청합니다. Google 철회 결과를 확인하지 못하면 직접 해제할 수 있는 링크를 안내합니다. Google 계정의 연결 관리에서 직접 철회하거나 easycut@easycut.co.kr로 삭제를 요청할 수도 있습니다. 연결 해제는 이미 YouTube에 업로드한 영상과 프로젝트 원본을 삭제하지 않습니다.",
    transfer: "Google LLC로의 전송은 이용자의 연결·업로드 요청 및 연결 유효성 확인 과정에서 TLS 암호화 통신으로 이루어집니다. Google은 미국과 Google 데이터센터 운영 국가에서 정보를 처리할 수 있습니다. Google이 보관하는 업로드 영상과 관련 데이터는 Google 개인정보처리방침 및 이용자의 YouTube 관리 설정을 따릅니다. 채널 연결에 동의하지 않으면 해당 전송을 거부할 수 있으며, YouTube 연결·업로드 이외의 기능은 이용할 수 있습니다.",
    terms: "YouTube 연동 기능에는 YouTube 서비스 약관이 적용됩니다. 이용자는 업로드 전에 콘텐츠 권리, 대상 채널, 제목·설명, 공개 범위와 필수 콘텐츠 표시를 확인해야 합니다. 현재 테스트는 비공개 업로드만 허용하며 공개·일부 공개는 제한됩니다. Google과 YouTube의 심사·정책·처리 상태에 따라 이용 또는 공개가 제한될 수 있습니다. 연결 해제만으로 YouTube에 이미 게시된 영상이 삭제되지는 않습니다.",
    googlePrivacy: "Google 개인정보처리방침", googlePolicy: "Google API Services User Data Policy", revoke: "Google 계정 연결 관리", youtubeTerms: "YouTube 서비스 약관",
  },
  en: {
    privacyTitle: "Additional notice: YouTube channel connection and uploading",
    termsTitle: "Optional YouTube integration",
    availability: "YouTube connection and uploading are being prepared in a limited test environment and are not yet generally available. This notice applies to test participants who choose to use the feature.",
    purpose: "Easy Cut uses YouTube API Services. Channel authorization is optional and separate from signing in to Easy Cut. It is used to display the user's connected channel, upload a completed video selected by the user, and check the upload result.",
    data: "We process the channel ID and name, granted permissions, and authorization tokens. When the user requests an upload, we send the selected video, title, description, visibility, made-for-kids classification, and realistic altered or synthetic content disclosure to Google. We retrieve the video ID, actual visibility, and processing status, including the status of private uploads.",
    protection: "Authorization tokens are encrypted on the server and access is restricted by account. Tokens are not provided to browsers or source-video ingestion workers. We do not sell the Google API integration data or use it for advertising targeting or training general-purpose AI models. Easy Cut's use and transfer to any other app of information received from Google APIs adheres to the Google API Services User Data Policy, including its Limited Use requirements.",
    retention: "We periodically check channel information and authorization. Connections unused or not successfully validated for 29 days are deleted. Upload details are deleted 29 days after creation; only minimal internal user, output and connection identifiers and output versions remain to prevent duplicate uploads. Those records are also deleted on disconnection or account withdrawal. Incomplete authorization requests expire after 10 minutes and are removed within approximately 70 minutes while the cleanup process operates normally.",
    deletion: "The channel-connection screen offers disconnection and data deletion. It removes all YouTube connections, authorization tokens, upload records and pending authorization requests for that Easy Cut account and requests Google authorization revocation. If revocation cannot be confirmed, we display a link for manual revocation. Users may also revoke access in their Google account or request deletion at easycut@easycut.co.kr. Disconnecting does not delete videos already uploaded to YouTube or the original project output.",
    transfer: "Data is sent to Google LLC over encrypted TLS connections during authorization, user-requested uploads and authorization checks. Google may process data in the United States and countries where Google operates data centers. Videos and related data retained by Google follow Google's Privacy Policy and the user's YouTube management settings. Users may decline channel authorization to avoid these transfers and continue using features that do not require YouTube connection or uploading.",
    terms: "Use of the YouTube integration is subject to the YouTube Terms of Service. Before uploading, users must review content rights, destination channel, title, description, visibility and required content disclosures. The current test permits private uploads only; public and unlisted uploads are restricted. Access or publication may be limited by Google or YouTube review, policies or processing. Disconnecting does not delete videos already published on YouTube.",
    googlePrivacy: "Google Privacy Policy", googlePolicy: "Google API Services User Data Policy", revoke: "Manage Google account connections", youtubeTerms: "YouTube Terms of Service",
  },
  ja: {
    privacyTitle: "追加案内：YouTubeチャンネル連携とアップロード",
    termsTitle: "任意のYouTube連携",
    availability: "YouTube連携・アップロードは限定テスト環境で準備中であり、一般利用者にはまだ提供していません。本案内は、この機能の利用を選択したテスト参加者に適用されます。",
    purpose: "Easy CutはYouTube API Servicesを使用します。チャンネル連携はEasy Cutへのログインとは別に任意で行い、本人の連携チャンネルの表示、利用者が選択した完成動画のアップロード、処理結果の確認に使用します。",
    data: "チャンネルID・名称、許可された権限、認証トークンを処理します。アップロードの依頼時に、選択した動画、タイトル・説明、公開範囲、子ども向け設定、現実的な改変・合成コンテンツの表示をGoogleへ送信し、動画ID・実際の公開範囲・処理状態を取得します。非公開動画の状態確認も含みます。",
    protection: "認証トークンはサーバーで暗号化し、アカウント単位でアクセスを制限します。ブラウザや元動画の収集処理には渡しません。Google APIから取得した連携データを販売したり、広告ターゲティングや汎用AIモデルの学習に使用したりしません。Easy CutによるGoogle API情報の利用と他のアプリへの移転は、Limited Use要件を含むGoogle API Services User Data Policyに従います。",
    retention: "権限とチャンネル情報を定期的に確認し、29日間使用されていない、または有効性を確認できていない連携を削除します。アップロード詳細は作成から29日後に削除し、重複アップロード防止のための内部利用者・成果物・連携の識別子と成果物バージョン等の最小記録のみ残します。この記録も連携解除または退会時に削除します。未完了の認証要求は10分後に失効し、整理処理が正常に稼働している場合は約70分以内に削除します。",
    deletion: "連携画面で解除・データ削除を依頼できます。該当するEasy CutアカウントのすべてのYouTube連携、認証トークン、アップロード記録、未完了の認証要求を削除し、Googleの権限取消を依頼します。取消結果を確認できない場合は手動解除用リンクを表示します。Googleアカウントでも直接解除でき、easycut@easycut.co.krへ削除を依頼することもできます。解除しても、YouTubeに投稿済みの動画やプロジェクトの元データは削除されません。",
    transfer: "Google LLCへの送信は、連携・アップロード依頼および権限確認時にTLS暗号化通信で行います。Googleは米国およびGoogleのデータセンター所在地で情報を処理する場合があります。Googleが保存する投稿動画と関連データは、Googleのプライバシーポリシーと利用者のYouTube管理設定に従います。連携に同意しないことで送信を拒否でき、連携・アップロード以外の機能は引き続き利用できます。",
    terms: "YouTube連携にはYouTubeの利用規約が適用されます。投稿前に権利、投稿先、タイトル・説明、公開範囲、必須のコンテンツ表示を確認してください。現在のテストでは非公開アップロードのみ許可し、公開・限定公開は制限しています。GoogleやYouTubeの審査・方針・処理状況により利用や公開が制限される場合があります。連携解除のみでは投稿済み動画は削除されません。",
    googlePrivacy: "Googleプライバシーポリシー", googlePolicy: "Google API Services User Data Policy", revoke: "Googleアカウントの連携管理", youtubeTerms: "YouTube利用規約",
  },
};

export function YoutubePublishingNotice({ kind }: { kind: "privacy" | "terms" }) {
  const { locale } = useI18n();
  const text = copy[locale];
  return (
    <LegalSection id="youtube-publishing" title={kind === "privacy" ? text.privacyTitle : text.termsTitle}>
      <p>{text.availability}</p>
      {kind === "privacy" ? <>
        <p>{text.purpose}</p><p>{text.data}</p><p>{text.protection}</p>
        <p>{text.retention}</p><p>{text.deletion}</p><p>{text.transfer}</p>
        <ul>
          <li><a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">{text.googlePrivacy}</a></li>
          <li><a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">{text.googlePolicy}</a></li>
          <li><a href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">{text.revoke}</a></li>
        </ul>
      </> : <><p>{text.terms}</p><p><a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">{text.youtubeTerms}</a></p></>}
    </LegalSection>
  );
}
