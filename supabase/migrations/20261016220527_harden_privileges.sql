-- Least privilege: anon gets nothing on the app's tables, view, or helpers,
-- and authenticated loses the table privileges Supabase's default
-- privileges add (TRUNCATE bypasses RLS) but the app never uses.
revoke all on public.programs, public.sessions, public.items, public.program_overview from anon;
revoke truncate, references, trigger, maintain on public.programs, public.sessions, public.items from authenticated;
revoke truncate, references, trigger, maintain on public.program_overview from authenticated;
revoke all on function private.is_developer(), private.share_matches(uuid, text),
  private.owns_program(uuid), private.owns_session(uuid), private.reviews_session(uuid) from anon;
revoke usage on schema private from anon;

-- Reviewers may only touch the session columns the app writes; program_id,
-- share_id, reviewer_uid, and mode are fixed at insert. Owners only resolve items.
revoke update on public.sessions from authenticated;
grant update (reviewer_name, last_seen_at, recording_enabled, recording_gap, gt_run_id)
  on public.sessions to authenticated;
revoke update on public.items from authenticated;
grant update (resolved_at) on public.items to authenticated;

-- program_id and share_id can no longer change, so the update policy does not
-- need share_matches (and a regenerated share no longer breaks heartbeats).
drop policy "reviewers update own sessions" on public.sessions;
create policy "reviewers update own sessions" on public.sessions for update to authenticated
  using (reviewer_uid = (select auth.uid()))
  with check (reviewer_uid = (select auth.uid()));

-- Storage folder names are client-supplied; parse the session id without a
-- cast error so non-uuid folders are simply denied (helpers return false on null).
create function private.folder_session(name text) returns uuid
language sql immutable set search_path = '' as $$
  select case
    when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(name))[1])::uuid
  end
$$;
revoke all on function private.folder_session(text) from public, anon;
grant execute on function private.folder_session(text) to authenticated;

drop policy "reviewers upload screenshots" on storage.objects;
drop policy "reviewers and owners read screenshots" on storage.objects;
drop policy "owners delete screenshots" on storage.objects;

create policy "reviewers upload screenshots" on storage.objects for insert to authenticated
  with check (bucket_id = 'screenshots'
    and (select private.reviews_session(private.folder_session(name))));
create policy "reviewers and owners read screenshots" on storage.objects for select to authenticated
  using (bucket_id = 'screenshots'
    and ((select private.reviews_session(private.folder_session(name)))
      or (select private.owns_session(private.folder_session(name)))));
create policy "owners delete screenshots" on storage.objects for delete to authenticated
  using (bucket_id = 'screenshots' and (select private.owns_session(private.folder_session(name))));
