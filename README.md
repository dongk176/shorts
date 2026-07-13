# Shorts Maker MVP

공개 YouTube 영상의 자막과 내용을 분석해 1~5개의 세로 쇼츠를 만드는 배포형 MVP입니다. 웹/control plane은 Vercel의 Next.js, 운영 데이터는 기존 `ai talk`와 같은 Supabase 프로젝트의 `shorts_mvp` schema, 영상 처리는 AWS Batch Fargate, 파일은 private S3와 CloudFront Signed URL을 사용합니다. SQLite와 로컬 `storage/`는 운영 경로에서 사용하지 않습니다.

## 구조

```text
Browser
  └─ Vercel / Next.js Route Handlers
       ├─ Supabase PostgreSQL (shorts_mvp only)
       ├─ AWS Batch SubmitJob (Vercel OIDC)
       └─ CloudFront Signed URL
AWS Batch Fargate worker
  ├─ YouTube 원본을 /tmp에만 다운로드
  ├─ 자막 → AI/fallback 구간 선택 → clean clip → 최종 MP4
  ├─ private S3에 clean clip, output, thumbnail 업로드
  └─ 전체 원본과 중간 파일 즉시 삭제
EventBridge + Lambda
  ├─ Batch 최종 실패 및 reservation 복구
  └─ 만료 파일·stale 작업 매시간 정리
```

상세 설계는 [architecture](docs/architecture.md), [Supabase schema](docs/supabase-schema.md), [AWS runbook](docs/aws-runbook.md)을 참고하세요.

## 제품 동작

- 플랜은 Plus 100분, Standard 300분, Pro 600분이며 MVP에서는 결제 없이 브라우저별로 선택합니다. `app_users`와 `user_subscriptions`는 향후용이고 현재 로직에는 연결하지 않습니다.
- 사용량은 생성된 쇼츠 길이가 아니라 **처리한 원본 영상 전체 길이**입니다. 제출 즉시 reserved, 성공 시 consumed, 시스템 실패 시 released가 됩니다. 텍스트/템플릿 재렌더링은 0초입니다.
- 쇼츠 길이는 AI가 내용 흐름에 맞춰 30~60초 사이에서 각각 결정합니다.
- 4분 미만 1개, 4~10분 2개, 10~20분 3개, 20~35분 4개, 35~60분 5개를 목표로 합니다.
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

## Supabase migration

`.env.local`에 기존 Supabase의 direct `DATABASE_URL`을 넣고 실행합니다.

```bash
npm run db:migrate
```

스크립트는 migration 전후 `public` schema 객체 목록을 비교하고, Plus/Standard/Pro seed까지 확인합니다. SQL은 [migration](supabase/migrations/202607120001_shorts_mvp.sql)에 있으며 모든 객체는 schema-qualified 되어 있습니다.

## AWS provisioning

AWS CLI 인증과 제한된 Vercel team/project 값을 준비한 뒤 실행합니다.

```bash
export AWS_REGION=ap-northeast-2
export VERCEL_TEAM_SLUG=your-team-slug
export VERCEL_PROJECT_NAME=your-vercel-project
npm run infra:setup
```

이 명령은 CloudFront RSA key를 `.secrets/`에 생성하고, CDK bootstrap/deploy, runtime secret, Vercel production env 동기화를 수행합니다. `.secrets/`와 `.env.local`은 Git에서 제외됩니다. Worker는 GitHub Actions OIDC로 `linux/amd64` 이미지를 ECR에 게시하므로 로컬 Docker가 필요하지 않습니다. 최초 배포 후 GitHub Actions 변수 `AWS_WORKER_BUILD_ROLE_ARN`, `AWS_ECR_REPOSITORY_URI`를 CDK 출력값으로 설정하세요.

## Vercel OIDC

장기 `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`를 Vercel에 저장하지 않습니다. CDK가 다음 production subject로 제한된 역할을 만듭니다.

```text
owner:<team>:project:<project>:environment:production
```

Vercel에는 `AWS_ROLE_ARN`, region, S3 bucket, CloudFront signing 설정만 저장합니다. 신규 생성과 재렌더 접수는 DB Outbox에만 기록하며, Lambda Dispatcher가 SQS와 AWS Batch로 전달합니다. 서버 코드는 미디어 조회·삭제에 필요할 때만 요청 컨텍스트의 Vercel OIDC token을 `sts.amazonaws.com` 전용 audience로 교환합니다.

