# Phase 2: Supabase Backend and Developer Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Phase 1's local download with a Supabase backend: developers sign in, register GuidedTrack programs, get share links; reviewers open a link, run the program, and their feedback (screenshot, annotations, text, context) is stored under the developer, who reads it in an inbox.

**Architecture:** The static app keeps its Phase 1 modules. A new `store` module is the only code that talks to Supabase (auth, Postgres over PostgREST, Storage). Reviewers are signed in anonymously; developers with Google. All protection is row-level security defined in one SQL migration, tested with pgTAP. Screens get the store injected, so browser tests use an in-memory fake store and never touch the network; one network-gated integration test exercises the real project.

**Tech Stack:** Node 24, esbuild, Prettier, `node --test`, Playwright 1.49.0 (preinstalled), `@supabase/supabase-js` 2.x, Supabase CLI via `npx supabase` 2.x, pgTAP, the `pg` package (dev only, for the local test runner), GitHub Actions with `supabase/setup-cli`.

**Spec:** `docs/superpowers/specs/2026-10-14-gt-feedback-harness-design.md` (sections Data model, Reviewer screen "Session lifecycle", Developer screens, Security, Testing, Deployment). Phase 1 realities that supersede the spec where they differ: feedback items carry `image: { blob, url, width, height, scale }` (see the contract comment in `src/screens/reviewer.js`); recording (rrweb) is Phase 3 and is excluded here.

## Global Constraints

- Code style: ES modules, no semicolons, double quotes, two-space indent, Prettier (`npm run format` before each commit). No framework.
- New runtime dependency allowed: `@supabase/supabase-js`. New dev dependency allowed: `pg` (local pgTAP runner only). Playwright stays out of `package.json`.
- Every commit message ends with the trailer line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Markdown: exactly one blank line after every heading; no manual line wrapping inside paragraphs.
- The publishable key is public by design and is committed in `src/config.js` under the name `SUPABASE_ANON_KEY` (kept for Task 1 compatibility; it holds the `sb_publishable_...` key). The secret key is never committed and never shipped to the browser.
- Database rules from the Supabase skills: wrap `auth.uid()`/`auth.jwt()` in policies as `(select auth.uid())`; keep `security definer` helpers in a non-exposed `private` schema with `set search_path = ''`; grant table access explicitly (new tables are not exposed to the Data API by default); every table in `public` has RLS enabled; UPDATE policies carry both `using` and `with check`.
- Table and column names exactly as in Task 2's migration; share ids are 24 characters of `[A-Za-z0-9]` generated in the browser from `crypto.getRandomValues`.
- Routing by query string only: `?r=SHARE_ID&mode=run|test` (reviewer), `?dev` (developer home, also the default), `?dev&program=UUID` (inbox), `?session=UUID` (session view). Phase 1's `?key=` route and `src/send-local.js` are removed in Task 11.
- Reviewer-supplied strings reach the DOM only through `textContent`; never through `innerHTML` interpolation.
- Storage path for screenshots: `screenshots/{session_id}/{item_id}.webp`.
- Headless Chromium has `devicePixelRatio` 1, and the default `withPage` viewport is 800x600.

## Prerequisites (the human does these; Task 1 records the values)

1. Create a Supabase project (free tier) named `gt-feedback-harness`; leave "Automatically expose new tables" off and turn "Enable automatic RLS" on. Note the project ref, the project URL (`https://<ref>.supabase.co`), the **publishable** key (`sb_publishable_...`, under Settings, API Keys; not the legacy `anon` JWT, which Supabase is deprecating by the end of 2026), the database password, and the **Session pooler** connection string (the direct connection is IPv6-only; the pooler is IPv4 and free). The secret key is never needed by this plan.
2. Authentication → Providers: enable **Anonymous sign-ins**. Enable **Google**: create an OAuth client (Web application) in Google Cloud Console with the authorized JavaScript origin `https://jrc03c.github.io` and the authorized redirect URI shown on Supabase's Google provider page; paste the client id and secret into Supabase.
3. Authentication → URL Configuration: Site URL `https://jrc03c.github.io/gt-feedback-harness/`; add `https://jrc03c.github.io/gt-feedback-harness/**` and `http://127.0.0.1:*/**` to the redirect allow list (the second one is for local testing).
4. GitHub repository secrets: `SUPABASE_ACCESS_TOKEN` (a **scoped** personal access token limited to this project with read access to it; `db push` authenticates with the database password, so the token needs no write permissions), `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`.
5. Locally, export `SUPABASE_DB_URL` (the session pooler string with the password filled in) for `npm run test:db`.

## File structure

```
src/config.js                     SUPABASE_URL, SUPABASE_ANON_KEY, OAUTH_PROVIDER, isConfigured()
src/store.js                      the only Supabase client code
src/share-id.js                   newShareId() (pure, unit-tested)
src/download.js                   download(blob, filename) (moved from send-local.js)
src/format.js                     pure formatters for the inbox: line ranges, dates, durations
src/router.js                     routes above
src/main.js                       store creation, route dispatch, reviewer flow wiring
src/screens/reviewer.js           unchanged interface; main passes sendFeedback
src/screens/developer.js          sign-in, program list, register, links, regenerate, delete
src/screens/inbox.js              sessions of one program
src/screens/session.js            items of one session
src/screens/banners.js            renderErrorBanner/renderRefusalBanner moved here from reviewer.js
supabase/config.toml              created by `npx supabase init`
supabase/migrations/<timestamp>_schema.sql  (created with `supabase migration new schema`)
supabase/tests/0001_policies.sql  pgTAP
scripts/run-pgtap.mjs             local runner: sends a test file to SUPABASE_DB_URL via pg
scripts/keep-alive.mjs            weekly ping
.github/workflows/deploy.yml      + db-tests job, + migrations push, + weekly schedule
test/fixtures/fake-store.js       in-memory store for screen tests
test/fixtures/fake-supabase.js    chain-recording fake client for store unit tests
test/unit/{share-id,store,format,router}.test.js
test/browser/{reviewer-flow,developer,inbox,session}.test.js
test/browser/store-live.test.js   network-gated against the real project
```

---

### Task 1: Configuration and dependencies

> Executed before the Supabase skills were installed. Superseded details: the committed key must be the publishable key (`sb_publishable_...`), and `isConfigured()` must check for that prefix; both changes land in Task 2's Step 6. Pin `@supabase/supabase-js` and `pg` to exact versions in that step too (the skills require pinned versions).

**Files:**
- Create: `src/config.js`, `test/unit/config.test.js`
- Modify: `package.json`, `README.md`

**Interfaces:**
- Produces: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `OAUTH_PROVIDER = "google"`, `isConfigured() → boolean` from `src/config.js`. `npm run test:db` script (used from Task 2). `@supabase/supabase-js` installed.

- [ ] **Step 1: Write the failing test**

`test/unit/config.test.js`:

```js
import { test } from "node:test"
import assert from "node:assert/strict"
import { SUPABASE_URL, SUPABASE_ANON_KEY, OAUTH_PROVIDER, isConfigured } from "../../src/config.js"

test("config exposes the Supabase project and reports whether it is set", () => {
  assert.equal(typeof SUPABASE_URL, "string")
  assert.equal(typeof SUPABASE_ANON_KEY, "string")
  assert.equal(OAUTH_PROVIDER, "google")
  assert.equal(isConfigured(), Boolean(SUPABASE_URL && SUPABASE_ANON_KEY))
  if (isConfigured()) assert.match(SUPABASE_URL, /^https:\/\/[a-z]+\.supabase\.co$/)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit`
Expected: FAIL, cannot find `src/config.js`.

- [ ] **Step 3: Write the config and install the dependency**

`src/config.js` (fill the two values from the prerequisites; they are public):

```js
// The Supabase anon key is public by design: it only grants what the
// row-level security policies allow. The service role key never goes here.
export const SUPABASE_URL = "https://REPLACE.supabase.co"
export const SUPABASE_ANON_KEY = "REPLACE"
export const OAUTH_PROVIDER = "google"

export function isConfigured() {
  return (
    SUPABASE_URL.startsWith("https://") &&
    !SUPABASE_URL.includes("REPLACE") &&
    SUPABASE_ANON_KEY.length > 20 &&
    SUPABASE_ANON_KEY !== "REPLACE"
  )
}
```

Run: `npm install @supabase/supabase-js@^2.118.0 && npm install --save-dev pg@^8`

Add to `package.json` scripts: `"test:db": "node scripts/run-pgtap.mjs supabase/tests"` (the script arrives in Task 2; the entry is harmless now).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: PASS (the `if (isConfigured())` branch runs only once real values are in place).

- [ ] **Step 5: Document and commit**

Add to README's Development section: "Backend: Supabase. `src/config.js` holds the project URL and anon key (public). `npm run test:db` runs the database policy tests against `SUPABASE_DB_URL` (the project's session-pooler connection string); CI runs them against a throwaway local database."

```bash
npm run format
git add src/config.js test/unit/config.test.js package.json package-lock.json README.md
git commit -m "Add Supabase configuration and client dependency

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Schema, policies, and pgTAP tests

**Files:**
- Create: `supabase/config.toml` (via CLI), `supabase/migrations/<timestamp>_schema.sql  (created with `supabase migration new schema`)`, `supabase/tests/0001_policies.sql`, `scripts/run-pgtap.mjs`
- Modify: `.gitignore` (add `supabase/.temp`, `supabase/.branches`)

**Interfaces:**
- Produces: tables `programs`, `sessions`, `items`; view `program_overview`; functions `resolve_share(share text)`, `is_developer()`, `share_matches(program uuid, share text)`, `owns_program(program uuid)`, `owns_session(session uuid)`, `reviews_session(session uuid)`; private bucket `screenshots`; the policies below. The store (Task 4) depends on every name here.

- [ ] **Step 1: Initialise the Supabase project directory**

Run: `cd /home/ubuntu/workspace && npx supabase init --yes 2>&1 | tail -2 && npx supabase migration new schema && ls supabase supabase/migrations`
Expected: `supabase/config.toml` exists (keep its defaults) and an empty `supabase/migrations/<timestamp>_schema.sql` was created by the CLI (never invent the filename). Append `supabase/.temp` and `supabase/.branches` to `.gitignore`.

- [ ] **Step 2: Write the local pgTAP runner**

`scripts/run-pgtap.mjs`:

```js
// Runs every supabase/tests/*.sql file against SUPABASE_DB_URL using the pg
// package, so policy tests work without Docker. Each file wraps itself in
// begin/rollback, and pgTAP returns TAP lines as query result rows.
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import pg from "pg"

const dir = process.argv[2] || "supabase/tests"
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error("SUPABASE_DB_URL is not set (use the project's session pooler connection string)")
  process.exit(2)
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
let failed = 0
try {
  for (const file of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) {
    console.log(`# ${file}`)
    const results = await client.query(readFileSync(path.join(dir, file), "utf8"))
    for (const result of Array.isArray(results) ? results : [results]) {
      for (const row of result.rows || []) {
        const line = Object.values(row)[0]
        if (typeof line !== "string") continue
        console.log(line)
        if (line.startsWith("not ok")) failed++
      }
    }
  }
} finally {
  await client.end()
}
if (failed > 0) {
  console.error(`${failed} pgTAP assertion(s) failed`)
  process.exit(1)
}
```

- [ ] **Step 3: Write the failing policy tests**

`supabase/tests/0001_policies.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- Four users: two developers (real accounts) and two anonymous reviewers.
insert into auth.users (id, instance_id, aud, role, email, is_anonymous) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dev1@example.com', false),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dev2@example.com', false),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true),
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true);

create function pg_temp.login(uid text, anonymous boolean) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'is_anonymous', anonymous)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create function pg_temp.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- 1-3: programs belong to developers only
select pg_temp.login('00000000-0000-0000-0000-000000000001', false);
select lives_ok($$ insert into programs (id, owner_id, gt_key, share_id)
  values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'abc1234', 'AAAAAAAAAAAAAAAAAAAAAAAA') $$,
  'a developer can register a program');
