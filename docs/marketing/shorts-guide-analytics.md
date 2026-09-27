# 쇼츠 가이드 설문 수집

## 적용 상태

- 작업본: `codex/shorts-monetization-production-20260927`, 기준 커밋 `add473bedd3b34140b204199e148e7eac3cafbc6`에 더한 로컬 변경.
- 2026-09-27 운영 DB 마이그레이션 및 배포 완료. 최종 소스 `90481f61`, 배포 `dpl_AtsX5PPGp7CPNWnUuLjvM35ehjcV`. 운영 주소의 API→DB 저장과 재전송 중복 방지를 검증했다. 3018 개발 서버는 여전히 DB 환경 변수가 없는 별도 구성이다.
- `202609270010_shorts_guide_analytics.sql`을 적용한 DB와 웹 코드가 함께 있어야 실제 수집된다. 운영 적용 시 실행 경계와 기존 배포 절차를 따른다. 이 마이그레이션은 운영용 `shorts_mvp`이며 lab에 그대로 적용하지 않는다.
- API와 실제 격리 PostgreSQL 엔진(PGlite)을 연결해 저장, 재전송 중복, 순서 역전, 권한 차단을 검증한다. 운영 연결 또는 운영 배포 검증을 대신하지 않는다.

## 수집 기준

`shorts_mvp.shorts_guide_events`에 시작, 질문 노출, 선택/변경, 완료, 명시적 나가기, 실행북 미리보기, 요금제 클릭, 결과 행동을 기록한다. `shorts_guide_survey_summary` 뷰는 설문별 최종 답변과 마지막 질문을 제공한다.

- 익명 UUID는 사람이 아닌 **탭의 설문 시도**를 구분한다. 새로고침은 유지하고 다시 시작은 새 ID를 만든다. 새 탭, 브라우저 저장소 삭제 등으로 달라지므로 고유 방문자 수로 해석하지 않는다.
- 선택 이벤트는 라디오 선택 값이 바뀔 때 발생한다. 이미 선택한 항목을 다시 누른 물리적 클릭은 세지 않는다. 답변 변경 횟수와 최종 선택 분포를 구분한다.
- 이벤트 UUID와 설문 내 순번으로 재전송을 중복 제거한다. 시작은 시도당 한 번만 저장한다. 완료 후 수정한 경우 최신 완료 스냅샷을 사용한다.
- 언어는 `ko/en/ja`, 실행 환경은 `production/preview/development`로 분리한다. 서버가 환경을 결정한다. 답변 코드는 언어에 상관없이 동일하다.
- 이름, 이메일, 계정 ID, IP, 자유 입력은 분석 테이블에 저장하지 않는다. 서버의 순간 요청 제한에만 IP를 메모리에서 최대 1분 사용한다.
- 전송 대기는 sessionStorage에 최대 60개, 마지막 저장 후 24시간 이내로 보관한다. 탭 종료 시 유실될 수 있다. 기존 설문 답변 복원용 localStorage의 30일 보관과 별개다.
- API 실패는 설문을 막지 않는다. 짧게 묶어 전송하고 실패 시 한 번 재시도한 뒤 다음 상호작용/재방문 때 재전송한다. 수집은 최선형이며 차단 도구, 네트워크, 탭 종료에 따른 누락이 있을 수 있다.
- 미완료 및 30분 이상 미활동은 **추정 이탈**이다. 실제 이탈 선언이 아니며 다시 돌아올 수 있다. 시간은 서버 수신 시각이므로 지연 전송 시 실제 행동 시각과 차이가 난다.
- 요금제 클릭은 결제가 아니다. 실제 구매 전환 추적이나 관리자 통계 화면은 이번 범위에 포함하지 않았다.

## 읽기 전용 집계 예시

서버 DB 또는 승인된 SQL 도구에서 실행한다. 브라우저의 anon/authenticated 역할은 테이블과 뷰에 접근할 수 없다. 아래 예시는 운영 환경만 집계한다.

### 최근 30일 시작 및 완료율

```sql
select locale, count(*) as started,
  count(completed_at) as completed,
  round(100.0 * count(completed_at) / nullif(count(*), 0), 1) as completion_pct
from shorts_mvp.shorts_guide_survey_summary
where environment = 'production' and started_at >= now() - interval '30 days'
group by locale;
```

### 항목 선택/변경 횟수

```sql
select locale, question, answer, count(*) as selections,
  count(distinct survey_id) as attempts
from shorts_mvp.shorts_guide_events
where environment = 'production' and event_name = 'answer_selected'
  and received_at >= now() - interval '30 days'
group by locale, question, answer
order by question, selections desc;
```

### 완료 설문의 최종 선택 분포

```sql
select s.locale, a.key as question, a.value as answer, count(*) as attempts
from shorts_mvp.shorts_guide_survey_summary s
cross join lateral jsonb_each_text(s.completed_answers) a
where s.environment = 'production'
  and s.started_at >= now() - interval '30 days'
  and s.completed_at is not null
group by s.locale, a.key, a.value
order by question, attempts desc;
```

### 추정 이탈 질문

```sql
select locale, last_question, count(*) as inactive_incomplete_attempts
from shorts_mvp.shorts_guide_survey_summary
where environment = 'production' and completed_at is null
  and started_at >= now() - interval '30 days'
  and last_activity_at < now() - interval '30 minutes'
group by locale, last_question;
```

### 실행북 및 요금제 관심

```sql
select locale, event_name, guide, action, count(*) as events,
  count(distinct survey_id) as attempts
from shorts_mvp.shorts_guide_events
where environment = 'production'
  and event_name in ('guide_preview', 'pricing_clicked', 'result_action')
  and received_at >= now() - interval '30 days'
group by locale, event_name, guide, action;
```

## 운용

테이블은 자동 삭제하지 않는다. 보존 기간 및 정리 작업은 운영 데이터 정책에 맞춰 별도로 정한다. 공개 API는 본문 크기, 허용된 이벤트/답변, 동일 출처, 배치 크기와 인스턴스 단위 순간 요청 수를 제한한다. 이 제한은 전체 배포에 걸친 분산 속도 제한은 아니다.

마이그레이션 적용 전에는 API가 503을 반환한다. 웹 배포 전 마이그레이션을 적용하고, 승인된 운영 검증에서 한 시도의 이벤트 저장과 중복 제거를 확인한 다음 운영 수집 시작을 알린다. 개발 테스트 데이터는 운영 통계에 포함하지 않는다.
