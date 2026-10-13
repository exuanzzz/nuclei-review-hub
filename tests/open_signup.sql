\set ON_ERROR_STOP on
-- DISPOSABLE TEST DATABASE ONLY. Never paste this test file into your Supabase project.
do $$ begin if current_database() <> 'nuclei_registration_test' then raise exception 'Disposable test database required'; end if; end $$;
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (
 id uuid primary key, email text, email_confirmed_at timestamptz,
 is_anonymous boolean default false, banned_until timestamptz,
 raw_user_meta_data jsonb default '{}'
);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;
grant execute on function auth.uid() to anon,authenticated;
create table public.nr_members (
 user_id uuid primary key references auth.users(id),
 display_name text not null check(char_length(display_name) between 1 and 80),
 role text not null check(role in ('admin','reviewer','contributor')),
 active boolean not null default true,created_at timestamptz default now()
);
create function public.nr_is_member() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.nr_members where user_id=auth.uid() and active)$$;
create function public.nr_is_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.nr_members where user_id=auth.uid() and active and role='admin')$$;
alter table public.nr_members enable row level security;
grant select on public.nr_members to authenticated;
create policy members_read on public.nr_members for select to authenticated using (public.nr_is_member());
-- Same ready-collection/member read pattern as the app; no source files are used.
create table public.nr_collections(id int primary key,state text,owner_id uuid);
alter table public.nr_collections enable row level security;
grant select on public.nr_collections to authenticated;
create policy collection_read on public.nr_collections for select to authenticated using(public.nr_is_member() and (state='ready' or owner_id=auth.uid()));
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('11111111-1111-4111-8111-111111111111','admin@example.invalid',now(),'{"display_name":"Admin"}'),
 ('22222222-2222-4222-8222-222222222222','new@example.invalid',now(),'{"display_name":"New member","role":"admin","active":true}'),
 ('33333333-3333-4333-8333-333333333333','pending@example.invalid',null,'{}'),
 ('44444444-4444-4444-8444-444444444444','revoked@example.invalid',now(),'{"role":"admin","active":true}'),
 ('55555555-5555-4555-8555-555555555555','banned@example.invalid',now(),'{}'),
 ('66666666-6666-4666-8666-666666666666','anonymous@example.invalid',now(),'{}'),
 ('77777777-7777-4777-8777-777777777777','later@example.invalid',now(),'{}');
update auth.users set banned_until=now()+interval '1 day' where id='55555555-5555-4555-8555-555555555555';
update auth.users set is_anonymous=true where id='66666666-6666-4666-8666-666666666666';
insert into public.nr_members values
 ('11111111-1111-4111-8111-111111111111','Admin','admin',true,now()),
 ('44444444-4444-4444-8444-444444444444','Revoked','reviewer',false,now());
insert into public.nr_collections values(1,'ready','11111111-1111-4111-8111-111111111111'),(2,'draft','11111111-1111-4111-8111-111111111111');
create table public.test_results(label text,passed boolean);
create function public.assert_check(ok boolean,label text) returns void language plpgsql security definer as $$begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; insert into public.test_results values(label,true);raise notice 'PASS: %',label;end$$;
create function public.expect_denied(statement text,label text) returns void language plpgsql as $$begin begin execute statement;exception when insufficient_privilege then perform public.assert_check(true,label);return;end;raise exception 'Expected denied: %',label;end$$;
\ir ../supabase/migrations/05_Open_Self_Registration.sql
select assert_check((select count(*)=2 from nr_members),'Installing migration does not enroll users or modify existing memberships');
select assert_check((select count(*)=2 from nr_collections),'Installing migration leaves collections unchanged');
set role anon;
select assert_check((public.nr_registration_status()->>'enabled')::boolean,'Anonymous can read only public enrollment status');
select expect_denied('select * from nr_members','Anonymous cannot read member records');
select expect_denied('select * from nr_collections','Anonymous cannot read collections');
select expect_denied('select public.nr_join_open_workspace()','Anonymous cannot execute enrollment');
select expect_denied('select * from nr_registration_private.settings','Anonymous cannot read private config');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','','false');
select expect_denied('select public.nr_join_open_workspace()','Authenticated role without subject cannot join');
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
select assert_check((select count(*)=0 from nr_collections),'Unenrolled account cannot read shared collections');
select expect_denied('select public.nr_join_open_workspace()','Unconfirmed email is denied by server');
select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',false);
select expect_denied('select public.nr_join_open_workspace()','Banned account cannot join');
select set_config('request.jwt.claim.sub','66666666-6666-4666-8666-666666666666',false);
select expect_denied('select public.nr_join_open_workspace()','Anonymous Auth account cannot join even with a confirmation timestamp');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select assert_check(public.nr_join_open_workspace()->>'role'='contributor','Verified email joins as Contributor despite forged admin metadata');
select assert_check((select count(*)=1 from nr_collections),'New contributor can read published collections but not other drafts');
select assert_check((public.nr_join_open_workspace()->>'joined')::boolean=false,'Repeated enrollment is idempotent');
select assert_check((select count(*)=1 from nr_members where user_id=auth.uid()),'Repeated enrollment has one member row');
select expect_denied('update nr_members set role=''admin'' where user_id=auth.uid()','Contributor cannot directly upgrade own role');
select expect_denied('select public.nr_set_open_registration(false)','Contributor cannot change joining policy');
select expect_denied('select * from nr_registration_private.settings','Contributor cannot read private policy table');
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
select expect_denied('select public.nr_join_open_workspace()','Deactivated member cannot reactivate through self-registration');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select assert_check(public.nr_join_open_workspace()->>'role'='admin','Existing administrator role is preserved');
select assert_check((public.nr_set_open_registration(false)->>'enabled')::boolean=false,'Admin can pause public joining');
select set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',false);
select expect_denied('select public.nr_join_open_workspace()','Paused policy denies new confirmed users');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select assert_check(public.nr_join_open_workspace()->>'role'='contributor','Pausing new joining does not block active existing members');
reset role;
\ir ../supabase/migrations/05_Open_Self_Registration.sql
select assert_check((public.nr_registration_status()->>'enabled')::boolean=false,'Repeating migration preserves an administrator pause');
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select public.nr_set_open_registration(true);
select set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',false);
select assert_check(public.nr_join_open_workspace()->>'role'='contributor','Reopened registration permits a verified new user');
select assert_check((select display_name from nr_members where user_id=auth.uid())='Member 77777777','Missing display name gets a non-email fallback');
reset role;
select assert_check((select role='reviewer' and not active from nr_members where user_id='44444444-4444-4444-8444-444444444444'),'Revoked member state and role remain unchanged');
select assert_check((select bool_and(relrowsecurity) from pg_class where oid in ('public.nr_members'::regclass,'public.nr_collections'::regclass,'nr_registration_private.settings'::regclass)),'All relevant tables keep RLS enabled');
select assert_check((select count(*)=2 from nr_collections),'No collections deleted or changed by enrollment operations');
select count(*) as passed from test_results;