select pg_temp.login('00000000-0000-0000-0000-000000000002', false);
select is((select count(*) from programs)::int, 0, 'another developer cannot see it');
select pg_temp.login('00000000-0000-0000-0000-000000000003', true);
select throws_ok($$ insert into programs (owner_id, gt_key, share_id)
  values ('00000000-0000-0000-0000-000000000003', 'zzz9999', 'BBBBBBBBBBBBBBBBBBBBBBBB') $$,
  '42501', null, 'an anonymous user cannot register a program');

-- 4-5: share resolution
select results_eq($$ select gt_key from resolve_share('AAAAAAAAAAAAAAAAAAAAAAAA') $$, $$ values ('abc1234') $$,
  'a reviewer resolves a share id to the program key');
select is((select count(*) from resolve_share('nope'))::int, 0, 'an unknown share id resolves to nothing');

-- 6-8: sessions
select lives_ok($$ insert into sessions (id, program_id, share_id, reviewer_uid, mode)
  values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'AAAAAAAAAAAAAAAAAAAAAAAA', '00000000-0000-0000-0000-000000000003', 'test') $$,
  'a reviewer with the share id creates a session');
select throws_ok($$ insert into sessions (program_id, share_id, reviewer_uid, mode)
  values ('10000000-0000-0000-0000-000000000001', 'WRONGWRONGWRONGWRONGWRON', '00000000-0000-0000-0000-000000000003', 'test') $$,
  '42501', null, 'the wrong share id is rejected');
select throws_ok($$ insert into sessions (program_id, share_id, reviewer_uid, mode)
  values ('10000000-0000-0000-0000-000000000001', 'AAAAAAAAAAAAAAAAAAAAAAAA', '00000000-0000-0000-0000-000000000004', 'test') $$,
  '42501', null, 'a session cannot be created for another reviewer uid');

-- 9-10: items by the reviewer
select lives_ok($$ insert into items (id, session_id, text)
  values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'hello') $$,
  'the reviewer adds an item to their session');
select lives_ok($$ update sessions set reviewer_name = 'Alice', last_seen_at = now()
  where id = '20000000-0000-0000-0000-000000000001' $$, 'the reviewer updates their session');

-- 11-13: another reviewer sees and touches nothing
select pg_temp.login('00000000-0000-0000-0000-000000000004', true);
select is((select count(*) from sessions)::int, 0, 'another reviewer cannot see the session');
select is((select count(*) from items)::int, 0, 'another reviewer cannot see the item');
select throws_ok($$ insert into items (session_id, text) values ('20000000-0000-0000-0000-000000000001', 'x') $$,
  '42501', null, 'another reviewer cannot add an item to the session');

-- 14-17: the owner reads, resolves, and the other developer cannot
select pg_temp.login('00000000-0000-0000-0000-000000000001', false);
select is((select count(*) from sessions)::int, 1, 'the owner sees the session');
select is((select reviewer_name from sessions where id = '20000000-0000-0000-0000-000000000001'), 'Alice', 'with the reviewer name');
select lives_ok($$ update items set resolved_at = now() where id = '30000000-0000-0000-0000-000000000001' $$, 'the owner resolves an item');
select pg_temp.login('00000000-0000-0000-0000-000000000002', false);
select is((select count(*) from items)::int, 0, 'another developer sees no items');

-- 18: the reviewer cannot resolve (update silently affects no rows)
select pg_temp.login('00000000-0000-0000-0000-000000000003', true);
update items set resolved_at = null where id = '30000000-0000-0000-0000-000000000001';
select pg_temp.login('00000000-0000-0000-0000-000000000001', false);
select isnt((select resolved_at from items where id = '30000000-0000-0000-0000-000000000001'), null, 'a reviewer cannot change resolved_at');

-- 19-20: storage policies on the screenshots bucket
select pg_temp.login('00000000-0000-0000-0000-000000000003', true);
select lives_ok($$ insert into storage.objects (bucket_id, name, owner_id)
  values ('screenshots', '20000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001.webp', '00000000-0000-0000-0000-000000000003') $$,
  'the reviewer uploads into their session folder');
select pg_temp.login('00000000-0000-0000-0000-000000000004', true);
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id)
  values ('screenshots', '20000000-0000-0000-0000-000000000001/other.webp', '00000000-0000-0000-0000-000000000004') $$,
  '42501', null, 'another reviewer cannot upload into that folder');

-- 21: the overview view counts for the owner
select pg_temp.login('00000000-0000-0000-0000-000000000001', false);
select results_eq($$ select session_count::int, unresolved_count::int from program_overview where id = '10000000-0000-0000-0000-000000000001' $$,
  $$ values (1, 0) $$, 'program_overview counts sessions and unresolved items');

-- 22: deleting a session cascades to its items
select lives_ok($$ delete from sessions where id = '20000000-0000-0000-0000-000000000001' $$, 'the owner deletes a session');
select pg_temp.logout();
select * from finish();
rollback;
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `SUPABASE_DB_URL=<session pooler url> npm run test:db`
Expected: the runner connects, then the first statement touching `programs` fails with `relation "programs" does not exist` (pg reports the error and the runner exits non-zero). If the connection itself fails, fix `SUPABASE_DB_URL` before continuing; the pooler host is `aws-0-<region>.pooler.supabase.com` on port 5432.

- [ ] **Step 5: Write the migration**

- [ ] **Step 5: Write the migration**

Paste this into the file `supabase migration new schema` created (`supabase/migrations/<timestamp>_schema.sql`):

```sql
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
```

- [ ] **Step 6: Apply the migration to the project and run the tests**

Run: `npx supabase link --project-ref <ref>` (prompts for the database password; set `SUPABASE_ACCESS_TOKEN` in the environment first), then `npx supabase db push`, then `npx supabase db advisors` (CLI 2.81.3 or newer; fix anything it reports, re-push, and re-run), then `SUPABASE_DB_URL=<pooler url> npm run test:db`.

Then fill in `src/config.js` with the real project URL and the `sb_publishable_...` key, change `isConfigured()` to require the key to start with `sb_publishable_` (a `sb_secret_` key must make it return false, and add that case to `test/unit/config.test.js`), and tighten `test/browser/app.test.js`'s banner assertion to `/isn't valid/` with the first wait on `.harness-signin` only. Run `HARNESS_SUPABASE_URL=<url> HARNESS_SUPABASE_ANON_KEY=<publishable key> npm run test:browser` and confirm the live store test and the app test pass.
Expected: `db push` applies `20261016000000_schema.sql`; the runner prints `ok 1` through `ok 22` and exits 0. If assertion 19 fails with a cast error, the storage policy received a non-uuid folder; the test paths are uuids, so check the policy text. If assertion 3 or 8 fails because the error code differs, the thrown SQLSTATE is printed in the TAP diagnostic; RLS violations are `42501`.

- [ ] **Step 7: Commit**

```bash
npm run format
git add .gitignore supabase/config.toml supabase/migrations supabase/tests scripts/run-pgtap.mjs
git commit -m "Add the Supabase schema, row-level security policies, and pgTAP tests

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: CI: database tests, migration push, keep-alive

**Files:**
- Create: `scripts/keep-alive.mjs`
- Modify: `.github/workflows/deploy.yml`

**Interfaces:**
- Produces: a `db-tests` job (Docker, throwaway database) gating `deploy`; a `migrate` step pushing migrations to the project on `main`; a weekly scheduled `keep-alive` job.

- [ ] **Step 1: Write the keep-alive script**

`scripts/keep-alive.mjs`:

```js
// Weekly ping so the free-tier project is never paused for inactivity.
// Uses the public anon key; row-level security returns an empty list.
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_ANON_KEY
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_ANON_KEY are required")
  process.exit(2)
}
// Publishable keys travel in the apikey header only (they are not JWTs).
const response = await fetch(`${url}/rest/v1/programs?select=id&limit=1`, {
  headers: { apikey: key },
})
console.log(`keep-alive: ${response.status}`)
if (!response.ok) process.exit(1)
```

- [ ] **Step 2: Update the workflow**

Replace `.github/workflows/deploy.yml` with:

```yaml
name: Test and deploy

on:
  push:
    branches: [main]
  workflow_dispatch:
  schedule:
    - cron: "17 9 * * 1"

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  test:
    if: github.event_name != 'schedule'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm install --no-save playwright@1.49.0
      - run: npx playwright install --with-deps chromium
      - run: npm test

  db-tests:
    if: github.event_name != 'schedule'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - run: supabase db start
      - run: supabase test db

  deploy:
    if: github.event_name != 'schedule'
    needs: [test, db-tests]
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - run: supabase link --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}
      - run: supabase db push
      - run: npm ci
      - run: npm run build
      - run: |
          mkdir -p site
          cp index.html site/
          cp -r dist site/dist
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: site
      - id: deployment
        uses: actions/deploy-pages@v4

  keep-alive:
    if: github.event_name == 'schedule'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: node -e "import('./src/config.js').then(c => { process.stdout.write(c.SUPABASE_URL + '\n' + c.SUPABASE_ANON_KEY) })" > creds.txt
      - run: |
          SUPABASE_URL=$(sed -n 1p creds.txt) SUPABASE_ANON_KEY=$(sed -n 2p creds.txt) node scripts/keep-alive.mjs
```

- [ ] **Step 3: Verify locally what can be verified**

Run: `SUPABASE_URL=<url> SUPABASE_ANON_KEY=<anon key> node scripts/keep-alive.mjs`
Expected: `keep-alive: 200`. The workflow itself is verified by the next push to `main`; report it as unverified until then.

- [ ] **Step 4: Commit**

```bash
npm run format
git add scripts/keep-alive.mjs .github/workflows/deploy.yml
git commit -m "Run database policy tests and migrations in CI, and ping the project weekly

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Share ids, download helper, and formatters (pure modules)

**Files:**
- Create: `src/share-id.js`, `src/download.js`, `src/format.js`, `test/unit/share-id.test.js`, `test/unit/format.test.js`

**Interfaces:**
- Produces: `newShareId() → string` (24 chars of `[A-Za-z0-9]`); `download(blob, filename)` (moved verbatim from `send-local.js`); `formatLines(lines) → string` (`"main: lines 1-3, 10-12; helper: line 20"`), `formatDate(iso) → string` (local date and time), `formatDuration(startIso, endIso) → string` (`"under a minute"`, `"4 min"`, `"1 h 12 min"`), `programLabel({ label, gt_key }) → string` (label if set, else the key).

- [ ] **Step 1: Write the failing tests**

`test/unit/share-id.test.js`:

```js
import { test } from "node:test"
import assert from "node:assert/strict"
import { newShareId } from "../../src/share-id.js"

test("share ids are 24 alphanumeric characters and differ between calls", () => {
  const a = newShareId()
  const b = newShareId()
  assert.match(a, /^[A-Za-z0-9]{24}$/)
  assert.match(b, /^[A-Za-z0-9]{24}$/)
  assert.notEqual(a, b)
})
```

`test/unit/format.test.js`:

```js
import { test } from "node:test"
import assert from "node:assert/strict"
import { formatLines, formatDate, formatDuration, programLabel } from "../../src/format.js"

test("formatLines groups ranges by program and collapses single lines", () => {
  assert.equal(
    formatLines([
      { from: 1, to: 3, program: "main" },
      { from: 10, to: 12, program: "main" },
      { from: 20, to: 20, program: "helper" },
    ]),
    "main: lines 1-3, 10-12; helper: line 20",
  )
  assert.equal(formatLines([]), "no line information")
  assert.equal(formatLines(undefined), "no line information")
})

test("formatDuration rounds to minutes and hours", () => {
  assert.equal(formatDuration("2026-10-16T10:00:00Z", "2026-10-16T10:00:30Z"), "under a minute")
  assert.equal(formatDuration("2026-10-16T10:00:00Z", "2026-10-16T10:04:10Z"), "4 min")
  assert.equal(formatDuration("2026-10-16T10:00:00Z", "2026-10-16T11:12:00Z"), "1 h 12 min")
})