## 환경변수

| 이름 | 위치 | 용도 |
| --- | --- | --- |
| `DATABASE_URL` | Vercel, worker | 기존 Supabase 직접 연결 |
| `YOUTUBE_API_KEY` | Vercel | 링크 metadata 및 60분 제한 검증 |
| `GEMINI_API_KEY` | worker | 구조화된 하이라이트 선정(없으면 deterministic fallback) |
| `OPENAI_API_KEY` | worker | 자막이 없을 때만 음성 인식 |
| `AWS_ROLE_ARN`, `AWS_REGION` | Vercel | OIDC assume role |
| `AWS_S3_OUTPUT_BUCKET` | Vercel, worker | private media bucket |
| `WORK_DISPATCH_QUEUE_URL` | worker/Lambda | Prepare·Render 작업 전달 SQS |
| `STATE_EVENT_QUEUE_URL` | worker/Lambda | 진행률·heartbeat 일괄 반영 SQS |
| `BOT_CHECK_COOLDOWN_SECONDS` | worker | BOT_CHECK 이후 공유 회로 차단 시간(기본 60초) |
| `CLOUDFRONT_DOMAIN` | Vercel | output CDN |
| `CLOUDFRONT_KEY_PAIR_ID` | Vercel | Signed URL public-key id |
| `CLOUDFRONT_PRIVATE_KEY_B64` | Vercel secret | Signed URL private key |
| `MVP_PLAN_ENFORCEMENT` | Vercel | 기본 `false`; plan 한도 차단 여부 |
| `MVP_MAX_ACTIVE_JOBS_PER_SESSION` | Vercel | 기본 1 |

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
- 세션 동시 작업 1개, Outbox/SQS idempotency, 작업별 15분 deadline
- BOT_CHECK/429는 사용자에게 숨기고 60초 후 최대 10회 재시도하며, 최근 50회 중 20% 이상이면 1분 회로 차단
- S3 versioning 없음, incomplete multipart 1일, media 30일 lifecycle
- ECR 최근 8개, CloudWatch 14일
- Worker heartbeat 60초, Batch 실패 이벤트와 2시간 stale cleanup
- 기존 영상은 새 rerender가 S3 업로드 및 DB transaction에 성공하기 전까지 유지

장애 조사와 수동 복구는 [AWS runbook](docs/aws-runbook.md)을 따릅니다.

## 결제 도입 시

현재 플랜 선택은 `mvp_sessions.selected_plan_code`만 변경합니다. 실제 결제를 붙일 때는 인증된 `app_users`, webhook으로 관리되는 `user_subscriptions`, 결제 기간과 entitlement 검증을 source of truth로 전환하고 브라우저 MVP session 사용량을 사용자 계정으로 이전해야 합니다. 자세한 기준은 [MVP billing](docs/mvp-billing.md)에 있습니다.

## 저작권 및 한계

소유하거나 명시적으로 사용 허가를 받은 공개 영상만 처리해야 합니다. 비공개·연령 제한·DRM·로그인 필요 영상 우회나 브라우저 쿠키 사용은 구현하지 않습니다. yt-dlp 기반 수집은 YouTube 정책과 변경에 영향을 받으므로 상용 공개 전 법무·약관 검토가 필요합니다. 얼굴/화자 추적 없이 중앙 crop하며 AI 품질은 원본 자막과 음질에 좌우됩니다.

Worker는 영상·메타데이터를 한 번의 yt-dlp 프로세스로 수집하고, 자막을 별도로 요청하지
않고 오디오 전사 경로를 사용합니다. 여러 Batch 작업이
동시에 시작되어도 PostgreSQL advisory lock으로 YouTube 수집은 전역 1개만 실행합니다.
BOT_CHECK가 확인되면 해당 작업을 재시도하지 않고 공유 회로를 기본 30분간 차단하여 같은
AWS egress에서 연속 요청이 발생하지 않도록 합니다. 원본 전체는 S3에 저장하지 않으며 작업
중 임시 디스크에만 존재하고 `finally`에서 삭제됩니다.

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
