begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

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

-- The Data API's role for requests without a signed-in user.
create function pg_temp.login_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
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

-- 4-5: a reviewer sees no programs, directly or through the overview
select is((select count(*) from programs)::int, 0, 'a reviewer cannot list programs');
select is((select count(*) from program_overview)::int, 0, 'a reviewer cannot list the program overview');

-- 6-7: the anon role cannot resolve shares or read tables at all
select pg_temp.login_anon();
select throws_ok($$ select * from resolve_share('AAAAAAAAAAAAAAAAAAAAAAAA') $$,
  '42501', null, 'the anon role cannot call resolve_share');
select throws_ok($$ select * from programs $$,
  '42501', null, 'the anon role cannot read programs');

-- 8-9: share resolution
select pg_temp.login('00000000-0000-0000-0000-000000000003', true);
select results_eq($$ select gt_key from resolve_share('AAAAAAAAAAAAAAAAAAAAAAAA') $$, $$ values ('abc1234') $$,
  'a reviewer resolves a share id to the program key');
select is((select count(*) from resolve_share('nope'))::int, 0, 'an unknown share id resolves to nothing');

-- 10-12: sessions
select lives_ok($$ insert into sessions (id, program_id, share_id, reviewer_uid, mode)
  values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'AAAAAAAAAAAAAAAAAAAAAAAA', '00000000-0000-0000-0000-000000000003', 'test') $$,
  'a reviewer with the share id creates a session');
select throws_ok($$ insert into sessions (program_id, share_id, reviewer_uid, mode)
  values ('10000000-0000-0000-0000-000000000001', 'WRONGWRONGWRONGWRONGWRON', '00000000-0000-0000-0000-000000000003', 'test') $$,
  '42501', null, 'the wrong share id is rejected');
select throws_ok($$ insert into sessions (program_id, share_id, reviewer_uid, mode)
  values ('10000000-0000-0000-0000-000000000001', 'AAAAAAAAAAAAAAAAAAAAAAAA', '00000000-0000-0000-0000-000000000004', 'test') $$,
  '42501', null, 'a session cannot be created for another reviewer uid');

-- 13-16: items and session updates by the reviewer
select lives_ok($$ insert into items (id, session_id, text)
  values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'hello') $$,
  'the reviewer adds an item to their session');
select lives_ok($$ update sessions set reviewer_name = 'Alice', last_seen_at = now()
  where id = '20000000-0000-0000-0000-000000000001' $$, 'the reviewer updates their session');
select throws_ok($$ update sessions set program_id = program_id
  where id = '20000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'the reviewer cannot update a session''s program_id');
select throws_ok($$ insert into items (session_id, text, screenshot_path)
  values ('20000000-0000-0000-0000-000000000001', 'x', '20000000-0000-0000-0000-000000000002/x.webp') $$,
  '23514', null, 'an item cannot point at another session''s screenshot folder');

-- 17-19: another reviewer sees and touches nothing
select pg_temp.login('00000000-0000-0000-0000-000000000004', true);
select is((select count(*) from sessions)::int, 0, 'another reviewer cannot see the session');
select is((select count(*) from items)::int, 0, 'another reviewer cannot see the item');
select throws_ok($$ insert into items (session_id, text) values ('20000000-0000-0000-0000-000000000001', 'x') $$,
  '42501', null, 'another reviewer cannot add an item to the session');

-- 20-23: the owner reads, resolves, and the other developer cannot
select pg_temp.login('00000000-0000-0000-0000-000000000001', false);
select is((select count(*) from sessions)::int, 1, 'the owner sees the session');
select is((select reviewer_name from sessions where id = '20000000-0000-0000-0000-000000000001'), 'Alice', 'with the reviewer name');
select lives_ok($$ update items set resolved_at = now() where id = '30000000-0000-0000-0000-000000000001' $$, 'the owner resolves an item');
select pg_temp.login('00000000-0000-0000-0000-000000000002', false);
select is((select count(*) from items)::int, 0, 'another developer sees no items');

-- 24: the reviewer cannot resolve (update silently affects no rows)
select pg_temp.login('00000000-0000-0000-0000-000000000003', true);
update items set resolved_at = null where id = '30000000-0000-0000-0000-000000000001';
select pg_temp.login('00000000-0000-0000-0000-000000000001', false);
select isnt((select resolved_at from items where id = '30000000-0000-0000-0000-000000000001'), null, 'a reviewer cannot change resolved_at');

-- 25-29: storage policies on the screenshots bucket
select pg_temp.login('00000000-0000-0000-0000-000000000003', true);
select lives_ok($$ insert into storage.objects (bucket_id, name)
  values ('screenshots', '20000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001.webp') $$,
  'the reviewer uploads into their session folder');
select throws_ok($$ insert into storage.objects (bucket_id, name)
  values ('screenshots', 'not-a-uuid/x.webp') $$,
  '42501', null, 'a non-uuid folder is denied, not a cast error');
select pg_temp.login('00000000-0000-0000-0000-000000000004', true);
select throws_ok($$ insert into storage.objects (bucket_id, name)
  values ('screenshots', '20000000-0000-0000-0000-000000000001/other.webp') $$,
  '42501', null, 'another reviewer cannot upload into that folder');
select is((select count(*) from storage.objects where name like '20000000-0000-0000-0000-000000000001/%')::int, 0,
  'another reviewer cannot see the screenshot');
select pg_temp.login('00000000-0000-0000-0000-000000000001', false);
select is((select count(*) from storage.objects where name like '20000000-0000-0000-0000-000000000001/%')::int, 1,
  'the owner sees the screenshot');

-- 30: the overview view counts for the owner
select results_eq($$ select session_count::int, unresolved_count::int from program_overview where id = '10000000-0000-0000-0000-000000000001' $$,
  $$ values (1, 0) $$, 'program_overview counts sessions and unresolved items');

-- 31-32: deleting a session cascades to its items
select lives_ok($$ delete from sessions where id = '20000000-0000-0000-0000-000000000001' $$, 'the owner deletes a session');
select pg_temp.logout();
select is((select count(*) from items where session_id = '20000000-0000-0000-0000-000000000001')::int, 0,
  'the session''s items were deleted with it');
select * from finish();
rollback;