test("formatDate renders a parseable local date and programLabel prefers the label", () => {
  assert.match(formatDate("2026-10-16T10:04:10Z"), /2026/)
  assert.equal(programLabel({ label: "Sleep study", gt_key: "abc1234" }), "Sleep study")
  assert.equal(programLabel({ label: "", gt_key: "abc1234" }), "abc1234")
  assert.equal(programLabel({ label: null, gt_key: "abc1234" }), "abc1234")
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:unit`
Expected: FAIL, cannot find `src/share-id.js` and `src/format.js`.

- [ ] **Step 3: Write the modules**

`src/share-id.js`:

```js
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

// 24 characters from a 62-symbol alphabet is about 143 bits of entropy.
export function newShareId(length = 24) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let id = ""
  for (const byte of bytes) id += ALPHABET[byte % ALPHABET.length]
  return id
}
```

`src/download.js`:

```js
export function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
```

`src/format.js`:

```js
export function formatLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return "no line information"
  const byProgram = new Map()
  for (const line of lines) {
    const program = line.program || "main"
    if (!byProgram.has(program)) byProgram.set(program, [])
    byProgram.get(program).push(line)
  }
  return Array.from(byProgram, ([program, ranges]) => {
    const parts = ranges.map(({ from, to }) => (from === to ? `${from}` : `${from}-${to}`))
    const word = ranges.length === 1 && ranges[0].from === ranges[0].to ? "line" : "lines"
    return `${program}: ${word} ${parts.join(", ")}`
  }).join("; ")
}

