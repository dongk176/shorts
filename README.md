# Shorts Maker

유튜브 링크와 템플릿 하나를 선택하면 영상의 핵심 구간을 찾아 1~5개의
1080×1920 MP4 쇼츠를 만드는 로컬 실행형 MVP입니다. 프론트엔드는 Next.js
App Router, API와 작업 실행기는 FastAPI, 작업 상태는 SQLite에 저장합니다.

회원가입, 로그인, 결제, 대시보드, 파일 직접 업로드는 포함하지 않습니다.

## 화면 흐름

1. 공개 YouTube 영상 링크를 입력하고 `영상 확인`을 누릅니다.
2. 제목, 채널명, 썸네일, 길이를 확인합니다.
3. 영상 사용 권리를 확인하고 네 가지 9:16 템플릿 중 하나를 선택합니다.
4. `쇼츠 생성하기`를 누르면 화면이 2초마다 작업 상태를 갱신합니다.
5. 완료된 쇼츠를 브라우저에서 확인하고 MP4로 다운로드합니다.

지원하는 주소는 `youtube.com/watch?v=`, `youtu.be/`,
`youtube.com/shorts/` 형식입니다. 최대 길이는 60분입니다.

## 프로젝트 구조

```text
.
├── api/                 FastAPI, SQLite, yt-dlp, OpenAI/Gemini, Pillow, FFmpeg
│   ├── app/             API와 영상 처리 파이프라인
│   └── tests/           단위 테스트와 synthetic 렌더링 테스트
├── web/                 Next.js App Router 단일 페이지 UI
├── storage/             SQLite DB와 완성된 MP4(런타임 파일, Git 제외)
├── docker-compose.yml
├── Makefile
├── .env.example
└── AGENTS.md
```

API는 영상 수집 기능을 `IngestionProvider` 인터페이스 뒤에 두며, MVP에서는
`YtDlpIngestionProvider`를 사용합니다. 작업은 내부 background executor에서
실행되고 동시 실행 수는 기본 1개로 제한됩니다.

## 가장 빠른 실행: Docker

Docker Desktop과 Docker Compose가 필요합니다.

```bash
cp .env.example .env
docker compose up --build
```

- 웹: <http://localhost:3000>
- API 문서: <http://localhost:8000/docs>
- 상태 확인: <http://localhost:8000/health>

AI 하이라이트 선정을 쓰려면 `.env`의 `GEMINI_API_KEY`에 본인의 키를 넣습니다.
YouTube 자막이 없는 영상까지 음성 인식하려면 `OPENAI_API_KEY`도 설정합니다.
키가 없어도 앱은 시작되며 가능한 자막과 결정론적 구간 선택으로 파이프라인이
계속됩니다.

`make dev`도 같은 Docker 개발 환경을 시작합니다. 종료는 `Ctrl+C` 후
`docker compose down`을 사용합니다.

## 호스트에서 직접 실행

필요 조건:

- Python 3.11 이상
- Node.js 20 이상과 npm
- FFmpeg와 ffprobe
- yt-dlp가 접근할 수 있는 공개 YouTube 영상
- 한글 렌더링용 Noto Sans CJK 폰트

macOS에서는 FFmpeg와 Noto CJK를 패키지 관리자로 설치할 수 있습니다. 폰트
파일은 저장소에 포함하지 않습니다. Docker 이미지는 `ffmpeg`와
`fonts-noto-cjk`를 자동으로 설치합니다.

터미널 1:

```bash
cd api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
```

터미널 2:

```bash
cd web
npm install
npm run dev
```

호스트 실행에서는 기본 저장 위치가 루트의 `storage/`입니다. 다른 주소의
API를 사용할 때는 웹 빌드 전에 `NEXT_PUBLIC_API_BASE_URL`을 지정합니다.

