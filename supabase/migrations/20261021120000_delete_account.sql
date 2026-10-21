-- Lets a signed-in developer delete their own account. Users cannot touch the
-- auth schema themselves, so this runs as the definer; it checks the caller
-- is a developer (not an anonymous reviewer) and deletes only the caller.
-- Programs reference auth.users with on delete cascade, so their sessions
-- and items go with the user; the client removes screenshots first.
create function public.delete_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (select private.is_developer()) then
    raise exception 'only a signed-in developer can delete their account'
      using errcode = '42501';
  end if;
  delete from auth.users where id = (select auth.uid());
end $$;
revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