export function formatDate(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "unknown time"
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

export function formatDuration(startIso, endIso) {
  const minutes = Math.round((new Date(endIso) - new Date(startIso)) / 60000)
  if (!Number.isFinite(minutes) || minutes < 1) return "under a minute"
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

export function programLabel(program) {
  return program.label ? program.label : program.gt_key
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/share-id.js src/download.js src/format.js test/unit/share-id.test.js test/unit/format.test.js
git commit -m "Add share id generation, a download helper, and inbox formatters

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The store (the only Supabase client code)

**Files:**
- Create: `src/store.js`, `test/fixtures/fake-supabase.js`, `test/unit/store.test.js`

**Interfaces:**
- Consumes: `newShareId` (Task 4); `@supabase/supabase-js` `createClient`.
- Produces: `createStore({ url, anonKey, client }) → store` with:
  - auth: `signInAnonymously() → user`, `getUser() → user | null`, `signInWithProvider(provider, redirectTo)`, `signOut()`, `onAuthChange(fn) → { unsubscribe() }`
  - reviewer: `resolveShare(shareId) → { programId, gtKey } | null`, `createSession({ programId, shareId, mode, reviewerName, userAgent, viewport }) → sessionId`, `touchSession(sessionId, { reviewerName })`, `sendItem(sessionId, item) → itemId` (uploads `item.image.blob` to `screenshots/{sessionId}/{itemId}.webp`, inserts the row)
  - developer: `listPrograms() → [{ id, gt_key, label, share_id, created_at, session_count, unresolved_count }]`, `registerProgram({ gtKey, label }) → program`, `regenerateShare(programId) → shareId`, `deleteProgram(programId)`, `getProgram(programId) → program`, `listSessions(programId) → [{ ...session, item_count, unresolved_count }]`, `getSession(sessionId) → { ...session, programs: { gt_key, label } }`, `listItems(sessionId) → items`, `downloadScreenshot(path) → Blob`, `setResolved(itemId, resolved)`, `deleteSession(sessionId)`
  - Every method throws the Supabase `error` object when one is returned.
  - `SCREENSHOT_BUCKET = "screenshots"`.

- [ ] **Step 1: Write the chain-recording fake client**

`test/fixtures/fake-supabase.js`:

```js
// A stand-in for a supabase-js client. Every builder call is recorded, and
// awaiting a chain resolves with the canned response registered for
// "<kind>:<name>" (a value or a function of the recorded call).
export function createFakeSupabase(responses = {}, authState = {}) {
  const calls = []

  function chain(kind, name, initialSteps = []) {
    const record = { kind, name, steps: [...initialSteps] }
    calls.push(record)
    const proxy = new Proxy(function () {}, {
      get(_, prop) {
        if (prop === "then") {
          const response = responses[`${kind}:${name}`] ?? { data: null, error: null }
          const value = typeof response === "function" ? response(record) : response
          return (resolve, reject) => Promise.resolve(value).then(resolve, reject)
        }
        return (...args) => {
          record.steps.push([prop, args])
          return proxy
        }
      },
    })
    return proxy
  }

  let user = authState.user ?? null
  const listeners = []
  return {
    calls,
    stepsOf(kind, name) {
      return calls.filter(c => c.kind === kind && c.name === name).map(c => c.steps)
    },
    from: table => chain("from", table),
    rpc: (fn, args) => chain("rpc", fn, [["args", [args]]]),
    storage: { from: bucket => chain("storage", bucket) },
    auth: {
      async getSession() {
        return { data: { session: user ? { user } : null }, error: null }
      },
      async signInAnonymously() {
        user = { id: "anon-uid", is_anonymous: true }
        return { data: { user }, error: null }
      },
      async signInWithOAuth(options) {
        calls.push({ kind: "auth", name: "signInWithOAuth", steps: [["options", [options]]] })
        return { data: {}, error: null }
      },
      async signOut() {
        user = null
        return { error: null }
      },
      onAuthStateChange(fn) {
        listeners.push(fn)
        return { data: { subscription: { unsubscribe() {} } } }
      },
      emit(session) {
        for (const fn of listeners) fn("SIGNED_IN", session)
      },
    },
  }
}
```

- [ ] **Step 2: Write the failing tests**

`test/unit/store.test.js`:

```js
import { test } from "node:test"
import assert from "node:assert/strict"
import { createStore, SCREENSHOT_BUCKET } from "../../src/store.js"
import { createFakeSupabase } from "../fixtures/fake-supabase.js"

const store = (responses, authState) => {
  const client = createFakeSupabase(responses, authState)
  return { client, store: createStore({ url: "https://x.supabase.co", anonKey: "k", client }) }
}

test("signInAnonymously reuses an existing session and otherwise signs in", async () => {
  const existing = store({}, { user: { id: "u1" } })
  assert.deepEqual(await existing.store.signInAnonymously(), { id: "u1" })
  const fresh = store({})
  assert.equal((await fresh.store.signInAnonymously()).id, "anon-uid")
})

test("resolveShare maps the rpc row and returns null for unknown ids", async () => {
  const { client, store: s } = store({
    "rpc:resolve_share": record =>
      record.steps[0][1][0].share === "KNOWN"
        ? { data: [{ program_id: "p1", gt_key: "abc1234" }], error: null }
        : { data: [], error: null },
  })
  assert.deepEqual(await s.resolveShare("KNOWN"), { programId: "p1", gtKey: "abc1234" })
  assert.equal(await s.resolveShare("NOPE"), null)
  assert.equal(client.stepsOf("rpc", "resolve_share").length, 2)
})

test("errors from Supabase are thrown", async () => {
  const { store: s } = store({ "rpc:resolve_share": { data: null, error: { message: "boom" } } })
  await assert.rejects(() => s.resolveShare("X"), /boom/)
})

test("createSession inserts the row and returns its id", async () => {
  const { client, store: s } = store({ "from:sessions": { data: { id: "s1" }, error: null } }, { user: { id: "anon-uid" } })
  const id = await s.createSession({
    programId: "p1",
    shareId: "SHARE",
    mode: "test",
    reviewerName: "Alice",
    userAgent: "UA",
    viewport: { width: 800, height: 600 },
  })
  assert.equal(id, "s1")
  const [steps] = client.stepsOf("from", "sessions")
  assert.deepEqual(steps[0], [
    "insert",
    [
      {
        program_id: "p1",
        share_id: "SHARE",
        reviewer_uid: "anon-uid",
        reviewer_name: "Alice",
        mode: "test",
        user_agent: "UA",
        viewport: { width: 800, height: 600 },
      },
    ],
  ])
  assert.deepEqual(steps[1], ["select", ["id"]])
  assert.deepEqual(steps[2], ["single", []])
})

test("sendItem uploads the screenshot then inserts the item with its path", async () => {
  const { client, store: s } = store({ "from:items": { data: { id: "ignored" }, error: null } })
  const blob = new Blob(["x"], { type: "image/webp" })
  const id = await s.sendItem("s1", {
    image: { blob, width: 800, height: 600, scale: 1 },
    annotations: [{ id: "a" }],
    text: "Looks wrong",
    context: { lines: [] },
  })
  assert.match(id, /^[0-9a-f-]{36}$/)
  const [upload] = client.stepsOf("storage", SCREENSHOT_BUCKET)
  assert.equal(upload[0][0], "upload")
  assert.equal(upload[0][1][0], `s1/${id}.webp`)
  assert.equal(upload[0][1][1], blob)
  assert.deepEqual(upload[0][1][2], { contentType: "image/webp", upsert: false })
  const [insert] = client.stepsOf("from", "items")
  assert.deepEqual(insert[0], [
    "insert",
    [
      {
        id,
        session_id: "s1",
        text: "Looks wrong",
        annotations: [{ id: "a" }],
        context: { lines: [] },
        screenshot_path: `s1/${id}.webp`,
        image_size: { width: 800, height: 600, scale: 1 },
      },
    ],
  ])
})

test("registerProgram inserts with a fresh share id and the owner", async () => {
  const { client, store: s } = store(
    { "from:programs": record => ({ data: { id: "p1", ...record.steps[0][1][0] }, error: null }) },
    { user: { id: "dev-1" } },
  )
  const program = await s.registerProgram({ gtKey: " abc1234 ", label: "Sleep" })
  assert.equal(program.gt_key, "abc1234")
  assert.match(program.share_id, /^[A-Za-z0-9]{24}$/)
  assert.equal(client.stepsOf("from", "programs")[0][0][1][0].owner_id, "dev-1")
})

test("listSessions derives item counts from the nested items", async () => {
  const { store: s } = store({
    "from:sessions": {
      data: [
        { id: "s1", items: [{ id: "i1", resolved_at: null }, { id: "i2", resolved_at: "2026-10-16T00:00:00Z" }] },
        { id: "s2", items: [] },
      ],
      error: null,
    },
  })
  const sessions = await s.listSessions("p1")
  assert.deepEqual(sessions.map(x => [x.id, x.item_count, x.unresolved_count]), [["s1", 2, 1], ["s2", 0, 0]])
})

test("deleteSession removes the screenshots in its folder before the row", async () => {
  const { client, store: s } = store({
    "storage:screenshots": record =>
      record.steps[0][0] === "list" ? { data: [{ name: "a.webp" }, { name: "b.webp" }], error: null } : { data: [], error: null },
    "from:sessions": { data: null, error: null },
  })
  await s.deleteSession("s1")
  const storageSteps = client.stepsOf("storage", "screenshots")
  assert.deepEqual(storageSteps[0][0], ["list", ["s1"]])
  assert.deepEqual(storageSteps[1][0], ["remove", [["s1/a.webp", "s1/b.webp"]]])
  const [rowSteps] = client.stepsOf("from", "sessions")
  assert.deepEqual(rowSteps, [["delete", []], ["eq", ["id", "s1"]]])
})

test("setResolved writes or clears resolved_at", async () => {
  const { client, store: s } = store({ "from:items": { data: null, error: null } })
  await s.setResolved("i1", true)
  await s.setResolved("i1", false)
  const [first, second] = client.stepsOf("from", "items")
  assert.equal(first[0][0], "update")
  assert.match(first[0][1][0].resolved_at, /^\d{4}-/)
  assert.deepEqual(second[0], ["update", [{ resolved_at: null }]])
})

test("signInWithProvider passes the provider and redirect", async () => {
  const { client, store: s } = store({})
  await s.signInWithProvider("google", "https://example.test/?dev")
  const call = client.calls.find(c => c.name === "signInWithOAuth")
  assert.deepEqual(call.steps[0][1][0], { provider: "google", options: { redirectTo: "https://example.test/?dev" } })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test:unit`
Expected: FAIL, cannot find `src/store.js`.

- [ ] **Step 4: Write the store**

`src/store.js`:

```js
import { createClient } from "@supabase/supabase-js"
import { newShareId } from "./share-id.js"

export const SCREENSHOT_BUCKET = "screenshots"

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

export function createStore({ url, anonKey, client = createClient(url, anonKey) }) {
  async function currentUser() {
    const { data } = await client.auth.getSession()
    return data.session ? data.session.user : null
  }

  async function requireUser() {
    const user = await currentUser()
    if (!user) throw new Error("Not signed in")
    return user
  }

  return {
    client,

    // Auth
    async signInAnonymously() {
      const existing = await currentUser()
      if (existing) return existing
      return unwrap(await client.auth.signInAnonymously()).user
    },
    getUser: currentUser,
    async signInWithProvider(provider, redirectTo) {
      unwrap(await client.auth.signInWithOAuth({ provider, options: { redirectTo } }))
    },
    async signOut() {
      unwrap(await client.auth.signOut())
    },
    onAuthChange(fn) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        fn(session ? session.user : null)
      })
      return data.subscription
    },

    // Reviewer side
    async resolveShare(shareId) {
      const rows = unwrap(await client.rpc("resolve_share", { share: shareId })) || []
      return rows.length ? { programId: rows[0].program_id, gtKey: rows[0].gt_key } : null
    },
    async createSession({ programId, shareId, mode, reviewerName = "", userAgent, viewport }) {
      const user = await requireUser()
      const row = unwrap(
        await client
          .from("sessions")
          .insert({
            program_id: programId,
            share_id: shareId,
            reviewer_uid: user.id,
            reviewer_name: reviewerName,
            mode,
            user_agent: userAgent,
            viewport,
          })
          .select("id")
          .single(),
      )
      return row.id
    },
    async touchSession(sessionId, { reviewerName } = {}) {
      const patch = { last_seen_at: new Date().toISOString() }
      if (reviewerName !== undefined) patch.reviewer_name = reviewerName
      unwrap(await client.from("sessions").update(patch).eq("id", sessionId))
    },
    async sendItem(sessionId, item) {
      const id = crypto.randomUUID()
      const path = `${sessionId}/${id}.webp`
      unwrap(
        await client.storage
          .from(SCREENSHOT_BUCKET)
          .upload(path, item.image.blob, { contentType: item.image.blob.type || "image/webp", upsert: false }),
      )
      unwrap(
        await client.from("items").insert({
          id,
          session_id: sessionId,
          text: item.text,
          annotations: item.annotations,
          context: item.context,
          screenshot_path: path,
          image_size: { width: item.image.width, height: item.image.height, scale: item.image.scale },
        }),
      )
      return id
    },

    // Developer side
    async listPrograms() {
      return unwrap(await client.from("program_overview").select("*").order("created_at", { ascending: false })) || []
    },
    async getProgram(programId) {
      return unwrap(await client.from("program_overview").select("*").eq("id", programId).single())
    },
    async registerProgram({ gtKey, label }) {
      const user = await requireUser()
      return unwrap(
        await client
          .from("programs")
          .insert({ owner_id: user.id, gt_key: gtKey.trim(), label: (label || "").trim() || null, share_id: newShareId() })
          .select("*")
          .single(),
      )
    },
    async regenerateShare(programId) {
      const shareId = newShareId()
      unwrap(await client.from("programs").update({ share_id: shareId }).eq("id", programId))
      return shareId
    },
    async deleteProgram(programId) {
      const sessions = unwrap(await client.from("sessions").select("id").eq("program_id", programId)) || []
      for (const session of sessions) await this.deleteSession(session.id)
      unwrap(await client.from("programs").delete().eq("id", programId))
    },
    async listSessions(programId) {
      const rows =
        unwrap(
          await client
            .from("sessions")
            .select("*, items(id, resolved_at)")
            .eq("program_id", programId)
            .order("started_at", { ascending: false }),
        ) || []
      return rows.map(({ items = [], ...session }) => ({
        ...session,
        item_count: items.length,
        unresolved_count: items.filter(item => !item.resolved_at).length,
      }))
    },
    async getSession(sessionId) {
      return unwrap(await client.from("sessions").select("*, programs(gt_key, label)").eq("id", sessionId).single())
    },
    async listItems(sessionId) {
      return (
        unwrap(await client.from("items").select("*").eq("session_id", sessionId).order("created_at", { ascending: true })) || []
      )
    },
    async downloadScreenshot(path) {
      return unwrap(await client.storage.from(SCREENSHOT_BUCKET).download(path))
    },
    async setResolved(itemId, resolved) {
      unwrap(
        await client
          .from("items")
          .update({ resolved_at: resolved ? new Date().toISOString() : null })
          .eq("id", itemId),
      )
    },
    async deleteSession(sessionId) {
      const objects = unwrap(await client.storage.from(SCREENSHOT_BUCKET).list(sessionId)) || []
      if (objects.length) {
        unwrap(await client.storage.from(SCREENSHOT_BUCKET).remove(objects.map(o => `${sessionId}/${o.name}`)))
      }
      unwrap(await client.from("sessions").delete().eq("id", sessionId))
    },
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:unit`
Expected: PASS. If the `createSession` test fails on `reviewer_uid`, the fake's `getSession` must return the seeded user; check `authState`.

- [ ] **Step 6: Commit**

```bash
npm run format
git add src/store.js test/fixtures/fake-supabase.js test/unit/store.test.js
git commit -m "Add the Supabase store with unit tests against a recording fake client

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: In-memory fake store for screen tests, and the live integration test

**Files:**
- Create: `test/fixtures/fake-store.js`, `test/browser/store-live.test.js`
- Modify: `test/fixtures/entry.js` (export `createFakeStore` and `createStore`)

**Interfaces:**
- Produces: `createFakeStore(seed) → store` implementing every method of Task 5's store in memory, plus `state` (`{ user, programs, sessions, items, screenshots }`) and `calls` (method name list) for assertions. `signInWithProvider` sets `state.user = { id: "dev-1", email: "dev@example.com", is_anonymous: false }` and calls `onAuthChange` listeners. Seeds: `seed.programs`, `seed.sessions`, `seed.items`, `seed.user`.

- [ ] **Step 1: Write the fake store**

`test/fixtures/fake-store.js`:

```js
// In-memory stand-in for src/store.js so screen tests never touch the network.
// Row shapes mirror the database columns.
export function createFakeStore(seed = {}) {
  const state = {
    user: seed.user ?? null,
    programs: seed.programs ?? [],
    sessions: seed.sessions ?? [],
    items: seed.items ?? [],
    screenshots: new Map(),
  }
  const calls = []
  const listeners = []
  let counter = 0
  const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`
  const now = () => new Date().toISOString()
  const notify = () => listeners.forEach(fn => fn(state.user))
  const record = name => calls.push(name)

  const overview = program => {
    const sessions = state.sessions.filter(s => s.program_id === program.id)
    const sessionIds = new Set(sessions.map(s => s.id))
    const unresolved = state.items.filter(i => sessionIds.has(i.session_id) && !i.resolved_at).length
    return { ...program, session_count: sessions.length, unresolved_count: unresolved }
  }

  const store = {
    state,
    calls,
    async signInAnonymously() {
      record("signInAnonymously")
      if (!state.user) state.user = { id: "anon-1", is_anonymous: true }
      return state.user
    },
    async getUser() {
      return state.user
    },
    async signInWithProvider(provider, redirectTo) {
      record(`signInWithProvider:${provider}:${redirectTo}`)
      state.user = { id: "dev-1", email: "dev@example.com", is_anonymous: false }
      notify()
    },
    async signOut() {
      record("signOut")
      state.user = null
      notify()
    },
    onAuthChange(fn) {
      listeners.push(fn)
      return { unsubscribe: () => listeners.splice(listeners.indexOf(fn), 1) }
    },
    async resolveShare(shareId) {
      record(`resolveShare:${shareId}`)
      const program = state.programs.find(p => p.share_id === shareId)
      return program ? { programId: program.id, gtKey: program.gt_key } : null
    },
    async createSession({ programId, shareId, mode, reviewerName = "", userAgent, viewport }) {
      record("createSession")
      const session = {
        id: uuid(),
        program_id: programId,
        share_id: shareId,
        reviewer_uid: state.user.id,
        reviewer_name: reviewerName,
        mode,
        user_agent: userAgent,
        viewport,
        started_at: now(),
        last_seen_at: now(),
      }
      state.sessions.push(session)
      return session.id
    },
    async touchSession(sessionId, { reviewerName } = {}) {
      record(`touchSession:${reviewerName ?? ""}`)
      const session = state.sessions.find(s => s.id === sessionId)
      session.last_seen_at = now()
      if (reviewerName !== undefined) session.reviewer_name = reviewerName
    },
    async sendItem(sessionId, item) {
      record("sendItem")
      const id = uuid()
      const path = `${sessionId}/${id}.webp`
      state.screenshots.set(path, item.image.blob)
      state.items.push({
        id,
        session_id: sessionId,
        created_at: now(),
        text: item.text,
        annotations: item.annotations,
        context: item.context,
        screenshot_path: path,
        image_size: { width: item.image.width, height: item.image.height, scale: item.image.scale },
        resolved_at: null,
      })
      return id
    },
    async listPrograms() {
      record("listPrograms")
      return state.programs.map(overview)
    },
    async getProgram(programId) {
      return overview(state.programs.find(p => p.id === programId))
    },
    async registerProgram({ gtKey, label }) {
      record("registerProgram")
      const program = {
        id: uuid(),
        owner_id: state.user.id,
        gt_key: gtKey.trim(),
        label: (label || "").trim() || null,
        share_id: "S".repeat(24),
        created_at: now(),
      }
      state.programs.push(program)
      return program
    },
    async regenerateShare(programId) {
      record("regenerateShare")
      const program = state.programs.find(p => p.id === programId)
      program.share_id = "R".repeat(24)
      return program.share_id
    },
    async deleteProgram(programId) {
      record("deleteProgram")
      state.programs = state.programs.filter(p => p.id !== programId)
    },
    async listSessions(programId) {
      record("listSessions")
      return state.sessions
        .filter(s => s.program_id === programId)
        .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
        .map(s => {
          const items = state.items.filter(i => i.session_id === s.id)
          return { ...s, item_count: items.length, unresolved_count: items.filter(i => !i.resolved_at).length }
        })
    },
    async getSession(sessionId) {
      const session = state.sessions.find(s => s.id === sessionId)
      const program = state.programs.find(p => p.id === session.program_id)
      return { ...session, programs: { gt_key: program.gt_key, label: program.label } }
    },
    async listItems(sessionId) {
      record("listItems")
      return state.items.filter(i => i.session_id === sessionId)
    },
    async downloadScreenshot(path) {
      record("downloadScreenshot")
      return state.screenshots.get(path)
    },
    async setResolved(itemId, resolved) {
      record(`setResolved:${resolved}`)
      state.items.find(i => i.id === itemId).resolved_at = resolved ? now() : null
    },
    async deleteSession(sessionId) {
      record("deleteSession")
      state.sessions = state.sessions.filter(s => s.id !== sessionId)
      state.items = state.items.filter(i => i.session_id !== sessionId)
    },
  }
  return store
}
```

- [ ] **Step 2: Write the live integration test**

`test/browser/store-live.test.js` (runs only when `HARNESS_SUPABASE_URL` and `HARNESS_SUPABASE_ANON_KEY` are set; proves anonymous sign-in, share resolution, and that policies reject a forged session):

```js
import { test } from "node:test"
import assert from "node:assert/strict"
import { withPage } from "../helpers/browser.js"

const url = process.env.HARNESS_SUPABASE_URL
const anonKey = process.env.HARNESS_SUPABASE_ANON_KEY

test("the real project accepts anonymous reviewers and enforces the share policy", { skip: !url || !anonKey ? "HARNESS_SUPABASE_URL/ANON_KEY not set" : false }, async () => {
  await withPage(async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/test/fixtures/smoke.html`)
    await page.waitForFunction(() => window.harness !== undefined)
    const result = await page.evaluate(
      async ({ url, anonKey }) => {
        const store = window.harness.createStore({ url, anonKey })
        const user = await store.signInAnonymously()
        const unknown = await store.resolveShare("ZZZZZZZZZZZZZZZZZZZZZZZZ")
        let forged = "allowed"
        try {
          await store.createSession({ programId: "00000000-0000-4000-8000-000000000000", shareId: "ZZZZZZZZZZZZZZZZZZZZZZZZ", mode: "test" })
        } catch (error) {
          forged = error.code || error.message
        }
        return { anonymous: user.is_anonymous === true, unknown, forged }
      },
      { url, anonKey },
    )
    assert.equal(result.anonymous, true)
    assert.equal(result.unknown, null)
    assert.notEqual(result.forged, "allowed")
  })
})
```

Add to `test/fixtures/entry.js`: `import { createStore } from "../../src/store.js"`, `import { createFakeStore } from "./fake-store.js"`, and both on `window.harness`.

- [ ] **Step 3: Run the live test against the project**

Run: `HARNESS_SUPABASE_URL=<url> HARNESS_SUPABASE_ANON_KEY=<anon key> npm run test:browser`
Expected: the live test PASSES (`forged` is `42501` or a row-level security message), everything else unchanged. Without the variables it reports as skipped. Note: anonymous sign-ins are rate-limited to 30 per hour per IP, so do not loop this test.

- [ ] **Step 4: Commit**

```bash
npm run format
git add test/fixtures/fake-store.js test/fixtures/entry.js test/browser/store-live.test.js
git commit -m "Add an in-memory fake store and a network-gated live store test

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Router for Phase 2 routes

