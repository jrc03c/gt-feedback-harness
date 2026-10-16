-- Helpers live in a schema the Data API never exposes, so they run only
-- inside policies and SQL and cannot be called over REST.
create schema if not exists private;
grant usage on schema private to authenticated;

-- Programs a developer has registered. share_id is the secret in reviewer links.
create table public.programs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  gt_key text not null check (gt_key ~ '^[A-Za-z0-9]{1,32}$'),
  label text,
  share_id text not null unique check (share_id ~ '^[A-Za-z0-9]{24}$'),
  created_at timestamptz not null default now(),
  unique (owner_id, gt_key)
);
create index programs_owner on public.programs (owner_id);

-- One reviewer run of one program. share_id is denormalised so the insert
-- policy can verify the reviewer knew the link without reading programs.
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs (id) on delete cascade,
  share_id text not null,
  reviewer_uid uuid not null,
  reviewer_name text not null default '',
  mode text not null check (mode in ('run', 'test')),
  gt_run_id text,
  user_agent text,
  viewport jsonb,
  recording_enabled boolean not null default false,
  recording_gap boolean not null default false,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index sessions_program_started on public.sessions (program_id, started_at desc);
create index sessions_reviewer on public.sessions (reviewer_uid);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  created_at timestamptz not null default now(),
  text text not null default '',
  annotations jsonb not null default '[]'::jsonb,
  context jsonb not null default '{}'::jsonb,
  screenshot_path text,
  image_size jsonb,
  recording_offset_ms integer,
  resolved_at timestamptz
);
create index items_session_created on public.items (session_id, created_at);

-- Policy helpers. The definer ones let policies check facts the caller is
-- not allowed to read directly (a reviewer cannot read programs). Every
-- definer body is anchored on the calling user's identity, and search_path
-- is empty so every reference is schema-qualified.
create function private.is_developer() returns boolean
language sql stable set search_path = '' as $$
  select (select auth.uid()) is not null
     and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
$$;

create function private.share_matches(program uuid, share text) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
     and exists (select 1 from public.programs p where p.id = program and p.share_id = share)
$$;

create function private.owns_program(program uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.programs p where p.id = program and p.owner_id = (select auth.uid())
  )
$$;

create function private.owns_session(session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sessions s join public.programs p on p.id = s.program_id
    where s.id = session and p.owner_id = (select auth.uid())
  )
$$;

create function private.reviews_session(session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sessions s where s.id = session and s.reviewer_uid = (select auth.uid())
  )
$$;

revoke all on function private.is_developer() from public;
revoke all on function private.share_matches(uuid, text) from public;
revoke all on function private.owns_program(uuid) from public;
revoke all on function private.owns_session(uuid) from public;
revoke all on function private.reviews_session(uuid) from public;
grant execute on function private.is_developer() to authenticated;
grant execute on function private.share_matches(uuid, text) to authenticated;
grant execute on function private.owns_program(uuid) to authenticated;
grant execute on function private.owns_session(uuid) to authenticated;
grant execute on function private.reviews_session(uuid) to authenticated;

-- The one deliberately exposed function: a signed-in reviewer trades the
-- link secret for the program key. It returns nothing without the secret.
create function public.resolve_share(share text) returns table (program_id uuid, gt_key text)
language sql stable security definer set search_path = '' as $$
  select id, gt_key from public.programs
  where share_id = share and (select auth.uid()) is not null
$$;
revoke all on function public.resolve_share(text) from public, anon;
grant execute on function public.resolve_share(text) to authenticated;

-- Program list with counts; security_invoker makes it obey the tables' RLS.
create view public.program_overview with (security_invoker = true) as
  select p.*,
    (select count(*) from public.sessions s where s.program_id = p.id) as session_count,
    (select count(*) from public.items i join public.sessions s on s.id = i.session_id
      where s.program_id = p.id and i.resolved_at is null) as unresolved_count
  from public.programs p;

-- New tables are not exposed to the Data API by default; grant exactly what
-- the app needs to the authenticated role (anonymous reviewers and signed-in
-- developers both use it) and nothing to anon.
grant select, insert, update, delete on public.programs, public.sessions, public.items to authenticated;
grant select on public.program_overview to authenticated;

alter table public.programs enable row level security;
alter table public.sessions enable row level security;
alter table public.items enable row level security;

create policy "owners manage programs" on public.programs for all to authenticated
  using ((select private.is_developer()) and owner_id = (select auth.uid()))
  with check ((select private.is_developer()) and owner_id = (select auth.uid()));

create policy "reviewers create sessions" on public.sessions for insert to authenticated
  with check (reviewer_uid = (select auth.uid()) and (select private.share_matches(program_id, share_id)));
create policy "reviewers and owners read sessions" on public.sessions for select to authenticated
  using (reviewer_uid = (select auth.uid()) or (select private.owns_program(program_id)));
create policy "reviewers update own sessions" on public.sessions for update to authenticated
  using (reviewer_uid = (select auth.uid()))
  with check (reviewer_uid = (select auth.uid()) and (select private.share_matches(program_id, share_id)));
create policy "owners delete sessions" on public.sessions for delete to authenticated
  using ((select private.owns_program(program_id)));

create policy "reviewers create items" on public.items for insert to authenticated
  with check ((select private.reviews_session(session_id)));
create policy "reviewers and owners read items" on public.items for select to authenticated
  using ((select private.reviews_session(session_id)) or (select private.owns_session(session_id)));
create policy "owners update items" on public.items for update to authenticated
  using ((select private.owns_session(session_id))) with check ((select private.owns_session(session_id)));
create policy "owners delete items" on public.items for delete to authenticated
  using ((select private.owns_session(session_id)));

-- Screenshots live at screenshots/{session_id}/{item_id}.webp.
insert into storage.buckets (id, name, public) values ('screenshots', 'screenshots', false);

create policy "reviewers upload screenshots" on storage.objects for insert to authenticated
  with check (bucket_id = 'screenshots'
    and (select private.reviews_session(((storage.foldername(name))[1])::uuid)));
create policy "reviewers and owners read screenshots" on storage.objects for select to authenticated
  using (bucket_id = 'screenshots'
    and ((select private.reviews_session(((storage.foldername(name))[1])::uuid))
      or (select private.owns_session(((storage.foldername(name))[1])::uuid))));
create policy "owners delete screenshots" on storage.objects for delete to authenticated
  using (bucket_id = 'screenshots' and (select private.owns_session(((storage.foldername(name))[1])::uuid)));
