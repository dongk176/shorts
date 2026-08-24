begin;

create or replace function shorts_mvp.apply_restricted_content_failure_message()
returns trigger
language plpgsql
set search_path = shorts_mvp, pg_temp
as $$
declare
  detected_error_code text;
begin
  if new.status='failed' then
    detected_error_code := case
      when new.error_code in ('youtube_members_only','youtube_paid_content')
        then new.error_code
      when exists (
        select 1 from shorts_mvp.project_output_attempts
        where job_id=new.id
          and failure_message like '%채널 멤버십 전용 영상은 지원하지 않습니다.%'
      ) then 'youtube_members_only'
      when exists (
        select 1 from shorts_mvp.project_output_attempts
        where job_id=new.id
          and failure_message like '%유료 영상은 지원하지 않습니다.%'
      ) then 'youtube_paid_content'
      else null
    end;
  end if;

  if detected_error_code is not null then
    new.error_code := detected_error_code;
    new.error_message :=
      E'멤버십 전용 여부, 구매·대여 콘텐츠는 사용할 수 없습니다.\n'
      '사용량은 다시 복구되었습니다. 영상 확인 후 다시 시도해주세요.';
  end if;
  return new;
end;
$$;

commit;