**Files:**
- Modify: `src/router.js`, `test/unit/router.test.js`

**Interfaces:**
- Produces: `parseRoute(search) → { screen: "reviewer", shareId, mode } | { screen: "session", sessionId } | { screen: "inbox", programId } | { screen: "developer" }`.

- [ ] **Step 1: Replace the tests**

`test/unit/router.test.js`:

```js
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseRoute } from "../../src/router.js"

test("no parameters and ?dev route to the developer screen", () => {
  assert.deepEqual(parseRoute(""), { screen: "developer" })
  assert.deepEqual(parseRoute("?dev"), { screen: "developer" })
  assert.deepEqual(parseRoute("?code=oauth-code"), { screen: "developer" })
})

test("r routes to the reviewer screen, run mode unless mode=test", () => {
  assert.deepEqual(parseRoute("?r=ABC&mode=test"), { screen: "reviewer", shareId: "ABC", mode: "test" })
  assert.deepEqual(parseRoute("?r=ABC"), { screen: "reviewer", shareId: "ABC", mode: "run" })
  assert.deepEqual(parseRoute("?r=ABC&mode=banana&__gt_embed=tok"), { screen: "reviewer", shareId: "ABC", mode: "run" })
  assert.deepEqual(parseRoute("?r=%20%20"), { screen: "developer" })
})

test("program and session route to the inbox and session screens", () => {
  assert.deepEqual(parseRoute("?dev&program=p1"), { screen: "inbox", programId: "p1" })
  assert.deepEqual(parseRoute("?session=s1"), { screen: "session", sessionId: "s1" })
})

test("the Phase 1 key route is gone", () => {
  assert.deepEqual(parseRoute("?key=abc1234&mode=test"), { screen: "developer" })
})
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npm run test:unit`
Expected: FAIL on the reviewer, inbox, session, and key-route tests.

- [ ] **Step 3: Rewrite the router**

`src/router.js`:

```js
export function parseRoute(search) {
  const params = new URLSearchParams(search)
  const value = name => (params.get(name) || "").trim()

  const sessionId = value("session")
  if (sessionId) return { screen: "session", sessionId }

  const shareId = value("r")
  if (shareId) {
    return { screen: "reviewer", shareId, mode: params.get("mode") === "test" ? "test" : "run" }
  }

  const programId = value("program")
  if (programId) return { screen: "inbox", programId }

  return { screen: "developer" }
}
```

- [ ] **Step 4: Run to verify they pass, then commit**

Run: `npm run test:unit`
Expected: PASS.

Delete `test/browser/home.test.js`: it drove the Phase 1 key form, which no longer routes anywhere (Task 11 removes the form itself). Run `npm run test:browser` and confirm the whole browser suite is green.

```bash
npm run format
git add src/router.js test/unit/router.test.js
git rm -q test/browser/home.test.js
git commit -m "Route share links, the inbox, and session views by query string

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Reviewer flow: share link to session to stored items

**Files:**
- Create: `src/screens/banners.js`, `src/screens/reviewer-flow.js`, `test/fixtures/reviewer-flow.html`, `test/browser/reviewer-flow.test.js`
- Modify: `src/screens/reviewer.js` (import banners from `banners.js`; keep its exports re-exported for the existing tests), `test/fixtures/entry.js`

**Interfaces:**
- Consumes: `mountReviewer({ root, route: { key, mode }, sendFeedback, assetBase, storage, capture })` (Phase 1, unchanged), store methods `signInAnonymously`, `resolveShare`, `createSession`, `touchSession`, `sendItem`.
- Produces: `runReviewer({ root, route: { shareId, mode }, store, assetBase, storage = window.localStorage, session = window.sessionStorage, heartbeatMs = 60000 }) → Promise<void>`; `renderErrorBanner(root, message)`, `renderRefusalBanner(root, url)`, `renderInvalidLinkBanner(root)` in `banners.js`; `SESSION_KEY(shareId) = "harness:session:" + shareId`.

- [ ] **Step 1: Move the banners**

Create `src/screens/banners.js` containing `harnessPageUrl`, `renderRefusalBanner`, and `renderErrorBanner` exactly as they exist in `src/screens/reviewer.js` today, plus:

```js
export function renderInvalidLinkBanner(root) {
  root.innerHTML = `
    <div class="harness-banner" role="alert">
      <h2>This feedback link isn't valid</h2>
      <p class="harness-message">The link may have been regenerated or the program removed. Ask the developer for a new link.</p>
    </div>`
}
```

In `src/screens/reviewer.js`, replace the three definitions with `import { harnessPageUrl, renderRefusalBanner, renderErrorBanner } from "./banners.js"` and add `export { harnessPageUrl, renderRefusalBanner, renderErrorBanner }` so `test/unit/reviewer.test.js` and the fixtures keep working.

- [ ] **Step 2: Write the fixture and the failing tests**

`test/fixtures/reviewer-flow.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="/test/fixtures/build/entry.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module">
      import "/test/fixtures/build/entry.js"
      window.store = window.harness.createFakeStore({
        programs: [{ id: "p-1", owner_id: "dev-1", gt_key: "abc1234", label: "Demo", share_id: "SHARESHARESHARESHARESHAR", created_at: "2026-10-16T00:00:00Z" }],
      })
      window.run = (shareId, mode = "test") =>
        window.harness.runReviewer({
          root: document.getElementById("app"),
          route: { screen: "reviewer", shareId, mode },
          store: window.store,
          assetBase: "/test/fixtures/gt-stub",
          heartbeatMs: 200,
        })
      window.fixtureReady = true
    </script>
  </body>
</html>
```

`test/browser/reviewer-flow.test.js`:

```js
import { test } from "node:test"
import assert from "node:assert/strict"
import { withPage } from "../helpers/browser.js"

async function open(page, baseUrl, shareId, mode) {
  await page.goto(`${baseUrl}/test/fixtures/reviewer-flow.html`)
  await page.waitForFunction(() => window.fixtureReady === true)
  await page.evaluate(({ shareId, mode }) => window.run(shareId, mode), { shareId, mode })
}

test("a valid link signs in anonymously, creates a session, and stores sent items", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl, "SHARESHARESHARESHARESHAR", "test")
    await page.waitForSelector(".program_container .main p")
    const session = await page.evaluate(() => window.store.state.sessions[0])
    assert.equal(session.program_id, "p-1")
    assert.equal(session.mode, "test")
    assert.equal(session.reviewer_uid, "anon-1")
    assert.equal(await page.evaluate(() => sessionStorage.getItem("harness:session:SHARESHARESHARESHARESHAR")), session.id)

    await page.fill(".harness-name input", "Alice")
    await page.press(".harness-name input", "Tab")
    await page.click(".harness-feedback-button")
    await page.waitForSelector(".harness-modal")
    await page.fill(".harness-text", "Button is misaligned")
    await page.click('[data-action="send"]')
    await page.waitForSelector(".harness-modal", { state: "detached" })

    const stored = await page.evaluate(() => ({
      items: window.store.state.items,
      sessions: window.store.state.sessions,
      screenshots: Array.from(window.store.state.screenshots.keys()),
    }))
    assert.equal(stored.items.length, 1)
    assert.equal(stored.items[0].text, "Button is misaligned")
    assert.equal(stored.items[0].context.runId, "run-123")
    assert.equal(stored.items[0].screenshot_path, stored.screenshots[0])
    assert.equal(stored.sessions[0].reviewer_name, "Alice")
  })
})

test("the heartbeat updates last_seen_at", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl, "SHARESHARESHARESHARESHAR", "run")
    await page.waitForSelector(".program_container .main p")
    const before = await page.evaluate(() => window.store.state.sessions[0].last_seen_at)
    await page.waitForFunction(b => window.store.state.sessions[0].last_seen_at !== b, before, { timeout: 5000 })
    assert.ok(await page.evaluate(() => window.store.calls.filter(c => c.startsWith("touchSession")).length >= 1))
  })
})

test("a reload reuses the session instead of creating a second one", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl, "SHARESHARESHARESHARESHAR", "run")
    await page.waitForSelector(".program_container .main p")
    await page.evaluate(() => {
      window.harness.runReviewer({
        root: document.getElementById("app"),
        route: { screen: "reviewer", shareId: "SHARESHARESHARESHARESHAR", mode: "run" },
        store: window.store,
        assetBase: "/test/fixtures/gt-stub",
      })
    })
    await page.waitForSelector(".program_container .main p")
    assert.equal(await page.evaluate(() => window.store.state.sessions.length), 1)
  })
})

test("an unknown link shows the invalid-link banner and no program", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl, "NOPENOPENOPENOPENOPENOPE", "test")
    await page.waitForSelector(".harness-banner")
    assert.match(await page.locator(".harness-banner h2").innerText(), /isn't valid/)
    assert.equal(await page.locator(".program_container").count(), 0)
    assert.equal(await page.evaluate(() => window.store.state.sessions.length), 0)
  })
})
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm run test:browser`
Expected: FAIL, `runReviewer is not a function`.

- [ ] **Step 4: Write the flow and export it**

`src/screens/reviewer-flow.js`:

```js
import { mountReviewer, NAME_KEY } from "./reviewer.js"
import { renderInvalidLinkBanner, renderErrorBanner } from "./banners.js"

export const SESSION_KEY = shareId => `harness:session:${shareId}`

function readName(storage) {
  try {
    return storage.getItem(NAME_KEY) || ""
  } catch {
    return ""
  }
}

