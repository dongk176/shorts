# 개인용 관리자 iOS 앱 준비

## 대상과 기준

- 작업 폴더: `/Users/gimdongmin/shorts-clean/.tmp/admin-native-20261005`
- 브랜치: `codex/admin-native-20261005`
- 실제 운영 기준: `0f09c77513388f8ca5cd30f15b4a7c5bbb2011ef`, Vercel `dpl_HtLht9PpqLg1a1s8LNDvS5AvJJpA`.
- 확인한 운영 프로젝트: `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, DB `mvcprswvfybudtopepuj` / `shorts_mvp`.
- lab 코드·환경을 사용하지 않았다. 고객 작업·결제·기존 알림 설정은 수정하지 않았다.
- Apple Developer 팀 `4B87GN52YS` 멤버십 유효 확인. `kr.co.easycut.admin` App ID와 Push Notifications 등록 완료.
- 기존 Apple Development 인증서로 iPhone용 서명 빌드 성공. 개인 키 값은 출력하지 않았다.

## 변경과 검증

웹 화면을 WKWebView에서 로드하고 알림은 APNs로 수신한다. 기존 PWA Web Push를 보존한다.
네이티브 로그인은 시스템 보안 로그인 창, 명시적인 로그인 버튼, PKCE, 1회용/60초 코드,
모바일 API에 한정된 30일 HttpOnly 세션을 사용한다. 관리자 권한은 매 요청 재확인한다.
Apple 개인 키는 서버에만 설정하며 앱에 포함하지 않는다.

- iOS Simulator 및 iPhone Debug 서명 빌드 성공.
- 웹 production build, typecheck, lint 성공.
- 관리자 관련 27개 테스트 성공: 기존 PWA 동작, PKCE/재사용/만료, 권한 회수,
  APNs 토큰 갱신·소유권, 서명 검증, 짧은 수집 제한의 과도한 알림 방지 포함.
- 실제 iPhone은 현재 Mac에서 unavailable 상태여서 설치와 실제 APNs 전달은 미검증.
- 추가 스키마는 로컬 PostgreSQL 호환 엔진에서 검증했으며 운영에 적용하지 않았다.

## 수집 알림 진단

2026-10-05 13:36 KST 운영 읽기 조회에서 회로 reason/blocked_until은 null이었다.
13:35:05에 수집 성공, 13:36에는 대기 1건·실행 1건이 확인됐다.
13:07–13:37 30분 범위에서 수집 성공 14회, bot_check 7회(4개 작업)였다.
기존 회로는 봇 검사 비율에 따른 짧은 제한을 사용할 수 있으며 실제 배포 DB 대기열 함수는
bot_check_rate 제한 만료 시 자동으로 해제한다. 회로 과거 reason은 알림에 저장되지 않아
각 알림 시점의 정확한 reason까지 확정하지 않았다.

14:10 KST 재확인에서도 reason/blocked_until은 null, 미완료·대기 작업은 0건이었다.
최근 15분 수집 성공 5회, bot_check 3회. 최근 50회는 성공 30회/bot_check 20회였다.

관리자 알림은 blocked_until>now() 단일 조건을 긴급 '수집 중단'으로 표현해 과도했다.
후보 수정은 제한 활성 + 대기 있음 + 최장 대기 5분 이상 + 최근 5분 수집 성공 없음으로 좁힌다.
작업·회로를 수동 재개하거나 워커 로직을 변경하지 않았다. 이 수정은 아직 운영 미반영이다.

## 남은 외부 연결과 배포 확인 사항

1. EasyCut 전용 APNs 키 생성/서버 연결. 다른 앱의 키를 복사하거나 재사용하지 않았다.
   Apple 웹에서 영구 발송 자격 증명을 생성하기 직전 컴퓨터 제어 도구의 보안 규칙상
   명시적 확인이 필요하다. 전용 앱 주제로 범위를 제한한다.
   Apple 생성 검토 화면에는 `EasyCut Admin Push`, Sandbox, Topic Specific,
   `kr.co.easycut.admin` 1개만 설정했고 Register는 누르지 않았다.
2. 현재 운영 원본에는 `/api/youtube/accounts/oauth/start` 및 callback과
   `youtube.upload` scope가 이미 포함돼 있다. 이는 제공된 AGENTS.md의
   'Production candidates must not contain ... publishing OAuth/publication APIs'
   조건과 충돌하므로 서버 재배포/운영 DB 변경은 보류했다. 기존 기능을 임의로 삭제하거나
   새 관리 앱 작업을 명목으로 이 지침을 무시하지 않았다. 현재 기능 유지에 대한 범위 확인이 필요하다.
3. 이후 현재 운영 기준 재확인 → additive migration → unaliased candidate → 기존 5개 보호 경로
   및 네이티브 인증 검증 → 같은 배포 승격 → iPhone 설치/테스트 알림을 수행한다.

새 유료 프로젝트나 고정비 자원은 생성하지 않았다. 기존 Apple 회원권·서명·로컬 빌드를 사용했다.