## 환경변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `OPENAI_API_KEY` | 비어 있음 | 선택 사항. 자막이 없는 영상의 음성 인식을 활성화 |
| `OPENAI_TRANSCRIBE_MODEL` | `gpt-4o-transcribe` | 음성 인식 모델 |
| `GEMINI_API_KEY` | 비어 있음 | 선택 사항. 자막 기반 AI 하이라이트 선정을 활성화 |
| `GEMINI_TEXT_MODEL` | `gemini-2.5-flash-lite` | 구조화된 하이라이트를 반환할 Gemini 모델 |
| `GEMINI_OPENAI_BASE_URL` | Google OpenAI 호환 URL | Gemini의 OpenAI 호환 API 주소 |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | 브라우저가 호출하는 API 주소 |
| `WEB_PORT` | `3000` | Docker가 웹 서비스를 노출할 호스트 포트 |
| `API_PORT` | `8000` | Docker가 API를 노출할 호스트 포트 |
| `WEB_ORIGIN` | `http://localhost:3000` | CORS에서 허용할 웹 origin |
| `STORAGE_DIR` | `./storage` | 완성 MP4 저장 디렉터리 |
| `DATABASE_PATH` | `./storage/jobs.sqlite3` | SQLite 파일 위치 |
| `TEMP_ROOT` | `/tmp/shorts-maker` | 작업별 원본·중간 파일 임시 위치 |
| `MAX_CONCURRENT_JOBS` | `1` | 동시에 실행할 작업 수 |
| `YTDLP_TIMEOUT_SECONDS` | `300` | 메타데이터·다운로드 timeout |
| `AI_TIMEOUT_SECONDS` | `120` | OpenAI 및 Gemini 요청 timeout |
| `FFMPEG_TIMEOUT_SECONDS` | `300` | 클립 하나의 렌더링 timeout |

`TEMP_DIR`, `CORS_ORIGINS`, `DOWNLOAD_TIMEOUT_SECONDS` 이름도 각각의 로컬
별칭으로 사용할 수 있습니다. 기존 `OPENAI_TIMEOUT_SECONDS`도
`AI_TIMEOUT_SECONDS`의 별칭으로 계속 지원합니다. 실제 키를 저장소에 커밋하지
마세요. 기존 `OPENAI_TEXT_MODEL` 설정은 `GEMINI_TEXT_MODEL`로 옮겨야 합니다.

## 영상 처리 방식

- **yt-dlp**는 공개 영상 메타데이터, 최대 1080p 원본, 제공 자막을 가져옵니다.
  명령은 shell 없이 인자 배열로 실행하며 timeout을 둡니다.
- 자막은 한국어 수동, 한국어 자동, 영어 수동, 영어 자동 순으로 선택합니다.
  모두 없고 API 키가 있으면 오디오를 mono 16kHz AAC, 5분 단위로 나누어
  OpenAI 음성 인식 API를 호출합니다. 일부 자막이 실패해도 렌더링은 계속됩니다.
- **Gemini `gemini-2.5-flash-lite`**는 Google의 OpenAI 호환 API를 통해
  타임스탬프 자막을 받아 25~55초 구간과 원문에 충실한 한국어 후킹 제목을
  Pydantic 구조로 반환합니다. 응답 범위와 클립 간 겹침을 다시 검증합니다.
- Gemini 키가 없거나 AI 요청이 실패하면 영상 전체에 고르게 분산한 약 35초
  구간을 사용합니다. 영상 길이에 따라 4분 미만 1개, 4~10분 2개, 10~20분
  3개, 20~35분 4개, 35~60분 5개를 만듭니다.
- **Pillow**가 템플릿별 상단 제목과 하단 채널 패널을 PNG로 만듭니다.
- **FFmpeg**가 원본을 중앙 기준 1080×1080으로 scale/crop해 y=420에 배치하고,
  패널과 선택 자막을 합성합니다. H.264/AAC, 최대 30fps, yuv420p,
  `faststart` MP4로 출력합니다.

