begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
-- Control-only renewal never sets the admission-blocking infrastructure lease.
-- Both locks share the singleton row, making mutual exclusion atomic even for
-- an older infrastructure controller that does not know about this new lease.
alter table shorts_mvp.editor_release_state
  add column control_renewal_lease_id uuid,
  add column control_renewal_lease_owner text,
  add column control_renewal_lease_expires_at timestamptz,
  add constraint editor_control_renewal_lease_identity check (
    (control_renewal_lease_id is null and control_renewal_lease_owner is null and control_renewal_lease_expires_at is null)
    or (control_renewal_lease_id is not null and control_renewal_lease_owner is not null and control_renewal_lease_owner ~ '^stage-b:renewal:[0-9a-f]{40}$' and control_renewal_lease_expires_at is not null)
  );
create function shorts_mvp.guard_editor_control_renewal() returns trigger
language plpgsql set search_path=shorts_mvp,pg_temp as $$
begin
  if new.control_renewal_lease_id is not null and new.control_renewal_lease_expires_at>clock_timestamp() then
    if (new.render_v4_infra_lease_id is not null and new.render_v4_infra_lease_expires_at>clock_timestamp())
      or (new.render_v4_target_successor is not null and new.render_v4_target_successor->>'phase' is distinct from 'active') then
      raise exception 'CONTROL_RENEWAL_CONFLICTING_INFRASTRUCTURE_CHANGE' using errcode='55000';
    end if;
    -- Preserve operational routing during renewal, while allowing kill switches
    -- to be used independently for incident response.
    if new.stable_release_id is distinct from old.stable_release_id then
      raise exception 'CONTROL_RENEWAL_STABLE_POINTER_CHANGE' using errcode='55000';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function shorts_mvp.guard_editor_control_renewal() from public,anon,authenticated;
create trigger guard_editor_control_renewal before update on shorts_mvp.editor_release_state
for each row execute function shorts_mvp.guard_editor_control_renewal();
commit;
