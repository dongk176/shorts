# Shorts Maker MVP

공개 YouTube 영상의 오디오를 전사하고 내용을 분석해 최대 15개의 세로 쇼츠를 만드는 배포형 MVP입니다. 웹/control plane은 Vercel의 Next.js, 운영 데이터는 기존 `ai talk`와 같은 Supabase 프로젝트의 `shorts_mvp` schema, 영상 처리는 AWS Batch, 파일은 private S3와 CloudFront Signed URL을 사용합니다. SQLite와 로컬 `storage/`는 운영 경로에서 사용하지 않습니다.

## 구조

```text
Browser
  └─ Vercel / Next.js Route Handlers
       ├─ Supabase PostgreSQL + transactional Outbox
       ├─ SQS Dispatcher → AWS Batch Array Job
       └─ CloudFront Signed URL
AWS Batch Prepare Fargate
  ├─ YouTube 원본을 /tmp에만 다운로드
  ├─ OpenAI 전체 오디오 전사 → Gemini/OpenAI/fallback 구간 선택
  ├─ clean clip 업로드
  └─ 전체 원본과 중간 파일 즉시 삭제
AWS Batch Render EC2 Spot / On-Demand
  ├─ clean clip을 최대 4개씩 처리
  └─ worker당 FFmpeg 최대 2개 병렬 실행
EventBridge + Lambda
  ├─ 60초 Prepare/Render 재시도와 상태 반영
  └─ 입력 길이 기반 deadline·만료 파일·stale 작업 정리
```

상세 설계는 [architecture](docs/architecture.md), [Supabase schema](docs/supabase-schema.md), [AWS runbook](docs/aws-runbook.md)을 참고하세요.

## 제품 동작

- 더페이원 자동결제로 Plus 100분, Standard 200분, Pro 600분 플랜을 제공하며 활성 구독과 처리시간 grant를 서버에서 강제합니다.
- 사용량은 생성된 쇼츠 길이가 아니라 **처리한 원본 영상 전체 길이의 내림 초 단위**입니다. 제출 즉시 reserved, 렌더 성공률 50% 이상이면 consumed, 50% 미만 또는 시스템 실패면 released가 됩니다. 텍스트/템플릿 재렌더링은 0초입니다.
- 쇼츠 길이는 AI가 내용 흐름에 맞춰 30~60초 사이에서 각각 결정합니다.
- 4분 미만 3개, 4~10분 5개, 10~20분 8개, 20~30분 10개, 30~45분 12개, 45~60분 15개를 목표로 합니다.
- 결과 카드에는 후킹 제목, 영상, 구간 텍스트, 공유·다운로드·편집·삭제가 표시됩니다. 편집기에서 제목, 채널명, 자막 문구/표시 여부, 템플릿을 바꾸고 clean clip만 재렌더링합니다.
- 전체 원본은 Fargate 임시 디스크에만 존재합니다. clean clip·최종 MP4·thumbnail은 최초 생성 기준 최대 30일이며 재편집으로 연장되지 않습니다. 자세한 내용은 [data retention](docs/data-retention.md)에 있습니다.

## 로컬 실행

필요 조건은 Node.js 20+, Python 3.11+, FFmpeg/ffprobe, Noto Sans CJK입니다. Docker Desktop은 필요하지 않습니다.

```bash
cp .env.example .env.local
cd web && npm install && cd ..
cd worker && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt && cd ..
npm run dev
```

브라우저는 <http://localhost:3000>에서 엽니다. 로컬에서 AWS를 아직 만들지 않았다면 `.env.local`의 `AWS_BATCH_MOCK=true`로 control plane UI를 확인할 수 있지만 실제 영상은 생성되지 않습니다. 실제 생성은 AWS Batch 설정을 사용해야 합니다.

Worker의 YouTube JavaScript 실행 환경은 `yt-dlp==2026.7.4`, `yt-dlp-ejs==0.8.0`, Deno `2.8.3` 조합으로 고정합니다. 호환성 문제를 피하려면 세 버전을 함께 검토하고 갱신해야 합니다. EJS는 일반적인 YouTube player JavaScript 처리를 지원하지만 봇 체크 회피나 다운로드 성공을 보장하지 않으며, 원격 EJS 컴포넌트·계정 쿠키·PO Token은 사용하지 않습니다.

## Supabase migration

`.env.local`에 기존 Supabase의 direct `DATABASE_URL`을 넣고 실행합니다.

```bash
npm run db:migrate
```

스크립트는 migration 전후 `public` schema 객체 목록을 비교하고, Free/Plus/Standard/Pro 가격·처리시간·동시 작업·보관기간 seed까지 확인합니다. SQL은 [migrations](supabase/migrations)에 있으며 모든 객체는 schema-qualified 되어 있습니다.

## AWS provisioning

AWS CLI 인증과 제한된 Vercel team/project 값을 준비한 뒤 실행합니다.