완료나 실패 뒤 원본과 중간 파일은 제거되고, 안전한 서버 생성 파일명의 최종
MP4만 `storage/`에 남습니다. 결과 파일 경로는 저장 루트 아래로 resolve해
path traversal을 차단합니다.

## 개발 명령

```bash
make dev      # 전체 서비스 빌드 및 실행
make test     # pytest, typecheck, lint, production build
make lint     # Python/TypeScript 정적 검사
make clean    # 컨테이너, 빌드 캐시와 로컬 runtime 결과 정리
```

호스트에서 개별 검증할 수도 있습니다.

```bash
cd api && .venv/bin/pytest -q && .venv/bin/ruff check .
cd web && npm run lint && npm run typecheck && npm run build
```

기본 pytest는 외부 YouTube 네트워크를 호출하지 않습니다. 렌더링 통합 테스트는
FFmpeg로 짧은 synthetic fixture를 만들고 실제 1080×1920 MP4를 렌더링한 뒤
ffprobe로 크기, H.264/AAC 코덱, 길이를 확인합니다.

## 주요 API

- `POST /api/analyze`: URL 검증 및 YouTube 메타데이터 확인
- `POST /api/jobs`: 권리 확인과 템플릿을 검증하고 작업 시작
- `GET /api/jobs/{job_id}`: 단계, 진행률, 결과 목록 확인
- `GET /files/{path}`: 저장 루트 아래의 완성 MP4 재생
- `GET /files/{path}?download=1`: MP4 첨부 다운로드

작업 단계는 `queued`, `downloading`, `transcribing`, `selecting`,
`rendering`, `completed`, `failed` 순서입니다. 서버 재시작으로 중단된 작업은
계속 멈춰 있지 않도록 실패 상태로 복구됩니다.

## 저작권과 YouTube 사용 주의사항

이 앱은 사용자가 소유하거나 명시적으로 사용 허가를 받은 공개 영상만을 위한
로컬 도구입니다. 비공개, 연령 제한, DRM, 로그인 필요 영상의 인증 우회,
쿠키 탈취, 다운로드 제한 우회는 구현하지 않습니다. 생성물을 배포하기 전에
영상·음원·출연자·상표·자막에 관한 권리와 적용 법률을 직접 확인해야 합니다.

yt-dlp adapter는 개발용 MVP 구성입니다. 실제 상용 서비스에서는 YouTube
서비스 약관과 저작권 정책을 검토하고, 승인된 수집/업로드 방식으로
`IngestionProvider`를 교체해야 합니다.

## 현재 MVP 한계

- 얼굴·화자 추적 없이 중앙 crop만 사용하므로 피사체가 가장자리에 있으면 잘릴
  수 있습니다.
- 자막 및 AI 구간 선택 품질은 원본 음질, 제공 자막, 선택 모델에 좌우됩니다.
- 렌더링 작업은 단일 프로세스의 제한된 background executor에서 실행됩니다.
  프로세스가 중단되면 진행 중 작업은 재개되지 않습니다.
- 작업 취소, 결과 자동 만료, 사용자별 저장 공간, 업로드, 편집 UI가 없습니다.
- yt-dlp 기반 수집은 YouTube 측 변경에 영향을 받을 수 있습니다.
- 로컬 도구이므로 인증과 분산 rate limit을 제공하지 않습니다.

## Production 전환 전에 필요한 작업

- 승인된 영상 수집 흐름과 법무/권리 확인 절차
- 인증, 사용자별 격리, 할당량과 rate limit, 악용 방지
- durable queue와 별도 worker, 재시도·취소·idempotency
- 객체 저장소와 CDN, 만료 정책, 악성 파일 검사
- 중앙 로그/메트릭/추적, 비밀 관리, 오류 알림
- 입력 URL SSRF 방어 재검토와 네트워크 egress 정책
- AI 품질 평가셋, 비용 한도, moderation과 prompt-injection 평가
- 다양한 원본 코덱·가변 프레임레이트·긴 영상에 대한 부하 테스트
