-- Old generation workers may finish capturing an extended timeline after an
-- editor request has already locked the clean-clip clock. Skip that capture;
-- its caller observes zero updated rows and deletes the unused uploaded object.
create or replace function shorts_mvp.freeze_editor_timeline_during_render()
returns trigger language plpgsql security invoker
set search_path = pg_catalog
as $$
begin
  if old.status = 'rerendering' and new.status = 'rerendering'
     and old.edit_timeline_s3_key is null
     and new.edit_timeline_s3_key is not null then
    return null;
  end if;
  return new;
end;
$$;
revoke all on function shorts_mvp.freeze_editor_timeline_during_render() from public;
create trigger generated_shorts_freeze_editor_timeline
before update of edit_timeline_s3_key on shorts_mvp.generated_shorts
for each row execute function shorts_mvp.freeze_editor_timeline_during_render();