```bash
export AWS_REGION=ap-northeast-2
export VERCEL_TEAM_SLUG=your-team-slug
export VERCEL_PROJECT_NAME=your-vercel-project
npm run infra:setup
```

이 명령은 CloudFront RSA key를 `.secrets/`에 생성하고, CDK bootstrap/deploy, runtime secret, Vercel production env 동기화를 수행합니다. `.secrets/`와 `.env.local`은 Git에서 제외됩니다. Worker는 GitHub Actions OIDC로 다운로드 전용 `SHA-prepare` 이미지와 렌더 전용 `SHA` 이미지를 `linux/amd64`로 ECR에 게시하므로 로컬 Docker가 필요하지 않습니다. Job Definition은 `latest`가 아니라 커밋 SHA 이미지에 고정됩니다. 기존 환경을 갱신할 때는 변경을 커밋하고 GitHub Actions 이미지 게시가 끝난 뒤 실행해야 하며, 두 이미지 중 하나라도 없으면 배포 스크립트가 중단됩니다.

## Vercel OIDC

장기 `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`를 Vercel에 저장하지 않습니다. CDK가 다음 production subject로 제한된 역할을 만듭니다.

```text
owner:<team>:project:<project>:environment:production
```

Vercel에는 `AWS_ROLE_ARN`, region, S3 bucket, Dispatcher ARN, CloudFront signing 설정만 저장합니다. 신규 생성과 재렌더 접수는 DB Outbox에 기록하며, 신규 생성 직후 Lambda Dispatcher를 비동기로 깨워 SQS와 AWS Batch로 전달합니다. 1분 주기 Dispatcher는 즉시 호출 실패 시의 복구 경로로 유지합니다. 서버 코드는 AWS 요청이 필요할 때만 요청 컨텍스트의 Vercel OIDC token을 `sts.amazonaws.com` 전용 audience로 교환합니다.

## 환경변수

| 이름 | 위치 | 용도 |
| --- | --- | --- |
| `DATABASE_URL` | Vercel, worker | 기존 Supabase 직접 연결 |
| `YOUTUBE_API_KEY` | Vercel | 링크 metadata 검증 및 일일 인기 영상 수집 |
| `CRON_SECRET` | Vercel | 인기 영상 수집 및 구독 갱신 API 인증 |
| `THEPAYONE_BILLING_ENABLED` | Vercel | 웹훅·방화벽 검증 후에만 `true`로 전환 |
| `THEPAYONE_MID`, `THEPAYONE_TERMINAL_ID` | Vercel secret | 결과 통지의 가맹점·터미널 검증 |
| `THEPAYONE_PAY_KEY` | Vercel secret | 더페이원 서버 API 및 단건 결제창 키 |
| `THEPAYONE_WEBHOOK_BASE_URL`, `THEPAYONE_WEBHOOK_SECRET` | Vercel | 운영 HTTPS 통지 주소와 비밀 경로 |
| `THEPAYONE_CARD_TOKEN_ENCRYPTION_KEY` | Vercel secret | 저장 cardId AES-256-GCM 암호화 |
| `MVP_PLAN_ENFORCEMENT` | Vercel | 기본 `true`; `false`를 명시한 개발 환경에서만 유료 권한 강제를 해제 |
| `GEMINI_API_KEY` | worker | 1차 구조화 하이라이트 선정(없거나 실패하면 OpenAI fallback) |
| `OPENAI_API_KEY` | worker | 필수 전체 오디오 전사 및 Gemini 실패 시 하이라이트 선정 |
| `OPENAI_TRANSCRIBE_MODEL` | worker | 기본 `gpt-4o-mini-transcribe` |
| `OPENAI_HIGHLIGHT_FALLBACK_MODEL` | worker | 기본 `gpt-5-nano` |
| `OPENAI_COMMENT_FALLBACK_MODEL` | worker | 댓글 생성용 Gemini 실패 시 fallback, 기본 `gpt-5-nano` |
| `OPENAI_TRANSCRIBE_CHUNK_SECONDS` | worker | 전사 오디오 청크 길이, 기본 30초 |
| `OPENAI_TRANSCRIBE_MAX_WORKERS` | worker | 병렬 전사 호출 수, 기본 4 |
| `GEMINI_COMMENT_MODEL` | worker | 댓글 캡처 템플릿의 댓글 생성 모델, 기본 `gemini-2.5-flash-lite` |
| `AWS_ROLE_ARN`, `AWS_REGION` | Vercel | OIDC assume role |
| `AWS_S3_OUTPUT_BUCKET` | Vercel, worker | private media bucket |
| `AWS_OUTBOX_DISPATCHER_FUNCTION_ARN` | Vercel | 작업 생성 직후 Outbox Dispatcher 즉시 호출 |
| `WORK_DISPATCH_QUEUE_URL` | worker/Lambda | Prepare·Render 작업 전달 SQS |
| `STATE_EVENT_QUEUE_URL` | worker/Lambda | 진행률·heartbeat 일괄 반영 SQS |
| `CLOUDFRONT_DOMAIN` | Vercel | output CDN |
| `CLOUDFRONT_KEY_PAIR_ID` | Vercel | Signed URL public-key id |
| `CLOUDFRONT_PRIVATE_KEY_B64` | Vercel secret | Signed URL private key |

