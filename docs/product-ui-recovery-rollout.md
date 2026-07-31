# 제품 UI 복구 배포

이 배포는 사이트 UI와 편집기 공개를 분리한다. 사이트 사이드바,
푸터, 온보딩 v2는 일반 사용자에게 공개하지만 편집기는 운영의
레거시 경로를 유지한다.

## 배포 전 불변 조건

- 작업 트리는 커밋된 상태여야 하며 Vercel 배포 메타데이터의
  `gitDirty`가 `0`이어야 한다.
- 다음 환경변수는 비활성 상태를 유지한다.
  - `EDITOR_OVERLAY_PREVIEW_ENABLED`
  - `EDITOR_RENDERING_V2_ENABLED`
  - `EDITOR_RENDERING_V2_GLOBAL_ENABLED`
  - `EDITOR_RENDERING_V2_TEST_USER_IDS`
- `shorts_mvp.runtime_feature_flags.editor_rendering_v2`,
  `editor_release_state.public_enabled`,
  `editor_release_state.canary_enabled`는 모두 `false`여야 한다.
- `sidebar_navigation_v1` 캠페인은 웹 승격이 끝날 때까지
  `enabled=false`로 유지한다.

## 마이그레이션

다음 추가형 마이그레이션만 파일명을 지정해 순서대로 적용한다.

1. `202607300006_job_completion_email_notifications.sql`
2. `202607300007_user_completion_email_preferences.sql`
3. `202607300008_marketing_email_preferences.sql`
4. `202607300009_email_preference_prompt_snoozes.sql`
5. `202607300010_notification_email_overrides.sql`
6. `202607300011_onboarding_discovery_source.sql`
7. `202607310001_ai_comment_regeneration_usage.sql`
8. `202607310002_editor_document_v2.sql`
9. `202607310003_editor_release_channels.sql`
10. `202607310004_sidebar_navigation_announcement.sql`

적용 직후 신규 편집기의 세 DB 게이트와 사이드바 캠페인이 모두
꺼져 있는지 다시 조회한다. 추가된 테이블과 컬럼은 롤백 때 삭제하지
않는다.

## Preview와 승격

1. `make verify`를 통과한 커밋으로 보호된 Preview를 만든다.
2. Preview에서 데스크톱 홈·프로젝트·템플릿·요금제·설정·실시간 인기,
   모바일 상단 헤더, 푸터를 확인한다.
3. 일반 계정의 편집 페이지가 레거시 DOM과 저장 요청을 사용하는지
   확인한다.
4. 같은 Preview 배포를 재빌드 없이 Production으로 승격한다.
5. 홈, 푸터, 기존 회원, 레거시 편집기 순서로 즉시 점검한다.
6. 이상이 없을 때만 아래 한 행을 갱신해 기존 회원 안내를 시작한다.

```sql
update shorts_mvp.member_ui_announcement_campaigns
set enabled=true
where campaign_code='sidebar_navigation_v1'
  and enabled=false;
```

안내 중단은 같은 행을 `enabled=false`로 바꾼다. 이미 claim된 계정의
receipt는 삭제하지 않는다.

## 롤백

1. 사이드바 캠페인과 편집기 canary를 먼저 끈다.
2. Vercel Production 별칭을 직전 정상 배포로 되돌린다.
3. 신규 요청이 레거시 워커로 들어가는지 확인한다.
4. 추가형 마이그레이션과 안내 receipt, 편집기 감사 데이터는 유지한다.
