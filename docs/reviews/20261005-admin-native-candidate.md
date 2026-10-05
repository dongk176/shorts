# 관리자 iPhone 앱 배포·수신 검증

- 날짜: 2026-10-05 (KST).
- 작업트리: `/Users/gimdongmin/shorts-clean/.tmp/admin-native-20261005`.
- 브랜치: `codex/admin-native-20261005`.
- 운영 기준: `0f09c77513388f8ca5cd30f15b4a7c5bbb2011ef`, `dpl_HtLht9PpqLg1a1s8LNDvS5AvJJpA`.
- 검증 후보 소스: `b14b0a7f0de2ed99c59ec7f9cb3e97f18031ef74`.
- 후보 배포: `dpl_4V35Ve8UK97JEVuHVTNdWik2JgAZ`.
- 후보 주소: `https://shorts-5brfd3i24-artiroom.vercel.app`.
- 운영 프로젝트: `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, 팀 `team_3pn55cGmUE8SRRKg0D3dRiPJ`.
- DB: `mvcprswvfybudtopepuj` / `shorts_mvp`. lab 미사용.

## 승인된 연결과 적용 내역

사용자가 전용 푸시 키 생성과 기존 서버 비밀 설정 연결을 명시적으로 승인했다.
Apple 팀 `4B87GN52YS`에 `EasyCut Admin Push` 키 `68Q5Y2FVPJ`를 생성했다.
범위는 Sandbox / Topic Specific / `kr.co.easycut.admin` 한 개다.
다른 앱의 키를 변경하거나 재사용하지 않았다.

운영 Vercel에 `ADMIN_APNS_KEY_ID`, `ADMIN_APNS_TEAM_ID`, `ADMIN_APNS_TOPIC`,
`ADMIN_APNS_PRIVATE_KEY` 네 항목을 Production / sensitive로 저장했다.
기존 환경변수의 ID·값·범위·유형 대조에서 변경은 0개였다.
키 원문은 출력하지 않았고, 저장소에서 제외된 로컬 백업과 다운로드 파일은 0600으로 보호했다.

`202610050002_admin_native_push.sql`을 트랜잭션과 2초 잠금/15초 쿼리 제한으로 적용했다.
관리자 전용 테이블만 변경했다. 기존 웹 푸시 구독은 1개/활성 1개로 그대로 유지됐다.
새 관리자 인증 테이블 두 개의 RLS 활성, anon/authenticated 조회 권한 없음도 확인했다.
고객 결제·제작 데이터, 워커, 대기열, 유튜브 점검 설정은 변경하지 않았다.

## 검증 결과와 한계

- 깨끗한 후보 소스에서 Vercel Linux 빌드 성공. 정확한 커밋을 배포 메타데이터로 확인했다.
- 기존 lambda 경로 530개 모두 유지, 후보 538개. 보호 경로 5개 모두 유지됐다.
- 후보 홈·가이드·가격 200, 관리자 페이지는 기존 로그인으로 307.
- 형식에 맞는 미존재 short UUID를 사용한 편집기 경로가 운영·후보 모두 200으로 동일했다.
  처음 사용한 `/projects/1/edit/1`은 잘못된 UUID 형식이라 404였으며, 코드 결함으로 판단하지 않았다.
- 관리자 웹 앱과 native.js 200. 비로그인 overview/native push/cron은 401.
- 네이티브 로그인 시작은 기존 로그인으로 303, 무효 코드 교환은 401이며 앱 세션 쿠키 미발급.
- 후보의 인증된 관리자 모니터 실행 200, enabled=true, scan skipped=false,
  delivery sent=0/skipped=0/failed=0.
- 접근 보호된 후보는 Vercel 공식 `curl` 기능으로 검사했다. 일반 HTTP의 SSO 응답은
  제품 검증으로 계산하지 않았다. 현재 CLI는 `curl`에 `--scope`를 넘기면 오동작하므로
  검증된 프로젝트 연결을 사용했다.
- Apple sandbox에 무효 기기 토큰으로 제한한 한 번의 인증 검사는 400/BadDeviceToken.
  키 인증이 거절되지는 않았지만 실제 기기 알림 전달을 증명하지는 않는다.
- 후보 검증 시점에는 실제 iPhone이 Mac에서 unavailable이었다. 이후 아래 운영 검증에서
  네이티브 로그인·APNs 등록과 사용자의 실제 알림 수신 확인을 완료했다.

## 운영 전환 상태

첫 승격 시도는 자동 승인 검토에서 실제 운영 도메인 전환의 명시적 승인이 없다는 이유로
거절됐다. 우회하지 않고 구체적인 운영 반영 승인을 요청했고, 사용자가 `승인`이라고 답했다.
이 명시적 승인 이후 기준 운영 배포와 후보 커밋·프로젝트·검증 결과를 다시 확인했다.
검증한 `dpl_4V35Ve8UK97JEVuHVTNdWik2JgAZ`를 재빌드 없이 승격했고,
실제 `https://www.easycut.co.kr`이 같은 READY 배포를 가리키는 것을 다시 조회했다.

## 운영·실기기 최종 확인

- 2026-10-05 17시 전후 KST 운영 도메인에서 보호 경로 5개와 관리자 화면 정상 응답.
- 운영 app.js/native.js 내용이 검증한 소스와 바이트 단위로 일치.
- 비로그인 관리자 API는 401, 네이티브 로그인 시작은 기존 로그인으로 303.
- 기존 관리자 브라우저 세션에서 실제 대시보드와 네이티브 로그인 확인 화면이 정상 로드됐다.
- 운영 관리자 모니터 200, enabled=true, scan skipped=false, 발송 오류 0.
- 배포 직후 해당 배포의 최근 10분 오류 로그 조회는 0건이었다. 이후 전체 기간의 무오류를
  보장하거나 실제 고객 결제·제작 전체 흐름을 재실행한 검증으로 표현하지 않는다.
- 17:00:24 KST, 이전 짧은 수집 제한으로 발생한 과도한 알림이 자동 복구 처리됐고
  관리자 화면에서 현재 확인할 운영 알림이 없는 것을 확인했다.
- 17:01:00.842 KST, 활성 development APNs 기기의 테스트 알림 요청 기록.
- 17:01:48 KST 조회: 네이티브 로그인 세션 1개, APNs 구독 1개/활성 1개,
  기존 웹 구독 1개/활성 1개 유지. 기기 토큰이나 개인정보는 출력하지 않았다.
- 사용자가 `오 테스트알림 온다!`라고 실제 iPhone 수신을 확인했다.
- 고객 결제·제작 데이터, 워커·대기열·유튜브 점검 설정은 변경하지 않았다.