Supabase REST를 쓰는 cleanup Lambda에는 AWS Secrets Manager를 통해 `SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`가 필요합니다. 이 값은 브라우저에 노출되지 않습니다.

## 검증

```bash
npm run verify
# 또는
make verify
```

프론트 lint/typecheck/unit test/production build, Worker ruff/pytest/실제 FFmpeg synthetic 1080×1920 렌더, CDK assertion/synth를 실행합니다. 외부 API와 AWS는 기본 테스트에서 호출하지 않습니다.

## 비용 통제 및 장애 대응

- 원본 최대 60분, 다운로드 최대 1080p, 출력 최대 30fps, 최대 15개
- Prepare는 Fargate On-Demand, Render는 EC2 Spot 우선·On-Demand fallback, 유휴 EC2 `minvCpus=0`
- 플랜별 동시 작업 1~3개, Outbox/SQS idempotency, 입력 길이별 31~90분 deadline
- BOT_CHECK/429는 사용자에게 숨기고 60초 후 최대 10회 재시도하며, 최근 50회 중 20% 이상이면 1분 회로 차단
- S3 versioning 없음, incomplete multipart 1일, media 30일 lifecycle
- ECR 최근 8개, CloudWatch 14일
- Worker heartbeat 60초, Batch 실패 이벤트와 2시간 stale cleanup
- 기존 영상은 새 rerender가 S3 업로드 및 DB transaction에 성공하기 전까지 유지

장애 조사와 수동 복구는 [AWS runbook](docs/aws-runbook.md)을 따릅니다.

## 결제 및 사용량

활성 `user_subscriptions`와 결제 승인으로 생성된 `usage_grants`가 권한의 source of truth입니다. 월간 구독은 더페이원이 자동 승인하고 검증된 결과 통지가 기간을 연장합니다. 플랜 변경·연간 갱신·애드온은 암호화해 저장한 `cardId`와 연락처를 재사용하고, 매 승인 시에만 카드 인증값을 받아 처리합니다. 애드온은 승인 후 90일 grant로 적립됩니다. 자세한 기준은 [MVP billing](docs/mvp-billing.md)에 있습니다.

## 저작권 및 한계

지원되는 공개 영상만 처리하며, 사용자는 콘텐츠를 적법하게 사용할 책임이 있습니다. 콘텐츠 권리와 YouTube의
플랫폼 정책은 별개이므로 유료 상용화 전 법무 검토가 필요합니다. 운영 기준과 네트워크 경로는
[YouTube ingestion risk policy](docs/youtube-compliance.md)를 따릅니다.

Worker의 활성 YouTube 수집 경로는 AWS Secrets Manager에 보관한 Dedicated ISP proxy 10개입니다.
Dispatcher가 IP별 다운로드 슬롯을 하나씩 예약하므로 동시에 최대 10개만 다운로드하고, 나머지
작업은 Outbox에서 기다립니다. 연결 오류, BOT_CHECK, HTTP 429는 승인된 다른 ISP 경로로 최대
10회 재시도할 수 있습니다. 로그인·연령·유료·지역·비공개·DRM 제한은 경로를 바꾸지 않고 즉시
종료합니다. WARP 설정은 안정화 기간의 수동 롤백 용도로만 보관하며 활성 작업에는 주입하지 않습니다.

원본 전체는 S3에 저장하지 않으며 작업 중 임시 디스크에만 존재하고 `finally`에서 삭제됩니다.
얼굴/화자 추적 없이 중앙 crop하며 AI 품질은 원본 음질과 전사 품질에 좌우됩니다.

### Mac pull worker

초기 작업을 집 Mac의 공인 IP로 처리하려면 웹 런타임에
`VIDEO_JOB_BACKEND=mac_pull`을 설정합니다. 이 모드에서 웹은 AWS Batch를 제출하지 않고
Supabase queue에 작업만 저장합니다. 각 Mac은 아래 명령으로 queue를 polling합니다.

```bash
./scripts/run-mac-worker.sh
```

두 Mac이 같은 공유기를 사용해도 PostgreSQL advisory lock 때문에 YouTube 다운로드는 한 번에
하나만 실행됩니다. 다운로드가 끝나 lock이 해제되면 각 Mac은 AI 분석과 FFmpeg 렌더링을
병렬로 계속 수행할 수 있습니다. 원본은 컨테이너 임시 디스크에서 작업 종료 시 삭제되고,
완성 결과와 편집용 짧은 클립만 기존 private S3에 업로드됩니다. runner는 작업마다 AWS CLI의
단기 자격증명을 새로 받아 Docker에 전달하므로 장기 access key를 저장하지 않습니다. 각 Mac에는
Docker Desktop, 유효한 `aws login`, 동일한 `.env.local`이 필요합니다.
