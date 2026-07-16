# Architecture

## Control plane

`web/`은 Vercel Pro의 Next.js App Router 한 페이지 앱입니다. Route Handler만 Supabase와 AWS를 호출하며 브라우저는 DB/service-role/CloudFront private key에 직접 접근하지 않습니다. 첫 요청에서 256-bit random token을 HttpOnly cookie로 발급하고 DB에는 SHA-256 hash만 저장합니다. Google OAuth는 서버 Route Handler에서 Supabase Auth PKCE 흐름으로 처리합니다. 로그인하면 `auth.users`와 연결된 `shorts_mvp.app_users`가 생성·갱신되고 현재 익명 세션의 분석, 작업, 쇼츠, 사용량이 해당 사용자에게 귀속됩니다. 로그아웃하면 계정에 연결된 MVP 쿠키를 폐기해 익명 상태에서 계정 데이터를 다시 열 수 없게 합니다.

`POST /api/jobs`는 사전 발급한 `analysisId`와 권리 확인, 60분 제한, idempotency, 세션 동시 제한, plan enforcement를 검사합니다. `video_jobs`, `usage_reservations`, `job_outbox`를 한 transaction에서 만든 뒤 즉시 202를 반환합니다. Dispatcher는 사용 가능한 Dedicated ISP 슬롯만큼만 Outbox 작업을 원자적으로 예약해 SQS와 AWS Batch Array Job으로 전달합니다. 10개 슬롯이 모두 사용 중이면 작업은 DB에서 대기하고 Fargate task를 미리 띄우지 않습니다. 상태 API는 실제 DB stage, 완료된 shorts, 최신 usage를 한 응답에 포함합니다.

## Data plane

`worker/`는 HTTP 서버가 아닌 CLI입니다. Prepare Fargate task는 배정된 ISP 경로만 사용해 공개 YouTube 원본을 task `/tmp`에 받고 다운로드 직후 해당 슬롯을 반환합니다. 이후 OpenAI 전체 오디오 전사, Gemini/OpenAI 하이라이트 선택, clean clip 생성은 프록시 없이 계속됩니다. Render EC2 task는 최대 4개 clean clip을 받아 FFmpeg 최대 2개를 병렬 실행하고 최종 output/thumbnail을 생성합니다. 모든 종료 경로에서 temp tree를 지웁니다.

Rerender는 private clean clip만 받아 편집된 overlay를 적용합니다. 새 version key 업로드 → DB transaction으로 key/version 교체 → 이전 object 삭제 순서여서 실패 시 기존 output이 유지됩니다.

## Object delivery

S3는 public access block과 OAC만 허용합니다. CloudFront viewer-request Function은 `/outputs/` 외 URI를 403으로 막고 key group Signed URL을 요구합니다. `edit-sources/`는 worker IAM만 읽을 수 있습니다. Signed URL은 15분과 DB `expires_at` 중 이른 시각까지만 유효합니다.

## Recovery

Worker 진행 이벤트는 SQS State Writer가 일괄 반영합니다. Batch FAILED EventBridge Lambda는 Array child를 원래 job/shard로 매핑해 ISP 슬롯을 반환하고 중앙 Outbox로 재시도합니다. ISP 슬롯 lease는 20분 뒤 자동 복구되며 BOT_CHECK/429 경로는 5분, 네트워크 오류 경로는 1분 cooldown됩니다. 1분 주기 Watchdog은 queue/processing deadline, 만료 objects, 2시간 stale job을 정리합니다. S3 30일 lifecycle은 최종 안전장치입니다.
