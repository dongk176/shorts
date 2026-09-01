# 운영 기준선 — 2026-09-01

이 기준선은 `www.easycut.co.kr`에 실제 승격된 Vercel 배포와 운영 DB·AWS의
비밀값 없는 실행 지문을 한 커밋으로 고정한다. 상세 값은 루트의
`production-baseline.json`을 단일 기준으로 사용한다.

## 확정 범위

- 운영 웹 소스는 `d0607ef5ba2dae4f8fd714a40c7d135455638ed6`이다.
- 내 배경·템플릿 고정 텍스트 호환 코드는 웹에 있으나 두 공개 플래그가 모두
  꺼져 있어 사용자 기능으로 활성화되지 않았다.
- 링크 생성 Worker는 소스 `4e19c114...`, 이미지 `sha256:99c0e66...`,
  Render/Caption Spec v4와 고정 폰트 지문을 사용한다.
- 파일 업로드 수신기는 소스 `da441c21...`, 이미지 `sha256:a21bc6b...`를
  사용하며 원본은 임시 저장공간만 사용한다.
- 운영 DB에 직접 반영돼 있던 성공률 우선 경로 선택과 일시적인 ingestion
  circuit 자동복구는 `202609010002_youtube_ingestion_circuit_auto_resume.sql`로
  복원했다. 함수 본문 해시는 실제 운영 DB와 동일하다.
- 프록시 주소·토큰·키는 기록하지 않고 Secrets Manager 버전 ID만 고정한다.

## 다음 변경의 출발 규칙

모바일 프로젝트 썸네일과 `ingestion_route_wait_exhausted` 개선은 이 기준선
태그에서 새 브랜치를 만들어 각각 작은 변경으로 검증한다. 기존 더러운
작업공간이나 미승격 후보를 기준으로 삼지 않는다. 새 기능을 함께 켜지 않으며,
커스텀 배경 공개는 별도 런타임 승인으로 남긴다.

후보 배포 전에는 `node scripts/verify-production-baseline.mjs`와 전체 검증을
통과시키고, 기존 운영 경로 manifest와 비교해 보호 경로 삭제 및 콘텐츠
캘린더·YouTube 게시 실험 포함 여부를 다시 검사한다.