// Signs the reviewer in anonymously, turns the share id into a program key,
// creates (or resumes) the session row, and mounts the Phase 1 reviewer
// screen with a sendFeedback that stores items under that session.
export async function runReviewer({
  root,
  route,
  store,
  assetBase,
  storage = window.localStorage,
  session = window.sessionStorage,
  heartbeatMs = 60000,
}) {
  try {
    await store.signInAnonymously()
  } catch (error) {
    renderErrorBanner(root, `The feedback backend is unavailable: ${error.message}. Tell the developer.`)
    return
  }

  const resolved = await store.resolveShare(route.shareId)
  if (!resolved) {
    renderInvalidLinkBanner(root)
    return
  }

  let sessionId = null
  try {
    sessionId = session.getItem(SESSION_KEY(route.shareId))
  } catch {
    sessionId = null
  }
  if (!sessionId) {
    sessionId = await store.createSession({
      programId: resolved.programId,
      shareId: route.shareId,
      mode: route.mode,
      reviewerName: readName(storage),
      userAgent: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    })
    try {
      session.setItem(SESSION_KEY(route.shareId), sessionId)
    } catch {
      // Storage blocked: a reload will start a new session, which is acceptable.
    }
  }

  const heartbeat = setInterval(() => {
    store.touchSession(sessionId).catch(() => {})
  }, heartbeatMs)
  window.addEventListener("pagehide", () => clearInterval(heartbeat), { once: true })

  await mountReviewer({
    root,
    route: { key: resolved.gtKey, mode: route.mode },
    assetBase,
    storage,
    sendFeedback: async item => {
      await store.touchSession(sessionId, { reviewerName: item.reviewerName || "" })
      await store.sendItem(sessionId, item)
    },
  })
}
```

Add `runReviewer` (from `../../src/screens/reviewer-flow.js`) to `test/fixtures/entry.js`.

- [ ] **Step 5: Run to verify they pass, then commit**

Run: `npm run test:browser`
Expected: the four new tests PASS; existing reviewer tests still pass. If the heartbeat test times out, confirm the fixture passes `heartbeatMs: 200`.

```bash
npm run format
git add src/screens/banners.js src/screens/reviewer.js src/screens/reviewer-flow.js test/fixtures/reviewer-flow.html test/fixtures/entry.js test/browser/reviewer-flow.test.js
git commit -m "Turn share links into sessions and store sent feedback items

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Developer screen: sign-in, programs, links

**Files:**
- Create: `src/screens/developer.js`, `test/fixtures/developer.html`, `test/browser/developer.test.js`
- Modify: `src/styles.css`, `test/fixtures/entry.js`

**Interfaces:**
- Consumes: store methods `getUser`, `onAuthChange`, `signInWithProvider`, `signOut`, `listPrograms`, `registerProgram`, `regenerateShare`, `deleteProgram`; `harnessPageUrl` (banners.js); `programLabel` (format.js); `OAUTH_PROVIDER` (config.js).
- Produces: `mountDeveloper({ root, store, provider = OAUTH_PROVIDER, pageUrl = harnessPageUrl(), confirm = window.confirm }) → Promise<void>`; `withDeveloper({ root, store, render })` (gate shared with Tasks 10): renders the sign-in prompt unless the user is a non-anonymous account, then calls `render(user)`, and re-runs on auth changes; `shareLinks(pageUrl, shareId) → { run, test }` (pure, exported).

- [ ] **Step 1: Write the fixture and the failing tests**

`test/fixtures/developer.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="/test/fixtures/build/entry.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module">
      import "/test/fixtures/build/entry.js"
      window.store = window.harness.createFakeStore({
        programs: [{ id: "p-1", owner_id: "dev-1", gt_key: "abc1234", label: "Demo", share_id: "SHARESHARESHARESHARESHAR", created_at: "2026-10-16T00:00:00Z" }],
        sessions: [{ id: "s-1", program_id: "p-1", share_id: "SHARESHARESHARESHARESHAR", reviewer_uid: "anon-1", reviewer_name: "Alice", mode: "test", started_at: "2026-10-16T01:00:00Z", last_seen_at: "2026-10-16T01:05:00Z" }],
        items: [{ id: "i-1", session_id: "s-1", created_at: "2026-10-16T01:02:00Z", text: "x", annotations: [], context: {}, screenshot_path: null, resolved_at: null }],
      })
      window.mount = () =>
        window.harness.mountDeveloper({
          root: document.getElementById("app"),
          store: window.store,
          pageUrl: "https://example.test/harness/",
        })
      window.fixtureReady = true
    </script>
  </body>
</html>
```

`test/browser/developer.test.js`:

```js
import { test } from "node:test"
import assert from "node:assert/strict"
import { withPage } from "../helpers/browser.js"

async function open(page, baseUrl) {
  await page.goto(`${baseUrl}/test/fixtures/developer.html`)
  await page.waitForFunction(() => window.fixtureReady === true)
  await page.evaluate(() => window.mount())
}

test("signed out shows the sign-in prompt and signing in lists programs with counts", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.waitForSelector(".harness-signin")
    assert.equal(await page.locator(".harness-program-card").count(), 0)
    await page.click(".harness-signin button")
    await page.waitForSelector(".harness-program-card")
    assert.equal(await page.evaluate(() => window.store.calls.find(c => c.startsWith("signInWithProvider"))), "signInWithProvider:google:https://example.test/harness/?dev")
    assert.match(await page.locator(".harness-program-card h3").innerText(), /Demo/)
    assert.match(await page.locator(".harness-program-card .harness-counts").innerText(), /1 session.*1 unresolved/s)
    assert.match(await page.locator(".harness-setup-url").innerText(), /^https:\/\/example\.test\/harness\/$/)
  })
})

test("the card shows run and test links built from the share id", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.click(".harness-signin button")
    await page.waitForSelector(".harness-program-card")
    const links = await page.locator(".harness-program-card .harness-link input").evaluateAll(els => els.map(e => e.value))
    assert.deepEqual(links, [
      "https://example.test/harness/?r=SHARESHARESHARESHARESHAR&mode=run",
      "https://example.test/harness/?r=SHARESHARESHARESHARESHAR&mode=test",
    ])
    assert.equal(await page.locator('.harness-program-card a[href="?dev&program=p-1"]').count(), 1)
  })
})

test("registering a program adds a card, regenerating changes links, deleting removes it", async () => {
  await withPage(async ({ page, baseUrl }) => {
    page.on("dialog", dialog => dialog.accept())
    await open(page, baseUrl)
    await page.click(".harness-signin button")
    await page.waitForSelector(".harness-program-card")

    await page.fill('.harness-register input[name="key"]', "zzz9999")
    await page.fill('.harness-register input[name="label"]', "New one")
    await page.click('.harness-register button[type="submit"]')
    await page.waitForFunction(() => document.querySelectorAll(".harness-program-card").length === 2)
    const newCard = page.locator(".harness-program-card", { hasText: "New one" })
    assert.match(await newCard.locator(".harness-link input").first().inputValue(), /\?r=SSSSSSSSSSSSSSSSSSSSSSSS&mode=run$/)

    await newCard.locator('[data-action="regenerate"]').click()
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll(".harness-link input")).some(i => i.value.includes("RRRRRRRRRRRRRRRRRRRRRRRR")),
    )
    assert.match(await newCard.locator(".harness-link input").first().inputValue(), /\?r=RRRRRRRRRRRRRRRRRRRRRRRR&mode=run$/)

    await newCard.locator('[data-action="delete"]').click()
    await page.waitForFunction(() => document.querySelectorAll(".harness-program-card").length === 1)
    assert.ok(await page.evaluate(() => window.store.calls.includes("deleteProgram")))
  })
})

test("sign out returns to the prompt", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.click(".harness-signin button")
    await page.waitForSelector(".harness-program-card")
    await page.click('[data-action="signout"]')
    await page.waitForSelector(".harness-signin")
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:browser`
Expected: FAIL, `mountDeveloper is not a function`.

- [ ] **Step 3: Write the screen**

`src/screens/developer.js`:

```js
import { OAUTH_PROVIDER } from "../config.js"
import { harnessPageUrl, renderErrorBanner } from "./banners.js"
import { programLabel } from "../format.js"

export function shareLinks(pageUrl, shareId) {
  const base = `${pageUrl}?r=${encodeURIComponent(shareId)}&mode=`
  return { run: `${base}run`, test: `${base}test` }
}

function isDeveloper(user) {
  return Boolean(user) && user.is_anonymous !== true
}

// Shared gate for the developer, inbox, and session screens. Screens
// re-mount themselves after changes, so the auth listener is bound once per
// root and always calls the most recent render.
const gates = new WeakMap()

export async function withDeveloper(options) {
  const { root, store } = options
  gates.set(root, options)
  if (!root.dataset.harnessAuthBound) {
    root.dataset.harnessAuthBound = "true"
    store.onAuthChange(() => {
      show(gates.get(root)).catch(error => renderErrorBanner(root, error.message))
    })
  }
  await show(options)
}

async function show({ root, store, render, provider = OAUTH_PROVIDER, pageUrl = harnessPageUrl() }) {
  const user = await store.getUser()
  if (!isDeveloper(user)) {
    renderSignIn(root, () => store.signInWithProvider(provider, `${pageUrl}?dev`))
    return
  }
  await render(user)
}

function renderSignIn(root, onSignIn) {
  root.innerHTML = `
    <main class="harness-home harness-signin">
      <h1>GuidedTrack Feedback Harness</h1>
      <p>Developers sign in to register programs and read feedback. Reviewers never sign in; they just open the links you give them.</p>
      <button type="button">Sign in with Google</button>
    </main>`
  root.querySelector("button").addEventListener("click", () => {
    onSignIn().catch(error => renderErrorBanner(root, error.message))
  })
}

export async function mountDeveloper({
  root,
  store,
  provider = OAUTH_PROVIDER,
  pageUrl = harnessPageUrl(),
  confirm = message => window.confirm(message),
}) {
  await withDeveloper({
    root,
    store,
    provider,
    pageUrl,
    render: async user => {
      const programs = await store.listPrograms()
      root.innerHTML = `
        <main class="harness-home harness-developer">
          <header class="harness-dev-header">
            <h1>Your programs</h1>
            <span class="harness-user"></span>
            <button type="button" data-action="signout">Sign out</button>
          </header>
          <p>Before a link works, add this URL to the program's <strong>Publish</strong> page on GuidedTrack, under the pages allowed to run it:</p>
          <pre class="harness-setup-url"></pre>
          <form class="harness-register">
            <label>GuidedTrack key <input name="key" required pattern="[A-Za-z0-9]+" placeholder="abc1234" autocomplete="off" /></label>
            <label>Label (optional) <input name="label" placeholder="Sleep study v2" /></label>
            <button type="submit">Register program</button>
            <p class="harness-error" hidden></p>
          </form>
          <section class="harness-programs"></section>
        </main>`
      root.querySelector(".harness-user").textContent = user.email || ""
      root.querySelector(".harness-setup-url").textContent = pageUrl
      root.querySelector('[data-action="signout"]').addEventListener("click", () => store.signOut())

      const form = root.querySelector(".harness-register")
      form.addEventListener("submit", async event => {
        event.preventDefault()
        const data = new FormData(form)
        const error = form.querySelector(".harness-error")
        try {
          await store.registerProgram({ gtKey: String(data.get("key")), label: String(data.get("label") || "") })
          await mountDeveloper({ root, store, provider, pageUrl, confirm })
        } catch (failure) {
          error.textContent = failure.message
          error.hidden = false
        }
      })

      const list = root.querySelector(".harness-programs")
      for (const program of programs) list.appendChild(programCard(program))
      if (programs.length === 0) {
        const empty = document.createElement("p")
        empty.textContent = "No programs yet. Register one above to get its feedback links."
        list.appendChild(empty)
      }

      function programCard(program) {
        const card = document.createElement("article")
        card.className = "harness-program-card"
        const links = shareLinks(pageUrl, program.share_id)
        card.innerHTML = `
          <h3></h3>
          <p class="harness-counts"></p>
          <label class="harness-link"><span>Run link</span><input type="text" readonly /><button type="button" data-copy="run">Copy</button></label>
          <label class="harness-link"><span>Test link</span><input type="text" readonly /><button type="button" data-copy="test">Copy</button></label>
          <p class="harness-card-actions">
            <a></a>
            <button type="button" data-action="regenerate">Regenerate links</button>
            <button type="button" data-action="delete">Delete program</button>
          </p>`
        card.querySelector("h3").textContent = `${programLabel(program)} (${program.gt_key})`
        card.querySelector(".harness-counts").textContent =
          `${program.session_count} session${program.session_count === 1 ? "" : "s"}, ${program.unresolved_count} unresolved item${program.unresolved_count === 1 ? "" : "s"}`
        const inputs = card.querySelectorAll(".harness-link input")
        inputs[0].value = links.run
        inputs[1].value = links.test
        for (const button of card.querySelectorAll("[data-copy]")) {
          button.addEventListener("click", async () => {
            const value = button.dataset.copy === "run" ? links.run : links.test
            try {
              await navigator.clipboard.writeText(value)
              button.textContent = "Copied"
              setTimeout(() => (button.textContent = "Copy"), 1500)
            } catch {
              inputs[button.dataset.copy === "run" ? 0 : 1].select()
            }
          })
        }
        const inbox = card.querySelector("a")
        inbox.href = `?dev&program=${encodeURIComponent(program.id)}`
        inbox.textContent = "Open inbox"
        card.querySelector('[data-action="regenerate"]').addEventListener("click", async () => {
          if (!confirm("Regenerate the links? The old links stop working immediately. Stored feedback is kept.")) return
          await store.regenerateShare(program.id)
          await mountDeveloper({ root, store, provider, pageUrl, confirm })
        })
        card.querySelector('[data-action="delete"]').addEventListener("click", async () => {
          if (!confirm(`Delete "${programLabel(program)}" and all its feedback? This cannot be undone.`)) return
          await store.deleteProgram(program.id)
          await mountDeveloper({ root, store, provider, pageUrl, confirm })
        })
        return card
      }
    },
  })
}
```

