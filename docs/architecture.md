# Architecture

## Control plane

`web/`은 Vercel Pro의 Next.js App Router 한 페이지 앱입니다. Route Handler만 Supabase와 AWS를 호출하며 브라우저는 DB/service-role/CloudFront private key에 직접 접근하지 않습니다. 첫 요청에서 256-bit random token을 HttpOnly cookie로 발급하고 DB에는 SHA-256 hash만 저장합니다.

`POST /api/jobs`는 URL과 권리 확인, YouTube metadata/60분 제한, idempotency, 세션 동시/일일 제한, plan enforcement를 검사합니다. `video_jobs`와 `usage_reservations`를 만든 뒤 AWS Batch에는 job UUID만 전달합니다. 상태 API는 실제 DB stage, 완료된 shorts, 최신 usage를 한 응답에 포함합니다.

## Data plane

`worker/`는 HTTP 서버가 아닌 `python -m shorts_worker initial|rerender` CLI입니다. Initial task는 공개 YouTube 원본을 task `/tmp`에만 받고, 자막/음성 인식, 하이라이트 선택, 1080×1080 clean clip, 1080×1920 output/thumbnail을 생성합니다. 업로드마다 S3 HEAD 검증 후 DB에 결과를 공개합니다. 모든 종료 경로에서 temp tree를 지웁니다.

Rerender는 private clean clip만 받아 편집된 overlay를 적용합니다. 새 version key 업로드 → DB transaction으로 key/version 교체 → 이전 object 삭제 순서여서 실패 시 기존 output이 유지됩니다.

## Object delivery

S3는 public access block과 OAC만 허용합니다. CloudFront viewer-request Function은 `/outputs/` 외 URI를 403으로 막고 key group Signed URL을 요구합니다. `edit-sources/`는 worker IAM만 읽을 수 있습니다. Signed URL은 15분과 DB `expires_at` 중 이른 시각까지만 유효합니다.

## Recovery

Worker는 stage 변경 때와 60초 heartbeat만 기록합니다. Batch FAILED EventBridge Lambda가 reservation/rerender 상태를 복구하고, hourly Lambda는 만료 objects와 2시간 stale job을 정리합니다. S3 30일 lifecycle은 최종 안전장치입니다.
