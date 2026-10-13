\set ON_ERROR_STOP on
-- DISPOSABLE CI DATABASE ONLY. Not a production migration.
\ir management-sql.sql
alter table auth.users add column email_confirmed_at timestamptz,
 add column is_anonymous boolean default false,add column banned_until timestamptz,
 add column raw_user_meta_data jsonb default '{}';
update auth.users set email_confirmed_at=now();
create temp table before06 as select id,image_sha256 from public.nr_fields;
\ir ../supabase/migrations/06_Optional_Email_And_Append.sql
\ir ../supabase/migrations/06_Optional_Email_And_Append.sql
select checks.ok((select count(*) from public.nr_fields)=(select count(*) from before06),'Repeated migration does not create or delete images');
select checks.ok((select count(*)=4 from storage.objects),'Migration never changes Storage objects');
select checks.ok((public.nr_registration_status()->>'email_confirmation_required')::boolean=false,'No-email registration policy is explicit');
select checks.ok(not has_schema_privilege('authenticated','nr_registration_private','USAGE'),'Clients cannot edit private registration policy');
set role anon;
select checks.denied($q$select public.nr_prepare_collection_field('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','12345678-1234-4123-8123-123456789001','added','Added',320,240,repeat('a',64))$q$);
select checks.denied($q$select * from public.nr_fields$q$);
reset role;set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select checks.denied($q$select public.nr_prepare_collection_field('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','12345678-1234-4123-8123-123456789001','added','Added',320,240,repeat('a',64))$q$);
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select checks.ok((public.nr_prepare_collection_field('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','12345678-1234-4123-8123-123456789001','added','Added',320,240,repeat('a',64))).id='12345678-1234-4123-8123-123456789001','Owner can append to ready collection');
select checks.ok((public.nr_prepare_collection_field('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','12345678-1234-4123-8123-123456789002','added','Added',320,240,repeat('a',64))).id='12345678-1234-4123-8123-123456789001','Retry returns same live field rather than another row');
select checks.fails($q$select public.nr_prepare_collection_field('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','12345678-1234-4123-8123-123456789002','added','Added',320,240,repeat('b',64))$q$);
select checks.fails($q$select public.nr_prepare_collection_field('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','12345678-1234-4123-8123-123456789099','oversized','Too large',20000,20000,repeat('a',64))$q$);
select checks.fails($q$insert into public.nr_fields(collection_id,source_key,name,width,height,image_sha256) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','raw-bypass','Raw bypass',320,240,repeat('a',64))$q$);
select (public.nr_create_version('12345678-1234-4123-8123-123456789001',null,'Added image',jsonb_build_object('format','nuclei-review-field-v1','kind','fiji','imageSha',repeat('a',64),'width',320,'height',240,'sourceObjectCount',10),repeat('a',64),100)).id;
select checks.ok((select state='ready' from public.nr_collections where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'Adding version does not turn existing collection into a draft');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select checks.ok(not exists(select 1 from public.nr_versions where field_id='12345678-1234-4123-8123-123456789001'),'Another member cannot read new unfinished version');
reset role;
insert into storage.objects(bucket_id,name,metadata) select 'nuclei-private',object_path,'{"size":100}'::jsonb from public.nr_versions where field_id='12345678-1234-4123-8123-123456789001';
insert into storage.objects(bucket_id,name,metadata) select 'nuclei-private',thumbnail_path,'{"size":100}'::jsonb from public.nr_versions where field_id='12345678-1234-4123-8123-123456789001';
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select public.nr_publish_version(id) from public.nr_versions where field_id='12345678-1234-4123-8123-123456789001';
select checks.ok((select state='ready' from public.nr_versions where field_id='12345678-1234-4123-8123-123456789001'),'Complete appended version can be published');
select public.nr_trash_item('field','12345678-1234-4123-8123-123456789001',false);
select checks.ok((public.nr_prepare_collection_field('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','12345678-1234-4123-8123-123456789002','added','Added replacement',320,240,repeat('b',64))).id='12345678-1234-4123-8123-123456789002','Trashed filename can be reused for a different new image');
select checks.fails($q$select public.nr_trash_item('field','12345678-1234-4123-8123-123456789001',true)$q$);
reset role;
select checks.ok((select count(*)=2 from public.nr_fields where source_key='added'),'Both new and archived original row remain');
select checks.ok((select image_sha256=repeat('a',64) and source_key='added' from public.nr_fields where id='12345678-1234-4123-8123-123456789001'),'Original name and pixel hash are preserved');
select checks.ok((select count(*)=1 from public.nr_versions where field_id='12345678-1234-4123-8123-123456789001'),'Original version history is retained');
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select public.nr_trash_item('field','12345678-1234-4123-8123-123456789002',false);
select public.nr_trash_item('field','12345678-1234-4123-8123-123456789001',true);
select checks.ok((select image_sha256=repeat('a',64) from public.nr_fields where source_key='added'),'Original can be restored after new copy is moved to Trash');
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
select checks.ok((public.nr_prepare_collection_field('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','12345678-1234-4123-8123-123456789003','admin-new','Admin added',320,240,repeat('c',64))).created_by=auth.uid(),'Administrator may append with own authorship');
select (public.nr_create_version('12345678-1234-4123-8123-123456789003',null,'Admin original',jsonb_build_object('format','nuclei-review-field-v1','kind','fiji','imageSha',repeat('c',64),'width',320,'height',240,'sourceObjectCount',10),repeat('c',64),100)).id;
select public.nr_trash_item('collection','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
select checks.denied($q$select public.nr_prepare_collection_field('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','12345678-1234-4123-8123-123456789004','trash-new','Rejected',320,240,repeat('c',64))$q$);
select public.nr_trash_item('collection','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
reset role;
insert into auth.users(id,email,raw_user_meta_data) values('66666666-6666-4666-8666-666666666666','unverified@example.invalid','{"role":"admin","display_name":"New unverified account"}');
set role authenticated;
select set_config('request.jwt.claim.sub','66666666-6666-4666-8666-666666666666',false);
select checks.ok((public.nr_join_open_workspace()->>'role')='contributor','Authenticated account joins without asserting verified email or trusting role metadata');
select checks.denied($q$update public.nr_members set role='admin' where user_id=auth.uid()$q$);
select checks.denied($q$select public.nr_set_open_registration(false)$q$);
select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',false);
select checks.denied($q$select public.nr_join_open_workspace()$q$);
select set_config('request.jwt.claim.sub','',false);
select checks.denied($q$select public.nr_join_open_workspace()$q$);
reset role;
select checks.ok(not exists(select 1 from before06 b join nr_fields f on f.id=b.id where b.image_sha256<>f.image_sha256),'All pre-existing image hashes are unchanged');
select 'FLEXIBLE UPLOAD AND REGISTRATION SQL TESTS PASSED' as result;
