\set ON_ERROR_STOP on
-- DISPOSABLE CI DATABASE ONLY. Never run this file in Supabase SQL Editor.
DO $$ BEGIN IF current_database()<>'nuclei_management_test' THEN RAISE EXCEPTION 'Disposable test database required'; END IF; END $$;
create role anon nologin;
create role authenticated nologin;
create schema auth;
create schema storage;
create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,storage to authenticated,anon;
grant execute on function auth.uid() to authenticated,anon;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant select,insert,delete on storage.objects to authenticated;

-- Minimal v1 baseline preserving the access checks, FK links and defaults under test.
-- Polygon validation is not the purpose of this management suite.
create table public.nr_members(user_id uuid primary key references auth.users(id),display_name text not null,role text not null check(role in('admin','reviewer','contributor')),active boolean not null default true,created_at timestamptz default now());
create function public.nr_is_member() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.nr_members where user_id=auth.uid() and active)$$;
create function public.nr_is_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.nr_members where user_id=auth.uid() and active and role='admin')$$;
create function public.nr_is_reviewer() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.nr_members where user_id=auth.uid() and active and role in('admin','reviewer'))$$;
create table public.nr_collections(id uuid primary key default gen_random_uuid(),title text not null,kind text not null,description text default '',owner_id uuid not null default auth.uid() references public.nr_members(user_id),state text not null default 'draft' check(state in('draft','ready')),created_at timestamptz default now());
create table public.nr_fields(id uuid primary key default gen_random_uuid(),collection_id uuid not null references public.nr_collections(id),source_key text not null,name text not null,width int not null,height int not null,image_sha256 text not null,created_by uuid not null default auth.uid() references public.nr_members(user_id),created_at timestamptz default now(),unique(collection_id,source_key));
create table public.nr_versions(id uuid primary key default gen_random_uuid(),field_id uuid not null references public.nr_fields(id),parent_id uuid references public.nr_versions(id),seq int not null,author_id uuid not null references public.nr_members(user_id),summary text default '',manifest jsonb not null,object_path text not null unique,thumbnail_path text not null unique,archive_sha256 text not null,archive_bytes bigint not null,source_object_count int default 0,state text not null default 'draft' check(state in('draft','ready')),created_at timestamptz default now(),unique(field_id,seq));
create table public.nr_comments(id uuid primary key default gen_random_uuid(),version_id uuid not null references public.nr_versions(id),author_id uuid not null default auth.uid() references public.nr_members(user_id),body text not null check(char_length(btrim(body)) between 1 and 6000),roi_ref text default '',anchor jsonb,reply_to uuid references public.nr_comments(id),created_at timestamptz default now());
create table public.nr_proposals(id uuid primary key default gen_random_uuid(),version_id uuid not null references public.nr_versions(id),author_id uuid not null default auth.uid() references public.nr_members(user_id),label text not null,geometry jsonb not null,note text default '',created_at timestamptz default now());
create table public.nr_reviews(id uuid primary key default gen_random_uuid(),version_id uuid not null references public.nr_versions(id),author_id uuid not null default auth.uid() references public.nr_members(user_id),verdict text not null check(verdict in('approved','discussion','needs_changes')),body text default '',created_at timestamptz default now());
create function public.nr_can_read_collection(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$select public.nr_is_member() and exists(select 1 from public.nr_collections where id=p_id and (state='ready' or owner_id=auth.uid()))$$;
create function public.nr_can_read_field(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.nr_fields where id=p_id and public.nr_can_read_collection(collection_id))$$;
create function public.nr_can_read_version(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$select public.nr_is_member() and exists(select 1 from public.nr_versions where id=p_id and public.nr_can_read_field(field_id) and (state='ready' or author_id=auth.uid()))$$;
create function public.nr_ready_version(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$select public.nr_is_member() and exists(select 1 from public.nr_versions where id=p_id and state='ready' and public.nr_can_read_field(field_id))$$;
create function public.nr_valid_geometry(g jsonb,w int,h int,polygon boolean) returns boolean language sql immutable as $$select g is not null$$;
create function public.nr_validate_annotation() returns trigger language plpgsql as $$begin return new; end$$;
create trigger nr_comment_geometry before insert on public.nr_comments for each row execute function public.nr_validate_annotation();
create trigger nr_proposal_geometry before insert on public.nr_proposals for each row execute function public.nr_validate_annotation();
create function public.nr_storage_read(p_name text) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.nr_versions where p_name in(object_path,thumbnail_path) and public.nr_can_read_version(id))$$;
create function public.nr_storage_write(p_name text) returns boolean language sql stable security definer set search_path='' as $$select public.nr_is_member() and exists(select 1 from public.nr_versions where p_name in(object_path,thumbnail_path) and state='draft' and author_id=auth.uid())$$;
create policy nr_storage_read on storage.objects for select to authenticated using(bucket_id='nuclei-private' and public.nr_storage_read(name));
create policy nr_storage_insert on storage.objects for insert to authenticated with check(bucket_id='nuclei-private' and public.nr_storage_write(name));
create policy nr_storage_delete_draft on storage.objects for delete to authenticated using(bucket_id='nuclei-private' and public.nr_storage_write(name));
alter table public.nr_members enable row level security;
alter table public.nr_collections enable row level security;
alter table public.nr_fields enable row level security;
alter table public.nr_versions enable row level security;
alter table public.nr_comments enable row level security;
alter table public.nr_proposals enable row level security;
alter table public.nr_reviews enable row level security;
grant select on public.nr_members,public.nr_collections,public.nr_fields,public.nr_versions,public.nr_comments,public.nr_proposals,public.nr_reviews to authenticated;
grant insert(id,title,kind,description) on public.nr_collections to authenticated;
grant insert(id,collection_id,source_key,name,width,height,image_sha256) on public.nr_fields to authenticated;
grant insert(id,version_id,body,roi_ref,anchor,reply_to) on public.nr_comments to authenticated;
create policy nr_member_read on public.nr_members for select to authenticated using(public.nr_is_member());
create policy nr_collection_read on public.nr_collections for select to authenticated using(public.nr_can_read_collection(id));
create policy nr_collection_add on public.nr_collections for insert to authenticated with check(public.nr_is_member() and owner_id=auth.uid() and state='draft');
create policy nr_field_read on public.nr_fields for select to authenticated using(public.nr_can_read_field(id));
create policy nr_field_add on public.nr_fields for insert to authenticated with check(public.nr_is_member() and created_by=auth.uid() and exists(select 1 from public.nr_collections c where c.id=collection_id and c.owner_id=auth.uid() and c.state='draft'));
create policy nr_version_read on public.nr_versions for select to authenticated using(public.nr_can_read_version(id));
create policy nr_comment_read on public.nr_comments for select to authenticated using(public.nr_ready_version(version_id));
create policy nr_comment_add on public.nr_comments for insert to authenticated with check(public.nr_ready_version(version_id) and author_id=auth.uid());
create policy nr_proposal_read on public.nr_proposals for select to authenticated using(public.nr_ready_version(version_id));
create policy nr_review_read on public.nr_reviews for select to authenticated using(public.nr_ready_version(version_id));

insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','owner@example.invalid'),
 ('22222222-2222-4222-8222-222222222222','other@example.invalid'),
 ('33333333-3333-4333-8333-333333333333','admin@example.invalid'),
 ('44444444-4444-4444-8444-444444444444','outsider@example.invalid'),
 ('55555555-5555-4555-8555-555555555555','inactive@example.invalid');
insert into public.nr_members(user_id,display_name,role,active) values
 ('11111111-1111-4111-8111-111111111111','Owner','contributor',true),
 ('22222222-2222-4222-8222-222222222222','Other','contributor',true),
 ('33333333-3333-4333-8333-333333333333','Admin','admin',true),
 ('55555555-5555-4555-8555-555555555555','Inactive','contributor',false);
insert into public.nr_collections(id,title,kind,owner_id,state) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Test collection','fiji','11111111-1111-4111-8111-111111111111','ready');
insert into public.nr_fields(id,collection_id,source_key,name,width,height,image_sha256,created_by) values
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','field-1','Field 1',320,240,repeat('a',64),'11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','field-2','Field 2',320,240,repeat('b',64),'11111111-1111-4111-8111-111111111111');
insert into public.nr_versions(id,field_id,seq,author_id,manifest,object_path,thumbnail_path,archive_sha256,archive_bytes,state) values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,'11111111-1111-4111-8111-111111111111','{}','one/source.zip','one/thumb.png',repeat('c',64),100,'ready'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccd','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc',1,'11111111-1111-4111-8111-111111111111','{}','two/source.zip','two/thumb.png',repeat('d',64),100,'ready');
insert into public.nr_comments(id,version_id,author_id,body) values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111','Text to delete');
insert into public.nr_comments(id,version_id,author_id,body,reply_to) values('dddddddd-dddd-4ddd-8ddd-ddddddddddde','cccccccc-cccc-4ccc-8ccc-cccccccccccc','22222222-2222-4222-8222-222222222222','Reply must remain','dddddddd-dddd-4ddd-8ddd-dddddddddddd');
insert into public.nr_proposals(id,version_id,author_id,label,geometry) values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111','Candidate','{"type":"polygon","points":[[1,1],[2,1],[2,2]]}');
insert into public.nr_reviews(id,version_id,author_id,verdict,body) values('ffffffff-ffff-4fff-8fff-ffffffffffff','cccccccc-cccc-4ccc-8ccc-cccccccccccc','22222222-2222-4222-8222-222222222222','approved','Previous decision');
insert into storage.objects(bucket_id,name,metadata) select 'nuclei-private',object_path,'{"size":100}' from public.nr_versions;
insert into storage.objects(bucket_id,name,metadata) select 'nuclei-private',thumbnail_path,'{"size":100}' from public.nr_versions;

\ir ../supabase/migrations/04_Enable_Delete_And_Trash.sql
\ir ../supabase/migrations/04_Enable_Delete_And_Trash.sql
create schema checks;
grant usage on schema checks to authenticated,anon;
create function checks.ok(p boolean,m text) returns void language plpgsql as $$begin if p is distinct from true then raise exception 'FAIL: %',m; end if; raise notice 'PASS: %',m; end$$;
create function checks.denied(q text) returns void language plpgsql as $$begin begin execute q; exception when insufficient_privilege then raise notice 'PASS: denied %',q; return; end; raise exception 'FAIL: permission denial expected for %',q; end$$;
create function checks.fails(q text) returns void language plpgsql as $$begin begin execute q; exception when others then raise notice 'PASS: rejected %',q; return; end; raise exception 'FAIL: failure expected for %',q; end$$;
select checks.ok((select count(*)=2 from public.nr_fields) and (select count(*)=4 from storage.objects),'Migration preserves seeded fields and Storage metadata');
set role authenticated;
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
select checks.denied($q$select public.nr_list_trash()$q$);
select checks.denied($q$select public.nr_trash_item('collection','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false)$q$);
select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',false);
select checks.denied($q$select public.nr_management_version()$q$);
reset role;set role anon;
select checks.denied($q$select public.nr_list_trash()$q$);
reset role;set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select checks.ok(public.nr_management_version()='trash-feedback-v1','Member can use management RPC');
insert into public.nr_collections(id,title,kind) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','Returning regression','fiji') returning *;
insert into public.nr_fields(collection_id,source_key,name,width,height,image_sha256) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','new','New field',320,240,repeat('a',64)) returning *;
select public.nr_trash_item('field','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
select checks.ok(not exists(select 1 from public.nr_fields where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),'Trashed field hidden even from ordinary owner reads');
select checks.ok((select count(*)=1 from public.nr_list_trash()),'Owner can list own Trash');
select checks.ok(not exists(select 1 from storage.objects where name='one/source.zip'),'Storage policy denies trashed source');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select checks.ok((select count(*)=0 from public.nr_list_trash()),'Other member cannot list owner Trash');
select checks.denied($q$select public.nr_trash_item('field','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true)$q$);
select checks.ok(not exists(select 1 from public.nr_comments),'Feedback of trashed field hidden');
select checks.ok(exists(select 1 from public.nr_fields where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc'),'Unrelated field remains visible');
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
select checks.ok((select count(*)=1 from public.nr_list_trash()),'Admin can list another owner Trash');
select public.nr_trash_item('field','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
select checks.ok((select count(*)=2 from public.nr_comments),'Restore preserves thread');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select checks.denied($q$select public.nr_remove_feedback('comment','dddddddd-dddd-4ddd-8ddd-ddddddddddde')$q$);
select public.nr_remove_feedback('comment','dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select checks.ok((select body='[Deleted comment]' and removed_at is not null from public.nr_comments where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'),'Deleted comment payload wiped');
select checks.ok((select body='Reply must remain' from public.nr_comments where id='dddddddd-dddd-4ddd-8ddd-ddddddddddde'),'Other user reply retained');
select checks.fails($q$insert into public.nr_comments(version_id,body,reply_to) values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','New reply','dddddddd-dddd-4ddd-8ddd-dddddddddddd')$q$);
select public.nr_remove_feedback('proposal','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
select checks.ok((select jsonb_array_length(geometry->'points')=0 and removed_at is not null from public.nr_proposals),'Proposal withdrawn without source mutation');
select checks.denied($q$select public.nr_remove_feedback('review','ffffffff-ffff-4fff-8fff-ffffffffffff')$q$);
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select public.nr_remove_feedback('review','ffffffff-ffff-4fff-8fff-ffffffffffff');
select checks.ok((select removed_at is not null and verdict<>'approved' from public.nr_reviews),'Withdrawn decision no longer approved');
select checks.denied($q$update public.nr_comments set body='overwrite' where id='dddddddd-dddd-4ddd-8ddd-ddddddddddde'$q$);
select checks.denied($q$delete from public.nr_versions$q$);
select checks.ok((select count(*)=0 from public.nr_management_events),'Audit log not exposed to ordinary members');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select public.nr_trash_item('field','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
select public.nr_trash_item('collection','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
select checks.ok(not public.nr_can_read_collection('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'Trashed collection cannot be read');
select checks.ok(not exists(select 1 from storage.objects),'Collection Trash hides all its stored bytes');
select checks.fails($q$select public.nr_publish_collection('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$q$);
select checks.fails($q$select public.nr_publish_version('cccccccc-cccc-4ccc-8ccc-cccccccccccc')$q$);
select checks.fails($q$select public.nr_trash_item('field','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true)$q$);
select public.nr_trash_item('collection','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
select checks.ok(not public.nr_can_read_field('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),'Restoring parent does not restore independently trashed field');
select public.nr_trash_item('field','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
reset role;
select checks.ok((select count(*)=4 from storage.objects),'No Storage object was deleted by Trash');
select checks.ok((select archive_sha256=repeat('c',64) from public.nr_versions where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'),'Original source hash unchanged');
select 'MANAGEMENT SQL TESTS PASSED' as result;
