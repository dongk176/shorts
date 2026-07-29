begin;

create or replace function shorts_mvp.apply_transcription_failure_message()
returns trigger
language plpgsql
set search_path = shorts_mvp, pg_temp
as $$
begin
  if new.status='failed' and new.error_code='TranscriptionError' then
    new.error_message :=
      E'영상에서 사람의 목소리를 찾지 못해 쇼츠를 생성할 수 없습니다.\n'
      '사용량은 다시 복구되었습니다.';
  end if;
  return new;
end;
$$;

drop trigger if exists video_jobs_transcription_failure_message
  on shorts_mvp.video_jobs;
create trigger video_jobs_transcription_failure_message
before insert or update of status,error_code,error_message
on shorts_mvp.video_jobs
for each row execute function shorts_mvp.apply_transcription_failure_message();

update shorts_mvp.video_jobs
set error_message =
  E'영상에서 사람의 목소리를 찾지 못해 쇼츠를 생성할 수 없습니다.\n'
  '사용량은 다시 복구되었습니다.'
where status='failed' and error_code='TranscriptionError';

commit;
