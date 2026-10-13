-- 06: Optional email confirmation + append images to existing collections.
-- 在 Supabase SQL Editor 的 Database 中运行；保留此查询到 PRIVATE。
-- 前提：网站初始表和 04 回收站更新已安装。未安装 05 时，也会建立注册函数。
-- 本次不会上传、删除、重新编码原图、ROI 或评论；不会开放匿名文件访问。
-- 邮箱可仅作为登录标识，不证明真实身份。新成员固定为 Contributor。
-- 无验证邮件注册还需在 Authentication > Sign In / Providers 关闭 Confirm email。
-- 追加仅限集合所有者/管理员。同名图片的回收站历史保留，不被覆盖。
begin;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='nr_fields' AND column_name='trashed_at') THEN
  RAISE EXCEPTION 'Install update 04 (Trash) before update 06. No changes were committed.';
 END IF;
END $$;
create schema if not exists nr_registration_private;
revoke all on schema nr_registration_private from public,anon,authenticated;
create table if not exists nr_registration_private.settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 require_email_confirmation boolean not null default false,
 changed_at timestamptz not null default now()
);
alter table nr_registration_private.settings add column if not exists require_email_confirmation boolean not null default false;
-- 已存在的 enabled（包括管理员主动暂停的状态）不变。
update nr_registration_private.settings set require_email_confirmation=false where singleton;
alter table nr_registration_private.settings enable row level security;
revoke all on table nr_registration_private.settings from public,anon,authenticated;
insert into nr_registration_private.settings(singleton,enabled) values(true,true) on conflict(singleton) do nothing;

create or replace function public.nr_registration_status() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'enabled',coalesce((select enabled from nr_registration_private.settings where singleton),false),
  'default_role','contributor',
  'email_confirmation_required',coalesce((select require_email_confirmation from nr_registration_private.settings where singleton),false)
 );
$$;
create or replace function public.nr_join_open_workspace() returns jsonb
language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); auth_record record; member_record public.nr_members;
 registration_open boolean; need_confirmation boolean; safe_name text;
begin
 if caller is null then raise exception 'Please sign in before joining.' using errcode='42501'; end if;
 select id,email,email_confirmed_at,is_anonymous,banned_until,raw_user_meta_data
 into auth_record from auth.users where id=caller for update;
 if not found then raise exception 'Your authentication account is unavailable.' using errcode='42501'; end if;
 if coalesce(auth_record.is_anonymous,false) or auth_record.email is null or btrim(auth_record.email)='' then
  raise exception 'A non-anonymous email/password account is required.' using errcode='42501';
 end if;
 if auth_record.banned_until>now() then raise exception 'This authentication account is suspended.' using errcode='42501'; end if;
 select * into member_record from public.nr_members where user_id=caller for update;
 if found then
  if not member_record.active then raise exception 'Your workspace access was revoked. Contact the administrator.' using errcode='42501'; end if;
  return jsonb_build_object('joined',false,'role',member_record.role);
 end if;
 select enabled,require_email_confirmation into registration_open,need_confirmation
 from nr_registration_private.settings where singleton for share;
 if registration_open is distinct from true then raise exception 'Public joining is currently paused.' using errcode='42501'; end if;
 if need_confirmation and auth_record.email_confirmed_at is null then
  raise exception 'Confirm your email before joining.' using errcode='42501';
 end if;
 -- metadata 只用于显示名，不能指定权限。
 safe_name:=left(btrim(regexp_replace(coalesce(auth_record.raw_user_meta_data->>'display_name',''),'[[:cntrl:]]','','g')),80);
 if safe_name='' then safe_name:='Member '||left(caller::text,8); end if;
 insert into public.nr_members(user_id,display_name,role,active) values(caller,safe_name,'contributor',true) on conflict(user_id) do nothing;
 select * into member_record from public.nr_members where user_id=caller for update;
 if member_record.user_id is null or not member_record.active then raise exception 'Workspace access is not active.' using errcode='42501'; end if;
 return jsonb_build_object('joined',true,'role',member_record.role);
end;
$$;
create or replace function public.nr_set_open_registration(p_enabled boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.nr_is_admin() then raise exception 'Workspace administrator required.' using errcode='42501'; end if;
 if p_enabled is null then raise exception 'An explicit true or false value is required.'; end if;
 update nr_registration_private.settings set enabled=p_enabled,changed_at=now() where singleton;
 return public.nr_registration_status();
end;
$$;
revoke all on function public.nr_registration_status(),public.nr_join_open_workspace(),public.nr_set_open_registration(boolean) from public,anon,authenticated;
grant execute on function public.nr_registration_status() to anon,authenticated;
grant execute on function public.nr_join_open_workspace(),public.nr_set_open_registration(boolean) to authenticated;

-- 仅活动图片要求集合内名称唯一；回收站的旧名称和历史版本保持不变。
create unique index if not exists nr_fields_active_source_key on public.nr_fields(collection_id,source_key) where trashed_at is null;
DO $$ DECLARE item record; BEGIN
 FOR item IN
  SELECT c.conname FROM pg_constraint c
  WHERE c.conrelid='public.nr_fields'::regclass AND c.contype='u'
   AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM unnest(c.conkey) k
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k)=ARRAY['collection_id','source_key']::text[]
 LOOP EXECUTE format('alter table public.nr_fields drop constraint %I',item.conname); END LOOP;
END $$;

