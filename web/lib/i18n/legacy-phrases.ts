import type { SiteLocale } from "./config";

type Phrase = readonly [ko: string, en: string, ja: string];

// Legacy page copy is kept here while the product moves to semantic message keys.
// User-provided and generated content is intentionally excluded from this table.
const phrases: readonly Phrase[] = [
  ["AI 쇼츠 자동 제작 | 유튜브 링크로 숏폼 만들기 - 이지컷", "AI Shorts Maker | Turn YouTube Links into Short Videos - Easy Cut", "AIショート動画自動作成 | YouTubeリンクからショート動画へ - Easy Cut"],
  ["AI 쇼츠 제작 요금제·가격 | 이지컷", "AI Shorts Pricing & Plans | Easy Cut", "AIショート動画の料金・プラン | Easy Cut"],
  ["AI 쇼츠 템플릿 라이브러리 | 이지컷", "AI Shorts Template Library | Easy Cut", "AIショート動画テンプレートライブラリ | Easy Cut"],
  ["유튜브 실시간 인기 영상·쇼츠 소재 찾기 | 이지컷", "Trending YouTube Videos & Shorts Ideas | Easy Cut", "YouTubeリアルタイム人気動画・ショート素材 | Easy Cut"],
  ["AI 쇼츠 제작 자주 묻는 질문 | 이지컷", "AI Shorts FAQ | Easy Cut", "AIショート動画作成 よくある質問 | Easy Cut"],
  ["AI 쇼츠 만들기: 유튜브 영상으로 쇼츠 자동 제작 | 이지컷", "Create AI Shorts from YouTube Videos | Easy Cut", "YouTube動画からAIショート動画を自動作成 | Easy Cut"],
  ["AI 쇼츠 제작 툴 비교: 이지컷·알파컷·피카클립", "AI Shorts Tool Comparison: Easy Cut, AlphaCut & FikaClip", "AIショート動画ツール比較：Easy Cut・AlphaCut・FikaClip"],
  ["이용약관 | 이지컷", "Terms of Service | Easy Cut", "利用規約 | Easy Cut"],
  ["개인정보처리방침 | 이지컷", "Privacy Policy | Easy Cut", "プライバシーポリシー | Easy Cut"],
  ["취소 및 환불 정책 | 이지컷", "Cancellation & Refund Policy | Easy Cut", "キャンセル・返金ポリシー | Easy Cut"],
  ["고객센터·사업자 정보 | 이지컷", "Support & Business Information | Easy Cut", "サポート・事業者情報 | Easy Cut"],
  ["내 프로젝트", "My projects", "マイプロジェクト"],
  ["만든 쇼츠와 현재 처리 상태를 한곳에서 확인할 수 있습니다.", "View your Shorts and their current processing status in one place.", "作成したショート動画と現在の処理状況をまとめて確認できます。"],
  ["새 쇼츠 만들기", "Create new Shorts", "新しいショート動画を作成"],
  ["로그인하고 내 프로젝트도 확인하세요", "Log in to view your projects", "ログインしてプロジェクトを確認"],
  ["아래 예시 작업은 바로 둘러볼 수 있고, 로그인하면 직접 만든 프로젝트도 함께 관리할 수 있습니다.", "Browse the examples below now, or log in to manage your own projects.", "下のサンプルはすぐに閲覧できます。ログインすると自分のプロジェクトも管理できます。"],
  ["로그인하기", "Log in", "ログイン"],
  ["전체 프로젝트", "All projects", "すべてのプロジェクト"],
  ["예시 작업", "Examples", "サンプル"],
  ["아직 만든 프로젝트가 없어요", "You haven't created a project yet", "まだプロジェクトがありません"],
  ["유튜브 링크 하나로 첫 쇼츠 프로젝트를 만들어 보세요.", "Create your first Shorts project with one YouTube link.", "YouTubeリンクひとつで最初のショート動画を作成しましょう。"],
  ["첫 프로젝트 만들기", "Create first project", "最初のプロジェクトを作成"],
  ["공개된 예시 작업을 준비하고 있습니다.", "Public examples are being prepared.", "公開サンプルを準備しています。"],
  ["프로젝트로 돌아가기", "Back to projects", "プロジェクトに戻る"],
  ["프로젝트를 불러오는 중입니다.", "Loading project.", "プロジェクトを読み込んでいます。"],
  ["프로젝트를 불러오지 못했습니다.", "Could not load the project.", "プロジェクトを読み込めませんでした。"],
  ["프로젝트를 찾을 수 없습니다.", "Project not found.", "プロジェクトが見つかりません。"],
  ["프로젝트 목록", "Project list", "プロジェクト一覧"],
  ["처리 중", "Processing", "処理中"],
  ["처리 중...", "Processing...", "処理中..."],
  ["작업을 시작하고 있습니다", "Starting the job", "処理を開始しています"],
  ["준비 중...", "Preparing...", "準備中..."],
  ["완료", "Complete", "完了"],
  ["생성 실패", "Creation failed", "作成に失敗"],
  ["만료됨", "Expired", "期限切れ"],
  ["수정 반영 중", "Applying edits", "編集を反映中"],
  ["편집하기", "Edit", "編集"],
  ["다운로드", "Download", "ダウンロード"],
  ["모든 쇼츠 다운로드", "Download all Shorts", "すべてのショート動画をダウンロード"],
  ["다시 실행", "Run again", "再実行"],
  ["작업 상태 확인 실패", "Could not check job status", "処理状況を確認できませんでした"],
  ["작업 생성 실패", "Could not create the job", "処理を作成できませんでした"],

  ["템플릿 라이브러리", "Template library", "テンプレートライブラリ"],
  ["템플릿 검색", "Search templates", "テンプレートを検索"],
  ["전체 템플릿 보기", "View all templates", "すべてのテンプレートを見る"],
  ["전체", "All", "すべて"],
  ["기본", "Default", "基本"],
  ["내가 저장한 템플릿", "My saved templates", "保存したテンプレート"],
  ["나의 템플릿", "My templates", "マイテンプレート"],
  ["내 템플릿", "My template", "マイテンプレート"],
  ["커스텀 템플릿", "Custom template", "カスタムテンプレート"],
  ["새 템플릿 만들기", "Create template", "テンプレートを作成"],
  ["템플릿 편집", "Edit template", "テンプレートを編集"],
  ["템플릿 이름", "Template name", "テンプレート名"],
  ["템플릿 이름을 입력해 주세요.", "Enter a template name.", "テンプレート名を入力してください。"],
  ["템플릿 저장", "Save template", "テンプレートを保存"],
  ["저장 중...", "Saving...", "保存中..."],
  ["저장됨", "Saved", "保存済み"],
  ["템플릿을 저장했습니다. 홈의 템플릿 선택에서도 바로 사용할 수 있습니다.", "Template saved. It is now available from the template picker on Home.", "テンプレートを保存しました。ホームのテンプレート選択ですぐに使用できます。"],
  ["템플릿을 저장하지 못했습니다.", "Could not save the template.", "テンプレートを保存できませんでした。"],
  ["템플릿을 불러오지 못했습니다.", "Could not load templates.", "テンプレートを読み込めませんでした。"],
  ["검색 결과가 없습니다.", "No results found.", "検索結果がありません。"],
  ["자주 쓰는 템플릿", "Favorite templates", "よく使うテンプレート"],
  ["자주 쓰는 템플릿으로 저장", "Add to favorites", "よく使うテンプレートに追加"],
  ["자주 쓰는 템플릿에서 해제", "Remove from favorites", "よく使うテンプレートから削除"],
  ["자주 쓰는 템플릿에 등록되었습니다.", "Added to favorites.", "よく使うテンプレートに追加しました。"],
  ["자주 쓰는 템플릿에서 해제되었습니다.", "Removed from favorites.", "よく使うテンプレートから削除しました。"],
  ["자주 쓰는 템플릿은 최대 4개까지 등록할 수 있습니다.", "You can save up to four favorite templates.", "よく使うテンプレートは最大4件まで登録できます。"],
  ["자주 쓰는 템플릿을 저장하지 못했습니다.", "Could not update favorite templates.", "よく使うテンプレートを保存できませんでした。"],
  ["저장한 커스텀 템플릿은 STANDARD·PRO 플랜에서 사용할 수 있어요.", "Saved custom templates are available on STANDARD and PRO plans.", "保存したカスタムテンプレートはSTANDARD・PROプランで利用できます。"],
  ["요금제 보기", "View pricing", "料金プランを見る"],
  ["템플릿 편집은 데스크톱에서 이용해 주세요", "Please edit templates on desktop", "テンプレート編集はデスクトップでご利用ください"],
  ["1024px 이상의 화면에서 위치 이동과 크기 조절을 정확하게 사용할 수 있습니다.", "Use a screen at least 1024px wide for precise positioning and resizing.", "位置移動とサイズ調整には1024px以上の画面をご利用ください。"],
  ["라이브러리", "Library", "ライブラリ"],
  ["미리보기", "Preview", "プレビュー"],
  ["제목 스타일", "Title style", "タイトルスタイル"],
  ["제목 글자 크기", "Title size", "タイトルサイズ"],
  ["글자 크기", "Text size", "文字サイズ"],
  ["글자색", "Text color", "文字色"],
  ["텍스트 배경색", "Text background", "テキスト背景色"],
  ["화면 비율", "Aspect ratio", "アスペクト比"],
  ["채널 이름", "Channel name", "チャンネル名"],
  ["채널명 스타일", "Channel style", "チャンネル名スタイル"],
  ["댓글 추가", "Add comment", "コメントを追加"],
  ["자동 자막 표시", "Show automatic captions", "自動字幕を表示"],
  ["켜짐", "On", "オン"],
  ["꺼짐", "Off", "オフ"],

  ["실시간 인기", "Trending now", "リアルタイム人気"],
  ["지금 떠오르는 영상을 놓치지 마세요.", "Don't miss the videos trending right now.", "今注目されている動画を見逃さないでください。"],
  ["활성 구독 또는 기간 패키지로 원하는 영상만 빠르게 찾아보세요.", "Use an active subscription or term package to quickly find the right videos.", "有効なサブスクリプションまたは期間パッケージで、目的の動画をすばやく見つけましょう。"],
  ["필터", "Filters", "フィルター"],
  ["활성 이용권 전용", "Active plan only", "有効なプラン限定"],
  ["실시간 인기 필터 이용 안내", "Trending filter access", "リアルタイム人気フィルターのご案内"],
  ["해당 기능은 구독 또는 기간 패키지가 활성화되어 있을 때 사용할 수 있어요.", "This feature is available while a subscription or term package is active.", "この機能は、サブスクリプションまたは期間パッケージが有効な場合に利用できます。"],
  ["해당 기능은 로그인 후 구독 또는 기간 패키지가 활성화되어 있을 때 사용할 수 있어요.", "Sign in and activate a subscription or term package to use this feature.", "ログイン後、サブスクリプションまたは期間パッケージが有効な場合に利用できます。"],
  ["인기 영상을 불러오는 중", "Loading trending videos", "人気動画を読み込み中"],
  ["인기 영상을 불러오지 못했습니다", "Could not load trending videos", "人気動画を読み込めませんでした"],
  ["인기 영상 필터", "Trending video filters", "人気動画フィルター"],
  ["인기 기준", "Ranking", "人気基準"],
  ["조회수 상위", "Most viewed", "再生回数順"],
  ["카테고리", "Category", "カテゴリー"],
  ["언어", "Language", "言語"],
  ["영상 길이", "Video length", "動画の長さ"],
  ["재사용 허용", "Reuse allowed", "再利用可"],
  ["재사용 허용 영상만 보기", "Show reusable videos only", "再利用可能な動画のみ表示"],
  ["조건에 맞는 영상이 없습니다", "No videos match these filters", "条件に一致する動画がありません"],
  ["인기 기준, 언어, 카테고리, 영상 길이 또는 재사용 허용 조건을 변경해 보세요.", "Try changing the ranking, language, category, duration, or reuse filter.", "人気基準、言語、カテゴリー、動画の長さ、再利用条件を変更してみてください。"],
  ["추가 영상 불러오는 중...", "Loading more videos...", "さらに動画を読み込み中..."],
  ["추가 영상을 불러오지 못했습니다.", "Could not load more videos.", "追加の動画を読み込めませんでした。"],
  ["조회수", "Views", "再生回数"],
  ["게시일", "Published", "公開日"],
  ["전체 보기", "View all", "すべて見る"],

  ["나에게 맞는 요금제를 선택해 보세요.", "Choose the plan that fits you.", "自分に合ったプランを選びましょう。"],
  ["내게 맞는 플랜을 선택하세요", "Choose the right plan for you", "自分に合うプランを選択"],
  ["가장 많이 선택", "Most popular", "一番人気"],
  ["가장 인기 있는 플랜", "Most popular plan", "最も人気のプラン"],
  ["월간", "Monthly", "月間"],
  ["연간", "Annual", "年間"],
  ["월 결제", "Monthly billing", "月払い"],
  ["연 결제", "Annual billing", "年払い"],
  ["현재 플랜", "Current plan", "現在のプラン"],
  ["지금 시작하기", "Get started", "今すぐ始める"],
  ["플랜 업그레이드가 필요해요", "Plan upgrade required", "プランのアップグレードが必要です"],
  ["플랜 한눈에 보기", "Plans at a glance", "プラン比較"],
  ["기능·제공량 비교표", "Feature and allowance comparison", "機能・提供量の比較"],
  ["처리시간", "Processing time", "処理時間"],
  ["프로젝트 보관", "Project retention", "プロジェクト保存期間"],
  ["동시 작업", "Concurrent jobs", "同時処理"],
  ["추가 처리시간", "Additional processing time", "追加処理時間"],
  ["추가 시간 구매", "Buy additional time", "追加時間を購入"],
  ["활성 구독자만 구매 가능", "Available to active subscribers", "有効な登録者のみ購入可能"],
  ["구독 관리", "Manage subscription", "サブスクリプション管理"],
  ["결제 주기", "Billing cycle", "請求サイクル"],
  ["다음 결제일", "Next payment", "次回支払日"],
  ["결제 카드", "Payment card", "支払いカード"],
  ["결제수단 변경", "Change payment method", "支払い方法を変更"],
  ["기간 말에 해지", "Cancel at period end", "期間終了時に解約"],
  ["해지 예약 취소", "Undo scheduled cancellation", "解約予約を取り消す"],
  ["다음 갱신 때 변경", "Change at next renewal", "次回更新時に変更"],
  ["다음 결제일부터 새 플랜이 적용됩니다.", "The new plan starts on your next billing date.", "次回の支払日から新しいプランが適用されます。"],
  ["결제 화면을 준비하고 있습니다...", "Preparing checkout...", "決済画面を準備しています..."],
  ["결제 결과를 확인하고 있습니다...", "Checking payment result...", "決済結果を確認しています..."],
  ["결제 완료", "Payment complete", "支払い完了"],
  ["결제 실패", "Payment failed", "支払い失敗"],
  ["결제가 완료되었습니다", "Payment completed", "支払いが完了しました"],
  ["결제가 취소되었습니다", "Payment canceled", "支払いがキャンセルされました"],
  ["결제를 완료하지 못했습니다", "Could not complete payment", "支払いを完了できませんでした"],
  ["Easy Cut으로 이동", "Go to Easy Cut", "Easy Cutへ移動"],
  ["다시 로그인하고 이동", "Log in again and continue", "再ログインして続行"],
  ["가격 페이지로 돌아가기", "Back to pricing", "料金ページに戻る"],
  ["취소하고 가격 페이지로 돌아가기", "Cancel and return to pricing", "キャンセルして料金ページに戻る"],
  ["구독 결제 카드 등록", "Register subscription card", "サブスクリプションカード登録"],
  ["정기결제 카드 변경", "Change recurring payment card", "定期支払いカードを変更"],
  ["이름", "Name", "氏名"],
  ["이메일", "Email", "メール"],
  ["휴대전화", "Phone", "携帯電話"],
  ["카드번호 16자리", "16-digit card number", "16桁のカード番号"],
  ["유효기간 월", "Expiry month", "有効期限（月）"],
  ["유효기간 연도", "Expiry year", "有効期限（年）"],
  ["생년월일 / 사업자번호", "Date of birth / business number", "生年月日／事業者番号"],
  ["비밀번호 앞 2자리", "First 2 digits of card PIN", "カード暗証番号の先頭2桁"],
  ["나이스페이 처리 중...", "Processing with NICEPAY...", "NICEPAYで処理中..."],
  ["빌링키 발급 후 구독 시작", "Issue billing key and subscribe", "請求キーを発行して登録"],
  ["새 카드로 변경", "Use new card", "新しいカードに変更"],

  ["AI 쇼츠 제작", "AI Shorts creation", "AIショート動画作成"],
  ["자주 묻는 질문", "Frequently asked questions", "よくある質問"],
  ["더 확인하고 싶은 내용이 있나요?", "Want to learn more?", "さらに確認したいことはありますか？"],
  ["AI 쇼츠 툴 비교", "Compare AI Shorts tools", "AIショート動画ツールを比較"],
  ["고객센터", "Customer support", "カスタマーサポート"],
  ["고객 지원", "Customer support", "カスタマーサポート"],
  ["서비스 이용, 결제, 개인정보 및 계정 관련 문의를 아래 연락처로 보내주세요.", "Contact us below with questions about the service, payments, privacy, or your account.", "サービス、支払い、プライバシー、アカウントに関するお問い合わせは下記までお送りください。"],
  ["평일 14:00 ~ 19:00", "Weekdays 14:00–19:00 KST", "平日 14:00〜19:00（KST）"],
  ["주말과 공휴일에 접수된 문의는 다음 영업일 운영시간부터 순차적으로 답변합니다.", "Requests received on weekends or holidays are answered from the next business day.", "週末・祝日に受け付けたお問い合わせは、翌営業日から順次回答します。"],
  ["다음으로 확인할 내용", "What to explore next", "次に確認する内容"],
  ["유튜브 영상으로", "Turn YouTube videos into", "YouTube動画から"],
  ["AI 쇼츠 만드는 방법", "How to create AI Shorts", "AIショート動画を作る方法"],
  ["유튜브 영상으로 AI 쇼츠 만드는 방법", "How to create AI Shorts from YouTube videos", "YouTube動画からAIショート動画を作る方法"],
  ["직접 제작했거나 이용 권한을 가진 공개 YouTube 영상의 URL을 붙여 넣습니다.", "Paste the URL of a public YouTube video you created or are authorized to use.", "自分で制作した、または利用権限のある公開YouTube動画のURLを貼り付けます。"],
  ["AI 하이라이트 분석", "AI highlight analysis", "AIハイライト分析"],
  ["긴 영상을 처음부터 다시 보지 않아도 핵심 장면을 자동으로 선별합니다.", "AI selects key moments without making you rewatch the entire video.", "長い動画を最初から見直さなくても、重要な場面を自動で選びます。"],
  ["제목·자막 편집", "Edit titles and captions", "タイトル・字幕編集"],
  ["자유롭게 편집하고 다운로드", "Edit freely and download", "自由に編集してダウンロード"],

  ["이용약관", "Terms of Service", "利用規約"],
  ["개인정보처리방침", "Privacy Policy", "プライバシーポリシー"],
  ["취소 및 환불 정책", "Cancellation and Refund Policy", "キャンセル・返金ポリシー"],
  ["취소 및 환불", "Cancellation & refunds", "キャンセル・返金"],
  ["시행일", "Effective date", "施行日"],
  ["목적 및 적용", "Purpose and scope", "目的と適用"],
  ["계정 및 로그인", "Accounts and login", "アカウントとログイン"],
  ["서비스 이용 조건", "Service conditions", "サービス利用条件"],
  ["콘텐츠 권리와 이용자의 책임", "Content rights and user responsibility", "コンテンツ権利と利用者の責任"],
  ["금지 행위", "Prohibited conduct", "禁止行為"],
  ["AI 생성 결과", "AI-generated results", "AI生成結果"],
  ["요금제와 결제", "Plans and payments", "プランと支払い"],
  ["보관 및 삭제", "Retention and deletion", "保存と削除"],
  ["서비스의 변경·중단", "Service changes and interruptions", "サービスの変更・中断"],
  ["이용 제한 및 계약 해지", "Usage restrictions and termination", "利用制限と契約終了"],
  ["책임의 제한", "Limitation of liability", "責任の制限"],
  ["개인정보 보호", "Privacy protection", "個人情報保護"],
  ["준거법 및 분쟁 해결", "Governing law and disputes", "準拠法と紛争解決"],
  ["목적 및 적용 범위", "Purpose and scope", "目的と適用範囲"],
  ["용어의 뜻", "Definitions", "用語の定義"],
  ["상품별 결제 및 제공 기준", "Payment and delivery by product", "商品別の支払い・提供基準"],
  ["구독 해지 예약과 자동갱신 중단", "Scheduled cancellation and stopping renewal", "解約予約と自動更新の停止"],
  ["플랜 변경과 결제 실패", "Plan changes and payment failures", "プラン変更と支払い失敗"],
  ["청약철회와 전액 환불", "Withdrawal and full refunds", "撤回と全額返金"],
  ["사용 후 중도 해지 및 부분 환불", "Early termination and partial refunds after use", "利用開始後の中途解約・一部返金"],
  ["청약철회 또는 환불이 제한되는 경우", "When withdrawal or refunds are restricted", "撤回・返金が制限される場合"],
  ["표시·광고와 다른 제공 또는 서비스 하자", "Service defects or differences from advertised service", "表示・広告との差異またはサービス不備"],
  ["추가 처리시간의 환불 및 만료", "Refunds and expiry of additional time", "追加処理時間の返金・有効期限"],
  ["중복 결제·과오금·결제 도용", "Duplicate, mistaken, or unauthorized payments", "重複・過誤・不正利用された支払い"],
  ["약관 위반과 회사의 계약 해지", "Terms violations and termination by the company", "規約違反と当社による契約終了"],
  ["환불 신청 방법", "How to request a refund", "返金申請方法"],
  ["약관의 변경 및 문의", "Changes and inquiries", "規約変更・お問い合わせ"],
  ["환불 방법과 처리 기간", "Refund method and processing period", "返金方法・処理期間"],
  ["기록, 입증 및 부정 환불 방지", "Records, evidence, and refund abuse prevention", "記録・立証・不正返金の防止"],
  ["사업자 정보", "Business information", "事業者情報"],
  ["정책 변경, 준거 기준 및 분쟁 해결", "Policy changes, governing standards, and disputes", "ポリシー変更・準拠基準・紛争解決"],
  ["사업자 및 환불 담당자 정보", "Business and refund contact information", "事業者・返金担当者情報"],
  ["개인정보의 처리 목적", "Purposes of processing personal information", "個人情報の処理目的"],
  ["처리하는 개인정보 항목", "Personal information processed", "処理する個人情報の項目"],
  ["개인정보의 처리 및 보유 기간", "Processing and retention period", "個人情報の処理・保有期間"],
  ["개인정보의 제3자 제공", "Sharing with third parties", "第三者提供"],
  ["처리업무의 위탁 및 외부 서비스 이용", "Processors and external services", "処理委託・外部サービス利用"],
  ["AI를 이용한 데이터 처리", "Data processing using AI", "AIを利用したデータ処理"],
  ["개인정보의 파기 절차 및 방법", "Deletion procedures and methods", "個人情報の破棄手順・方法"],
  ["쿠키의 사용", "Use of cookies", "Cookieの使用"],
  ["이용자의 권리와 행사 방법", "User rights and how to exercise them", "利用者の権利と行使方法"],
  ["개인정보의 안전성 확보 조치", "Security measures", "安全管理措置"],
  ["만 14세 미만 아동", "Children under 14", "14歳未満の児童"],
  ["개인정보 보호책임자 및 문의", "Privacy officer and inquiries", "個人情報保護責任者・お問い合わせ"],
  ["처리방침의 변경", "Policy changes", "ポリシーの変更"],
  ["청약철회", "Right of withdrawal", "撤回権"],
  ["중도 해지", "Early termination", "中途解約"],
  ["환불", "Refund", "返金"],
  ["환불 문의", "Refund request", "返金に関するお問い合わせ"],
  ["사업자 정보", "Business information", "事業者情報"],
  ["대표", "Representative", "代表"],
  ["전화", "Phone", "電話"],
  ["주소", "Address", "住所"],

  ["영상 이용 제한 안내", "Video usage restriction", "動画利用制限のお知らせ"],
  ["이 영상은 이용 제한이 확인된 영상입니다.", "This video has a usage restriction.", "この動画には利用制限があります。"],
  ["이 영상은 쇼츠로 만들 수 없습니다.", "This video cannot be turned into Shorts.", "この動画からショート動画を作成できません。"],
  ["생성 불가 사유 보기", "View restriction details", "作成できない理由を見る"],
  ["동시 작업 한도에 도달했어요", "Concurrent job limit reached", "同時処理の上限に達しました"],
  ["제목 언어", "Title language", "タイトル言語"],
  ["중국어(간체)", "Chinese (Simplified)", "中国語（簡体字）"],
  ["스페인어", "Spanish", "スペイン語"],
  ["프랑스어", "French", "フランス語"],
  ["독일어", "German", "ドイツ語"],
  ["포르투갈어(브라질)", "Portuguese (Brazil)", "ポルトガル語（ブラジル）"],
  ["원본 영상", "Source video", "元動画"],
  ["예상 쇼츠", "Estimated Shorts", "予想ショート動画"],
  ["영상 썸네일", "Video thumbnail", "動画サムネイル"],
  ["템플릿 선택", "Choose a template", "テンプレートを選択"],
  ["영상 비율", "Video aspect ratio", "動画のアスペクト比"],
  ["쇼츠 생성하기", "Create Shorts", "ショート動画を作成"],
  ["로그인 후 쇼츠 생성하기", "Log in to create Shorts", "ログインしてショート動画を作成"],
  ["플랜 선택하고 쇼츠 만들기", "Choose a plan to create Shorts", "プランを選んでショート動画を作成"],
  ["쇼츠 생성 불가", "Shorts unavailable", "ショート動画を作成できません"],
  ["로그인 확인 중...", "Checking login...", "ログインを確認中..."],
  ["다시 시도", "Try again", "もう一度試す"],
  ["내 사용내역 보기", "View my activity", "利用履歴を見る"],
  ["내 결제·사용 내역", "My payments & usage", "決済・利用履歴"],
  ["내 결제 내역", "Payment history", "決済履歴"],
  ["내 사용 내역", "Usage history", "利用履歴"],
  ["결제 방식", "Payment method", "支払い方法"],
  ["일시불", "One-time payment", "一括払い"],
  ["이번 달 무이자 혜택 보기", "View this month's interest-free offers", "今月の無利息特典を見る"],
  ["이번 달 무이자 할부", "This month's interest-free installments", "今月の無利息分割払い"],
  ["예상 부분환불액", "Estimated partial refund", "一部返金予定額"],
  ["PG 지원 확인 중", "PG support pending", "PG対応確認中"],
  ["카드사·상품·회원 정책에 따라 실제 적용 결과가 달라질 수 있으며 최종 조건은 카드사 승인 결과를 따릅니다.", "Actual terms may vary by card issuer, product, and member policy. Final terms follow the issuer's approval result.", "カード会社・商品・会員条件により実際の適用結果が異なる場合があり、最終条件はカード会社の承認結果に従います。"],
  ["기존 플랜의 미사용 기간에 해당하는 금액은 업그레이드 완료 후 3영업일 이내 원 결제수단으로 부분환불 처리됩니다. 카드사 반영 시점은 다를 수 있습니다.", "The unused portion of your previous plan will be partially refunded to the original payment method within 3 business days after the upgrade. Posting time may vary by issuer.", "旧プランの未使用期間分は、アップグレード完了後3営業日以内に元のお支払い方法へ一部返金されます。カード会社への反映時期は異なる場合があります。"],
  ["닫기", "Close", "閉じる"],
  ["확인", "Confirm", "確認"],
  ["저장", "Save", "保存"],
  ["취소", "Cancel", "キャンセル"],
] as const;