Append to `src/styles.css`:

```css
/* Developer screens */
.harness-dev-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.harness-dev-header h1 {
  flex: 1;
  margin: 0;
}

.harness-register {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
  margin: 16px 0 24px;
}

.harness-register label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}

.harness-register input {
  font: 15px system-ui, sans-serif;
  padding: 6px 8px;
  border: 1px solid #bbb;
  border-radius: 4px;
}

.harness-program-card {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 16px;
}

.harness-program-card h3 {
  margin: 0 0 4px;
}

.harness-link {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0;
  font-size: 13px;
}

.harness-link span {
  width: 64px;
}

.harness-link input {
  flex: 1;
  font: 13px monospace;
  padding: 4px 6px;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.harness-card-actions {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.harness-developer button,
.harness-signin button,
.harness-inbox button,
.harness-session button {
  font: 14px system-ui, sans-serif;
  padding: 6px 12px;
  border: 1px solid #bbb;
  border-radius: 6px;
  background: #f6f6f6;
  cursor: pointer;
}

.harness-signin button,
.harness-register button[type="submit"] {
  background: var(--harness-accent);
  border-color: var(--harness-accent);
  color: #fff;
}
```

Add `mountDeveloper` to `test/fixtures/entry.js`.

- [ ] **Step 4: Run to verify they pass, then commit**

Run: `npm run test:browser`
Expected: PASS. If the counts assertion fails, the fake store's `overview` counts sessions by `program_id`; confirm the fixture's session row uses `program_id: "p-1"`.

```bash
npm run format
git add src/screens/developer.js src/styles.css test/fixtures/developer.html test/fixtures/entry.js test/browser/developer.test.js
git commit -m "Add the developer screen: Google sign-in, program registration, and share links

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Inbox and session screens

**Files:**
- Create: `src/screens/inbox.js`, `src/screens/session.js`, `test/fixtures/inbox.html`, `test/browser/inbox.test.js`
- Modify: `src/styles.css`, `test/fixtures/entry.js`

**Interfaces:**
- Consumes: `withDeveloper` (Task 9), store methods `getProgram`, `listSessions`, `deleteSession`, `getSession`, `listItems`, `downloadScreenshot`, `setResolved`; `formatDate`, `formatDuration`, `formatLines`, `programLabel` (Task 4); `renderTree`, `toDom` (render.js, static mode); `flattenToPng` (flatten.js); `download` (download.js).
- Produces: `mountInbox({ root, store, programId, confirm })`, `mountSession({ root, store, sessionId })`.

- [ ] **Step 1: Write the fixture and the failing tests**

`test/fixtures/inbox.html` (seeds one program, two sessions, two items, one with a real screenshot blob):

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="/test/fixtures/build/entry.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module">
      import "/test/fixtures/build/entry.js"
      const canvas = document.createElement("canvas")
      canvas.width = 400
      canvas.height = 300
      canvas.getContext("2d").fillStyle = "#dddddd"
      canvas.getContext("2d").fillRect(0, 0, 400, 300)
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp"))
      window.store = window.harness.createFakeStore({
        user: { id: "dev-1", email: "dev@example.com", is_anonymous: false },
        programs: [{ id: "p-1", owner_id: "dev-1", gt_key: "abc1234", label: "Demo", share_id: "SHARESHARESHARESHARESHAR", created_at: "2026-10-16T00:00:00Z" }],
        sessions: [
          { id: "s-1", program_id: "p-1", share_id: "SHARESHARESHARESHARESHAR", reviewer_uid: "anon-1", reviewer_name: "Alice", mode: "test", user_agent: "UA", viewport: { width: 800, height: 600 }, started_at: "2026-10-16T01:00:00Z", last_seen_at: "2026-10-16T01:05:00Z" },
          { id: "s-2", program_id: "p-1", share_id: "SHARESHARESHARESHARESHAR", reviewer_uid: "anon-2", reviewer_name: "", mode: "run", started_at: "2026-10-16T02:00:00Z", last_seen_at: "2026-10-16T02:00:30Z" },
        ],
        items: [
          { id: "i-1", session_id: "s-1", created_at: "2026-10-16T01:02:00Z", text: "Button is misaligned", annotations: [{ id: "p", type: "pen", points: [[0, 150], [400, 150]] }], context: { lines: [{ from: 1, to: 3, program: "main" }], runId: "run-123", programName: "main", nodeId: "n1", variables: { name: "Alice", score: 42 }, variablesTruncated: false, viewport: { width: 800, height: 600 }, userAgent: "UA", capturedAt: "2026-10-16T01:02:00Z" }, screenshot_path: "s-1/i-1.webp", image_size: { width: 400, height: 300, scale: 1 }, resolved_at: null },
          { id: "i-2", session_id: "s-1", created_at: "2026-10-16T01:03:00Z", text: "Second", annotations: [], context: {}, screenshot_path: "s-1/i-2.webp", image_size: { width: 400, height: 300, scale: 1 }, resolved_at: "2026-10-16T01:04:00Z" },
        ],
      })
      window.store.state.screenshots.set("s-1/i-1.webp", blob)
      window.store.state.screenshots.set("s-1/i-2.webp", blob)
      window.mountInbox = () => window.harness.mountInbox({ root: document.getElementById("app"), store: window.store, programId: "p-1" })
      window.mountSession = id => window.harness.mountSession({ root: document.getElementById("app"), store: window.store, sessionId: id })
      window.fixtureReady = true
    </script>
  </body>
</html>
```

`test/browser/inbox.test.js`:

```js
import { test } from "node:test"
import assert from "node:assert/strict"
import { withPage } from "../helpers/browser.js"

async function open(page, baseUrl) {
  await page.goto(`${baseUrl}/test/fixtures/inbox.html`)
  await page.waitForFunction(() => window.fixtureReady === true)
}

test("the inbox lists sessions newest first with counts, filters, and deletes", async () => {
  await withPage(async ({ page, baseUrl }) => {
    page.on("dialog", dialog => dialog.accept())
    await open(page, baseUrl)
    await page.evaluate(() => window.mountInbox())
    await page.waitForSelector(".harness-inbox tbody tr")
    assert.match(await page.locator(".harness-inbox h1").innerText(), /Demo/)
    const rows = await page.locator(".harness-inbox tbody tr").allInnerTexts()
    assert.equal(rows.length, 2)
    assert.match(rows[0], /Anonymous.*run.*0 items/s)
    assert.match(rows[1], /Alice.*test.*5 min.*2 items \(1 unresolved\)/s)
    assert.equal(await page.locator('.harness-inbox a[href="?session=s-1"]').count(), 1)

    await page.check(".harness-inbox input[type=checkbox]")
    assert.equal(await page.locator(".harness-inbox tbody tr").count(), 1)
    await page.uncheck(".harness-inbox input[type=checkbox]")

    await page.locator('.harness-inbox tbody tr:nth-child(1) [data-action="delete"]').click()
    await page.waitForFunction(() => document.querySelectorAll(".harness-inbox tbody tr").length === 1)
    assert.ok(await page.evaluate(() => window.store.calls.includes("deleteSession")))
  })
})

test("the session view renders items with the annotated screenshot, text, context, resolve, and download", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await open(page, baseUrl)
    await page.evaluate(() => window.mountSession("s-1"))
    await page.waitForSelector(".harness-item img")
    assert.match(await page.locator(".harness-session h1").innerText(), /Demo/)
    assert.equal(await page.locator(".harness-item").count(), 2)

    const first = page.locator(".harness-item").first()
    assert.match(await first.locator(".harness-item-text").innerText(), /Button is misaligned/)
    assert.equal(await first.locator("svg[data-mode=static] g[data-type=pen] path").count(), 1)
    assert.match(await first.locator("details").innerText(), /main: lines 1-3/)
    assert.match(await first.locator("details").innerText(), /score.*42/s)
    assert.equal(await page.locator(".harness-item.harness-resolved").count(), 1)

    await first.locator('[data-action="resolve"]').click()
    await page.waitForFunction(() => document.querySelectorAll(".harness-item.harness-resolved").length === 2)
    assert.ok(await page.evaluate(() => window.store.calls.includes("setResolved:true")))

    const [downloadEvent] = await Promise.all([page.waitForEvent("download"), first.locator('[data-action="download"]').click()])
    assert.match(downloadEvent.suggestedFilename(), /^feedback-abc1234-i-1\.png$/)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:browser`
Expected: FAIL, `mountInbox is not a function`.

- [ ] **Step 3: Write the screens**

`src/screens/inbox.js`:

```js
import { withDeveloper } from "./developer.js"
import { formatDate, formatDuration, programLabel } from "../format.js"

export async function mountInbox({ root, store, programId, confirm = message => window.confirm(message) }) {
  await withDeveloper({
    root,
    store,
    render: async () => {
      const [program, sessions] = await Promise.all([store.getProgram(programId), store.listSessions(programId)])
      root.innerHTML = `
        <main class="harness-home harness-inbox">
          <p><a href="?dev">All programs</a></p>
          <h1></h1>
          <label><input type="checkbox" /> Only sessions with unresolved items</label>
          <table>
            <thead><tr><th>Reviewer</th><th>Mode</th><th>Started</th><th>Duration</th><th>Feedback</th><th></th></tr></thead>
            <tbody></tbody>
          </table>
          <p class="harness-empty" hidden>No sessions yet. Share the program's links to get feedback.</p>
        </main>`
      root.querySelector("h1").textContent = `${programLabel(program)} (${program.gt_key})`
      const tbody = root.querySelector("tbody")
      const filter = root.querySelector("input[type=checkbox]")

      function draw() {
        tbody.replaceChildren()
        const shown = filter.checked ? sessions.filter(s => s.unresolved_count > 0) : sessions
        root.querySelector(".harness-empty").hidden = shown.length > 0
        for (const session of shown) {
          const row = document.createElement("tr")
          row.innerHTML = `<td></td><td></td><td></td><td></td><td></td><td><a></a> <button type="button" data-action="delete">Delete</button></td>`
          const cells = row.querySelectorAll("td")
          cells[0].textContent = session.reviewer_name || "Anonymous"
          cells[1].textContent = session.mode
          cells[2].textContent = formatDate(session.started_at)
          cells[3].textContent = formatDuration(session.started_at, session.last_seen_at)
          cells[4].textContent =
            `${session.item_count} item${session.item_count === 1 ? "" : "s"}` +
            (session.unresolved_count ? ` (${session.unresolved_count} unresolved)` : "")
          const open = row.querySelector("a")
          open.href = `?session=${encodeURIComponent(session.id)}`
          open.textContent = "Open"
          row.querySelector('[data-action="delete"]').addEventListener("click", async () => {
            if (!confirm("Delete this session and its feedback? This cannot be undone.")) return
            await store.deleteSession(session.id)
            sessions.splice(sessions.indexOf(session), 1)
            draw()
          })
          tbody.appendChild(row)
        }
      }
      filter.addEventListener("change", draw)
      draw()
    },
  })
}
```

