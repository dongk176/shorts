# EasyCut Admin · 개인용 iPhone 앱

`EasyCutAdmin.xcodeproj`를 Xcode에서 열고 iPhone을 연결한 뒤 ▶︎를 누릅니다.
Signing Team은 기존 `dongmin Kim (4B87GN52YS)`, 앱 식별자는 `kr.co.easycut.admin`으로 설정했습니다.
iPhone에서 개발자 모드와 이 Mac 신뢰가 요청되면 기기에서 허용해야 합니다.

화면은 `https://www.easycut.co.kr/admin-app/index.html`에서 매번 받아옵니다.
웹 화면·문구·집계 변경에는 앱 재설치가 필요 없습니다. iOS 코드나 서명을 변경하거나
개발용 프로파일이 만료되면 Xcode에서 다시 설치해야 합니다.

로그인은 iOS 보안 로그인 창을 사용합니다. 기존 EasyCut 관리자 계정으로 로그인한 뒤
앱으로 돌아옵니다. 앱 설정에서 `푸시알림 켜기`를 눌러 iPhone 권한을 허용합니다.
`테스트 알림 받기`로 확인하며, 알림을 누르면 앱의 알림함이 열립니다.

## 현재 준비 상태

- 시뮬레이터 빌드와 iPhone용 Apple 서명 빌드 확인.
- Apple Developer에 EasyCut Admin 식별자 및 Push Notifications 등록.
- 네이티브 APNs 클라이언트와 서버 발송 코드, 관리자 전용 로그인, 기존 PWA 병행 구현.
- **아직 완료되지 않음:** 서버 코드/추가 마이그레이션 배포, APNs 전용 키 설정,
  실기기 설치와 잠금 화면 수신 확인. 현재 운영 서버에는 네이티브 로그인 API가 아직 없습니다.

앱을 Apple App Store에 등록하거나 심사를 제출하지 않았습니다.
APNs 개인 키는 iPhone 앱에 넣지 않습니다.

## 빌드

```sh
xcodebuild -project EasyCutAdmin.xcodeproj -scheme EasyCutAdmin \
  -configuration Debug -destination 'generic/platform=iOS' \
  -allowProvisioningUpdates build
```

Debug는 APNs development, Release는 production을 사용합니다. 코드와 서명 권한이
동일한 환경을 사용하도록 `APNS_ENVIRONMENT` 설정이 Info.plist와 entitlements에 함께 반영됩니다.
서버 키는 해당 APNs 환경과 `kr.co.easycut.admin` 주제에 대한 권한이 있어야 합니다.

## 서버 연결

기존 운영 Vercel 프로젝트의 비밀 환경변수에 `ADMIN_APNS_KEY_ID`, `ADMIN_APNS_TEAM_ID`,
`ADMIN_APNS_PRIVATE_KEY`, `ADMIN_APNS_TOPIC`을 설정합니다. `ADMIN_APNS_TOPIC`은
`kr.co.easycut.admin`, 팀은 `4B87GN52YS`입니다. 기존 `ADMIN_MOBILE_ENABLED=1`,
`CRON_SECRET`, Web Push 환경변수는 유지합니다. 키가 없으면 설정 완료로 표시하지 않습니다.

추가 마이그레이션 `202610050002_admin_native_push.sql`은 관리자 구독 테이블 확장과
관리자 전용 로그인 코드/세션 테이블만 다룹니다. 기존 제작·결제 데이터는 수정하지 않습니다.
네이티브 세션은 모바일 관리자 API에만 적용되고 기존 제품·결제 변경 API에는 사용할 수 없습니다.
로그인 코드는 PKCE와 연결되며 60초 뒤 만료되고 1회만 사용됩니다. 세션은 30일 동안 유효하고
매 요청마다 현재 관리자 권한을 재확인합니다. 로그아웃하면 이 앱 세션과 기기 알림을 해제합니다.

원격 적용 전 현재 운영 기준을 재확인하고 후보 URL에서 보호 경로와 인증을 확인해야 합니다.