const phraseMaps: Record<Exclude<SiteLocale, "ko">, Map<string, string>> = {
  en: new Map(phrases.map(([ko, en]) => [ko, en])),
  ja: new Map(phrases.map(([ko, , ja]) => [ko, ja])),
};

function withOriginalWhitespace(original: string, translated: string) {
  const leading = original.match(/^\s*/)?.[0] || "";
  const trailing = original.match(/\s*$/)?.[0] || "";
  return `${leading}${translated}${trailing}`;
}

function translateDynamicText(value: string, locale: Exclude<SiteLocale, "ko">) {
  const trimmed = value.trim();
  const installmentMatch = /^(\d+)개월 할부$/.exec(trimmed);
  if (installmentMatch) {
    return withOriginalWhitespace(
      value,
      locale === "en" ? `${installmentMatch[1]}-month installments` : `${installmentMatch[1]}回払い`,
    );
  }
  const partialRefundMatch = /^([\d,]+원)은 영업일 \+?3일 이내에 원 결제수단으로 부분환불 처리됩니다\. 카드사 반영 시점은 다를 수 있습니다\.(.*)$/.exec(trimmed);
  if (partialRefundMatch) {
    return withOriginalWhitespace(value, locale === "en"
      ? `${partialRefundMatch[1]} will be partially refunded to the original payment method within 3 business days. Posting time may vary by issuer.${partialRefundMatch[2]}`
      : `${partialRefundMatch[1]}は3営業日以内に元のお支払い方法へ一部返金されます。カード会社への反映時期は異なる場合があります。${partialRefundMatch[2]}`);
  }
  const articleMatch = /^제(\d+)조\s+(.+)$/.exec(trimmed);
  if (articleMatch) {
    const translatedTitle = phraseMaps[locale].get(articleMatch[2]);
    if (translatedTitle) {
      return withOriginalWhitespace(value, locale === "en"
        ? `Article ${articleMatch[1]}. ${translatedTitle}`
        : `第${articleMatch[1]}条 ${translatedTitle}`);
    }
  }
  const numberedHeadingMatch = /^(\d+)\.\s+(.+)$/.exec(trimmed);
  if (numberedHeadingMatch) {
    const translatedTitle = phraseMaps[locale].get(numberedHeadingMatch[2]);
    if (translatedTitle) return withOriginalWhitespace(value, `${numberedHeadingMatch[1]}. ${translatedTitle}`);
  }
  const itemMatch = /^(\d+)개$/.exec(trimmed);
  if (itemMatch) return withOriginalWhitespace(value, locale === "en" ? itemMatch[1] : `${itemMatch[1]}件`);
  const minuteMatch = /^(\d+)분$/.exec(trimmed);
  if (minuteMatch) return withOriginalWhitespace(value, locale === "en" ? `${minuteMatch[1]} min` : `${minuteMatch[1]}分`);
  const dayMatch = /^(\d+)일$/.exec(trimmed);
  if (dayMatch) return withOriginalWhitespace(value, locale === "en" ? `${dayMatch[1]} days` : `${dayMatch[1]}日`);
  const agoMatch = /^(\d+)시간 전$/.exec(trimmed);
  if (agoMatch) return withOriginalWhitespace(value, locale === "en" ? `${agoMatch[1]} hours ago` : `${agoMatch[1]}時間前`);
  return null;
}

export function translateLegacyText(value: string, locale: SiteLocale) {
  if (locale === "ko" || !/[가-힣]/.test(value)) return value;
  const exact = phraseMaps[locale].get(value.trim());
  if (exact) return withOriginalWhitespace(value, exact);
  return translateDynamicText(value, locale) || value;
}

export function hasLegacyPhrase(locale: Exclude<SiteLocale, "ko">, source: string) {
  return phraseMaps[locale].has(source);
}