`src/screens/session.js`:

```js
import { withDeveloper } from "./developer.js"
import { formatDate, formatLines, programLabel } from "../format.js"
import { renderTree, toDom } from "../annotations/render.js"
import { flattenToPng } from "../annotations/flatten.js"
import { download } from "../download.js"

export async function mountSession({ root, store, sessionId }) {
  await withDeveloper({
    root,
    store,
    render: async () => {
      const [session, items] = await Promise.all([store.getSession(sessionId), store.listItems(sessionId)])
      const program = { label: session.programs.label, gt_key: session.programs.gt_key }
      root.innerHTML = `
        <main class="harness-home harness-session">
          <p><a></a></p>
          <h1></h1>
          <p class="harness-session-meta"></p>
          <section class="harness-items"></section>
        </main>`
      const back = root.querySelector("a")
      back.href = `?dev&program=${encodeURIComponent(session.program_id)}`
      back.textContent = "Back to the inbox"
      root.querySelector("h1").textContent = `${programLabel(program)} (${program.gt_key})`
      root.querySelector(".harness-session-meta").textContent =
        `${session.reviewer_name || "Anonymous"}, ${session.mode} mode, started ${formatDate(session.started_at)}`
      const list = root.querySelector(".harness-items")
      if (items.length === 0) {
        const empty = document.createElement("p")
        empty.textContent = "No feedback was sent in this session."
        list.appendChild(empty)
      }
      for (const item of items) list.appendChild(await itemCard(item, program, store))
    },
  })
}

async function itemCard(item, program, store) {
  const card = document.createElement("article")
  card.className = "harness-item"
  card.classList.toggle("harness-resolved", Boolean(item.resolved_at))
  card.innerHTML = `
    <p class="harness-item-when"></p>
    <div class="harness-item-image"></div>
    <pre class="harness-item-text"></pre>
    <details><summary>Context</summary><dl></dl></details>
    <p class="harness-item-actions">
      <button type="button" data-action="resolve"></button>
      <button type="button" data-action="download">Download PNG</button>
    </p>`
  card.querySelector(".harness-item-when").textContent = formatDate(item.created_at)
  card.querySelector(".harness-item-text").textContent = item.text || "(no text)"

  const size = item.image_size || { width: 800, height: 600 }
  let imageUrl = null
  if (item.screenshot_path) {
    try {
      const blob = await store.downloadScreenshot(item.screenshot_path)
      imageUrl = URL.createObjectURL(blob)
      const img = document.createElement("img")
      img.src = imageUrl
      img.width = size.width
      img.height = size.height
      img.alt = "Screenshot"
      const wrap = card.querySelector(".harness-item-image")
      wrap.appendChild(img)
      wrap.appendChild(toDom(renderTree(item.annotations || [], size, { mode: "static" })))
    } catch (error) {
      card.querySelector(".harness-item-image").textContent = `Screenshot unavailable: ${error.message}`
    }
  }

  const dl = card.querySelector("dl")
  const context = item.context || {}
  const rows = [
    ["Lines", formatLines(context.lines)],
    ["Run id", context.runId || ""],
    ["Program", context.programName || ""],
    ["Node", context.nodeId || ""],
    ["Viewport", context.viewport ? `${context.viewport.width} x ${context.viewport.height}` : ""],
    ["Browser", context.userAgent || ""],
    ["Captured", context.capturedAt ? formatDate(context.capturedAt) : ""],
  ]
  for (const [name, value] of Object.entries(context.variables || {})) rows.push([`Variable ${name}`, JSON.stringify(value)])
  if (context.variablesTruncated) rows.push(["Variables", "truncated at 100 KB"])
  for (const [term, value] of rows) {
    const dt = document.createElement("dt")
    const dd = document.createElement("dd")
    dt.textContent = term
    dd.textContent = value
    dl.append(dt, dd)
  }

  const resolveButton = card.querySelector('[data-action="resolve"]')
  const labelResolve = () => (resolveButton.textContent = item.resolved_at ? "Unresolve" : "Resolve")
  labelResolve()
  resolveButton.addEventListener("click", async () => {
    const next = !item.resolved_at
    await store.setResolved(item.id, next)
    item.resolved_at = next ? new Date().toISOString() : null
    card.classList.toggle("harness-resolved", next)
    labelResolve()
  })

  card.querySelector('[data-action="download"]').addEventListener("click", async () => {
    if (!imageUrl) return
    const png = await flattenToPng({ imageUrl, imageSize: size, annotations: item.annotations || [] })
    download(png, `feedback-${program.gt_key}-${item.id}.png`)
  })
  return card
}
```

Append to `src/styles.css`:

```css
/* Inbox and session views */
.harness-inbox table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 12px;
}

.harness-inbox th,
.harness-inbox td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid #e5e5e5;
  font-size: 14px;
}

.harness-item {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 12px 16px;
  margin: 16px 0;
}

.harness-item.harness-resolved {
  opacity: 0.6;
}

.harness-item-image {
  position: relative;
  display: inline-block;
  max-width: 100%;
  line-height: 0;
}

.harness-item-image img {
  display: block;
  max-width: 100%;
  height: auto;
}

.harness-item-image svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.harness-item-text {
  white-space: pre-wrap;
  font: 14px system-ui, sans-serif;
  margin: 8px 0;
}

.harness-item dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 2px 12px;
  font-size: 13px;
}

.harness-item dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.harness-item-actions {
  display: flex;
  gap: 8px;
}
```

Add `mountInbox` and `mountSession` to `test/fixtures/entry.js`.

- [ ] **Step 4: Run to verify they pass, then commit**

Run: `npm run test:browser`
Expected: PASS. If the static SVG does not overlay the image, confirm `.harness-item-image` is `position: relative` and the SVG from `toDom` carries no inline size (the CSS sizes it).

```bash
npm run format
git add src/screens/inbox.js src/screens/session.js src/styles.css test/fixtures/inbox.html test/fixtures/entry.js test/browser/inbox.test.js
git commit -m "Add the inbox and session views with resolve and PNG download

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Wire the app, remove the Phase 1 local flow, update docs

**Files:**
- Modify: `src/main.js`, `README.md`, `test/fixtures/entry.js`, `docs/superpowers/specs/2026-10-14-gt-feedback-harness-design.md` (one note)
- Delete: `src/send-local.js`, `src/screens/home.js`, `test/unit/send-local.test.js`, `test/browser/send-local.test.js`
- Create: `test/browser/app.test.js`

**Interfaces:**
- Consumes: everything above. Produces the final `src/main.js`.

- [ ] **Step 1: Write the failing app test**

`test/browser/app.test.js` (exercises the real `index.html` and `dist/main.js`; the real config means it reaches Supabase for anonymous sign-in, so it is gated the same way as the live test and otherwise only checks the unconfigured and developer paths):

```js
import { test } from "node:test"
import assert from "node:assert/strict"
import { withPage } from "../helpers/browser.js"

test("the app shows the developer sign-in at the root and the invalid-link banner for a bad share id", async () => {
  await withPage(async ({ page, baseUrl }) => {
    await page.route(/supabase\.co/, route => {
      if (route.request().url().includes("/auth/v1/signup")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access_token: "t", token_type: "bearer", expires_in: 3600, refresh_token: "r", user: { id: "anon", is_anonymous: true, aud: "authenticated", role: "authenticated" } }) })
      }
      if (route.request().url().includes("/rest/v1/rpc/resolve_share")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
    })
    await page.goto(`${baseUrl}/index.html`)
    await page.waitForSelector(".harness-signin, .harness-banner")
    await page.goto(`${baseUrl}/index.html?r=NOPENOPENOPENOPENOPENOPE&mode=test`)
    await page.waitForSelector(".harness-banner")
    assert.match(await page.locator(".harness-banner h2").innerText(), /isn't valid|unavailable|went wrong/)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:browser`
Expected: FAIL (the root still mounts the Phase 1 home form, so no `.harness-signin` appears).

- [ ] **Step 3: Rewrite main.js, delete the Phase 1 flow, update the fixture entry**

`src/main.js`:

```js
import "./styles.css"
import { parseRoute } from "./router.js"
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from "./config.js"
import { createStore } from "./store.js"
import { runReviewer } from "./screens/reviewer-flow.js"
import { mountDeveloper } from "./screens/developer.js"
import { mountInbox } from "./screens/inbox.js"
import { mountSession } from "./screens/session.js"
import { renderErrorBanner } from "./screens/banners.js"

const root = document.getElementById("app")
const route = parseRoute(window.location.search)

if (!isConfigured()) {
  renderErrorBanner(root, "This harness has no backend configured. Set the Supabase URL and anon key in src/config.js.")
} else {
  const store = createStore({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY })
  const screens = {
    reviewer: () => runReviewer({ root, route, store }),
    developer: () => mountDeveloper({ root, store }),
    inbox: () => mountInbox({ root, store, programId: route.programId }),
    session: () => mountSession({ root, store, sessionId: route.sessionId }),
  }
  screens[route.screen]().catch(error => renderErrorBanner(root, error.message))
}
```

Delete `src/send-local.js`, `src/screens/home.js`, `test/unit/send-local.test.js`, `test/browser/send-local.test.js`, and (if Task 7 did not already) `test/browser/home.test.js`. Remove `downloadFeedback` from `test/fixtures/entry.js`. Confirm with `grep -rn "send-local\|mountHome\|downloadFeedback" src test` that nothing references them.

- [ ] **Step 4: Update the README**

Replace the "Using it" section with two subsections. For developers: sign in with Google at the harness URL, register the program's key, add the harness URL to the program's Publish page, copy the run or test link. For reviewers: open the link, run the program, click "Give feedback", draw, type, send; nothing to install and no account. Add: feedback appears in the developer's inbox, each item with the annotated screenshot, text, the source lines on screen, and the run's variables; developers can mark items resolved, download the annotated PNG, and delete sessions. Keep "Known limits" and add: free-tier Supabase pauses after a week without traffic (the weekly CI ping prevents it); anonymous sign-ins are limited to 30 per hour per IP address. Remove the sentence about the HTML download.

Add one line to the spec's "Decisions already made": "Phase 1 shipped a single HTML report download in place of the backend; Phase 2 replaced it with Supabase storage (this plan)."

- [ ] **Step 5: Run everything, then commit**

Run: `npm test` and, with the variables set, `HARNESS_SUPABASE_URL=<url> HARNESS_SUPABASE_ANON_KEY=<key> npm run test:browser`
Expected: all unit and browser tests pass; the live test passes when the variables are set.

```bash
npm run format
git add -A src test README.md docs/superpowers/specs/2026-10-14-gt-feedback-harness-design.md
git commit -m "Wire the Supabase-backed app and retire the local download flow

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Verification after merge

1. Push to `main`; the `test`, `db-tests`, and `deploy` jobs must pass (the migration is already applied, so `db push` is a no-op).
2. Open `https://jrc03c.github.io/gt-feedback-harness/`, sign in with Google, register a program whose Publish page lists the harness URL, open its test link in a private window, send one feedback item, and confirm it appears in the inbox with its screenshot.

## Out of scope (Phase 3)

rrweb recording and chunked uploads, the recording toggle, the replay player with markers, the `recordings` bucket, and the retention job. Sharing an inbox with other developers. Email notifications.