create or replace function nr_registration_private.guard_field_restore() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.trashed_at is not null and new.trashed_at is null
 and exists(select 1 from public.nr_fields f where f.collection_id=new.collection_id and f.source_key=new.source_key and f.id<>new.id and f.trashed_at is null) then
  raise exception 'An active image with this name already exists. Move it to Trash before restoring the old image. Neither source was overwritten.' using errcode='23505';
 end if;
 return new;
end;
$$;
drop trigger if exists nr_guard_field_restore on public.nr_fields;
create trigger nr_guard_field_restore before update of trashed_at on public.nr_fields for each row execute function nr_registration_private.guard_field_restore();
revoke all on function nr_registration_private.guard_field_restore() from public,anon,authenticated;

-- 只允许调用者向自己有权管理的已发布集合添加图片，不允许指定作者或角色。
create or replace function public.nr_prepare_collection_field(
 p_collection uuid,p_id uuid,p_key text,p_name text,p_width integer,p_height integer,p_sha text
) returns public.nr_fields language plpgsql security definer set search_path='' as $$
declare c public.nr_collections; f public.nr_fields; caller uuid:=auth.uid();
begin
 if caller is null or not public.nr_is_member() then raise exception 'Active workspace membership required.' using errcode='42501'; end if;
 select * into c from public.nr_collections where id=p_collection for share;
 if c.id is null or c.trashed_at is not null or c.state<>'ready' or (c.owner_id=caller or public.nr_is_admin()) is not true then
  raise exception 'Only the owner or an administrator can add images to this active published collection.' using errcode='42501';
 end if;
 if p_id is null or p_key is null or char_length(p_key) not between 1 and 500
 or p_name is null or char_length(p_name) not between 1 and 500
 or p_width is null or p_height is null or p_width not between 1 and 20000
 or p_height not between 1 and 20000 or p_width::bigint*p_height>40000000
 or p_sha is null or p_sha !~ '^[a-f0-9]{64}$' then raise exception 'Invalid image metadata.' using errcode='22023'; end if;
 insert into public.nr_fields(id,collection_id,source_key,name,width,height,image_sha256,created_by)
 values(p_id,p_collection,p_key,p_name,p_width,p_height,p_sha,caller)
 on conflict(collection_id,source_key) where trashed_at is null do nothing;
 select * into f from public.nr_fields where collection_id=p_collection and source_key=p_key and trashed_at is null for update;
 if f.id is null or f.image_sha256<>p_sha or f.width<>p_width or f.height<>p_height then
  raise exception 'An active image with this name has different pixels. Move it to Trash first, or use another name. No image was replaced.' using errcode='23505';
 end if;
 return f;
end;
$$;
-- 保留既有 manifest 校验、版本不可覆盖、参考 mask 不可修订的规则。
create or replace function public.nr_create_version(p_field uuid,p_parent uuid,p_summary text,p_manifest jsonb,p_hash text,p_bytes bigint)
 returns public.nr_versions language plpgsql security definer set search_path='' as $$
declare f public.nr_fields; c public.nr_collections; v public.nr_versions; seq_no integer; new_id uuid:=gen_random_uuid();
begin
 if not public.nr_can_read_field(p_field) then raise exception 'Not an approved member' using errcode='42501'; end if;
 select * into f from public.nr_fields where id=p_field for update;
 select * into c from public.nr_collections where id=f.collection_id;
 select coalesce(max(seq),0)+1 into seq_no from public.nr_versions where field_id=p_field;
 if seq_no=1 then
  if f.created_by<>auth.uid() or c.trashed_at is not null or f.trashed_at is not null
   or (c.owner_id=auth.uid() or public.nr_is_admin()) is not true
   or c.state not in ('draft','ready') or p_parent is not null then
   raise exception 'Only the field creator with collection ownership or administrator rights can create its original version.' using errcode='42501';
  end if;
 else
  if c.kind='bbbc038' then raise exception 'Reference mask versions are immutable. Use review proposals instead.'; end if;
  if not exists(select 1 from public.nr_versions where id=p_parent and field_id=p_field and state='ready') then raise exception 'A ready parent version from the same field is required'; end if;
 end if;
 if (p_manifest->>'format') is distinct from 'nuclei-review-field-v1'
 or (p_manifest->>'kind') is distinct from c.kind
 or (p_manifest->>'imageSha') is distinct from f.image_sha256
 or (p_manifest->>'width')::integer is distinct from f.width
 or (p_manifest->>'height')::integer is distinct from f.height then raise exception 'Manifest does not match the immutable source image'; end if;
 insert into public.nr_versions(id,field_id,parent_id,seq,author_id,summary,manifest,object_path,thumbnail_path,archive_sha256,archive_bytes,source_object_count)
 values(new_id,p_field,p_parent,seq_no,auth.uid(),p_summary,p_manifest,new_id::text||'/source.zip',new_id::text||'/thumb.png',p_hash,p_bytes,(p_manifest->>'sourceObjectCount')::integer) returning * into v;
 return v;
end;
$$;
revoke all on function public.nr_prepare_collection_field(uuid,uuid,text,text,integer,integer,text) from public,anon,authenticated;
grant execute on function public.nr_prepare_collection_field(uuid,uuid,text,text,integer,integer,text) to authenticated;
revoke all on function public.nr_create_version(uuid,uuid,text,jsonb,text,bigint) from public,anon;
grant execute on function public.nr_create_version(uuid,uuid,text,jsonb,text,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
select public.nr_registration_status() as registration_settings,
 'Existing-collection uploads enabled; original files and review history retained.' as upload_settings;
