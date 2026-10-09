-- Nuclei Review Hub: feedback removal and recoverable Trash.
-- Run in Supabase SQL Editor / Database, after schema.sql and the upload RLS fix.
-- This migration does NOT delete any existing data. Source files are never changed.
-- Trash hides fields/collections from ALL normal members, but does not free Storage space.
-- Comments lose their text; replies keep a tombstone. Proposals/decisions are withdrawn.
-- Permanent file deletion is deliberately NOT enabled by this migration.
begin;

alter table public.nr_collections add column if not exists trashed_at timestamptz;
alter table public.nr_collections add column if not exists trashed_by uuid references public.nr_members(user_id);
alter table public.nr_fields add column if not exists trashed_at timestamptz;
alter table public.nr_fields add column if not exists trashed_by uuid references public.nr_members(user_id);
alter table public.nr_comments add column if not exists removed_at timestamptz;
alter table public.nr_comments add column if not exists removed_by uuid references public.nr_members(user_id);
alter table public.nr_proposals add column if not exists removed_at timestamptz;
alter table public.nr_proposals add column if not exists removed_by uuid references public.nr_members(user_id);
alter table public.nr_reviews add column if not exists removed_at timestamptz;
alter table public.nr_reviews add column if not exists removed_by uuid references public.nr_members(user_id);

create table if not exists public.nr_management_events (
 id uuid primary key default gen_random_uuid(),
 target_type text not null,
 target_id uuid not null,
 action text not null,
 actor_id uuid not null references public.nr_members(user_id),
 created_at timestamptz not null default now()
);
alter table public.nr_management_events enable row level security;
revoke all on public.nr_management_events from public,anon,authenticated;
grant select on public.nr_management_events to authenticated;
drop policy if exists nr_management_event_read on public.nr_management_events;
create policy nr_management_event_read on public.nr_management_events for select to authenticated
 using (public.nr_is_admin());

-- Keep the earlier INSERT ... RETURNING fix: evaluate the current row directly.
create or replace function public.nr_can_read_collection(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.nr_is_member() and exists(
  select 1 from public.nr_collections c where c.id=p_id and c.trashed_at is null
   and (c.state='ready' or c.owner_id=auth.uid())
 );
$$;
create or replace function public.nr_can_read_field(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.nr_fields f where f.id=p_id
  and f.trashed_at is null and public.nr_can_read_collection(f.collection_id));
$$;
alter policy nr_collection_read on public.nr_collections to authenticated using (
 public.nr_is_member() and trashed_at is null and (state='ready' or owner_id=(select auth.uid()))
);
alter policy nr_field_read on public.nr_fields to authenticated using (
 trashed_at is null and public.nr_can_read_collection(collection_id)
);
-- Existing version, feedback and Storage SELECT policies call these helpers, so
-- the restriction applies to direct API requests too, not just to the gallery UI.
create or replace function public.nr_storage_write(p_name text) returns boolean
language sql stable security definer set search_path='' as $$
 select public.nr_is_member() and exists(select 1 from public.nr_versions v
  where p_name in(v.object_path,v.thumbnail_path) and v.state='draft'
   and v.author_id=auth.uid() and public.nr_can_read_field(v.field_id));
$$;

create or replace function public.nr_management_version() returns text
language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or not public.nr_is_member() then
  raise exception 'Active workspace membership required' using errcode='42501';
 end if;
 return 'trash-feedback-v1';
end;
$$;

create or replace function public.nr_trash_item(p_type text,p_id uuid,p_restore boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); is_admin boolean; row_owner uuid; row_name text;
 previous_time timestamptz; parent_id uuid; parent_trash timestamptz; changed boolean;
begin
 if u is null or not public.nr_is_member() then
  raise exception 'Active workspace membership required' using errcode='42501';
 end if;
 if p_type not in ('collection','field') or p_type is null or p_restore is null then
  raise exception 'Invalid Trash request';
 end if;
 is_admin:=public.nr_is_admin();
 if p_type='collection' then
  select c.owner_id,c.title,c.trashed_at into row_owner,row_name,previous_time
   from public.nr_collections c where c.id=p_id for update;
 else
  select f.created_by,f.name,f.trashed_at,f.collection_id into row_owner,row_name,previous_time,parent_id
   from public.nr_fields f where f.id=p_id for update;
 end if;
 if row_owner is null or (row_owner=u or is_admin) is not true then
  raise exception 'Only the upload owner or a workspace administrator may manage this item' using errcode='42501';
 end if;
 if p_type='field' then
  select c.trashed_at into parent_trash from public.nr_collections c where c.id=parent_id for share;
  if parent_trash is not null then
   raise exception 'Restore the containing collection first';
  end if;
 end if;
 changed:=(p_restore and previous_time is not null) or (not p_restore and previous_time is null);
 if changed then
  if p_type='collection' then
   update public.nr_collections set trashed_at=case when p_restore then null else now() end,
    trashed_by=case when p_restore then null else u end where id=p_id;
  else
   update public.nr_fields set trashed_at=case when p_restore then null else now() end,
    trashed_by=case when p_restore then null else u end where id=p_id;
  end if;
  insert into public.nr_management_events(target_type,target_id,action,actor_id)
   values(p_type,p_id,case when p_restore then 'restore' else 'trash' end,u);
 end if;
 return jsonb_build_object('id',p_id,'type',p_type,'name',row_name,
  'action',case when p_restore then 'restore' else 'trash' end,'changed',changed);
end;
$$;

create or replace function public.nr_list_trash()
returns table(item_type text,item_id uuid,item_name text,collection_name text,removed_at timestamptz,owner_name text)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.nr_is_member() then
  raise exception 'Active workspace membership required' using errcode='42501';
 end if;
 return query
 select q.* from (
  select 'collection'::text,c.id,c.title,c.title,c.trashed_at,m.display_name
   from public.nr_collections c join public.nr_members m on m.user_id=c.owner_id
   where c.trashed_at is not null and (c.owner_id=auth.uid() or public.nr_is_admin())
  union all
  select 'field'::text,f.id,f.name,c.title,f.trashed_at,m.display_name
   from public.nr_fields f join public.nr_collections c on c.id=f.collection_id
   join public.nr_members m on m.user_id=f.created_by
   where f.trashed_at is not null and c.trashed_at is null
    and (f.created_by=auth.uid() or public.nr_is_admin())
 ) q order by q.trashed_at desc;
end;
$$;

create or replace function public.nr_remove_feedback(p_type text,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); row_author uuid; v uuid; previous_time timestamptz;
begin
 if u is null or not public.nr_is_member() then
  raise exception 'Active workspace membership required' using errcode='42501';
 end if;
 if p_type='comment' then
  select c.author_id,c.version_id,c.removed_at into row_author,v,previous_time
   from public.nr_comments c where c.id=p_id for update;
 elsif p_type='proposal' then
  select p.author_id,p.version_id,p.removed_at into row_author,v,previous_time
   from public.nr_proposals p where p.id=p_id for update;
 elsif p_type='review' then
  select r.author_id,r.version_id,r.removed_at into row_author,v,previous_time
   from public.nr_reviews r where r.id=p_id for update;
 else raise exception 'Invalid feedback type';
 end if;
 if row_author is null or (row_author=u or public.nr_is_admin()) is not true
  or not public.nr_ready_version(v) then
  raise exception 'Only the author or an administrator may remove feedback on an accessible version' using errcode='42501';
 end if;
 if previous_time is not null then return jsonb_build_object('id',p_id,'changed',false); end if;
 if p_type='comment' then
  -- Do not cascade-delete other people's replies. Retain IDs/author/time only.
  update public.nr_comments set body='[Deleted comment]',roi_ref='',anchor=null,
   removed_at=now(),removed_by=u where id=p_id;
 elsif p_type='proposal' then
  update public.nr_proposals set label='[Withdrawn proposal]',note='',
   geometry='{"type":"polygon","points":[]}'::jsonb,removed_at=now(),removed_by=u where id=p_id;
 else
  update public.nr_reviews set verdict='discussion',body='[Withdrawn decision]',
   removed_at=now(),removed_by=u where id=p_id;
 end if;
 insert into public.nr_management_events(target_type,target_id,action,actor_id)
  values(p_type,p_id,case when p_type='comment' then 'delete_text' else 'withdraw' end,u);
 return jsonb_build_object('id',p_id,'changed',true);
end;
$$;

-- Publishing a draft must not revive an item that has been moved to Trash.
create or replace function public.nr_publish_version(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v public.nr_versions;
begin
 if auth.uid() is null or not public.nr_is_member() then raise exception 'Not authorized' using errcode='42501'; end if;
 select * into v from public.nr_versions where id=p_id for update;
 if v.id is null or v.author_id<>auth.uid() or not public.nr_can_read_field(v.field_id) then
  raise exception 'Not the author of an accessible upload' using errcode='42501';
 end if;
 if not exists(select 1 from storage.objects where bucket_id='nuclei-private' and name=v.object_path and (metadata->>'size')::bigint=v.archive_bytes) then raise exception 'Source upload is not complete'; end if;
 if not exists(select 1 from storage.objects where bucket_id='nuclei-private' and name=v.thumbnail_path) then raise exception 'Thumbnail is not complete'; end if;
 update public.nr_versions set state='ready' where id=p_id;
end;
$$;
create or replace function public.nr_publish_collection(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c public.nr_collections;
begin
 if auth.uid() is null or not public.nr_is_member() then raise exception 'Not authorized' using errcode='42501'; end if;
 select * into c from public.nr_collections where id=p_id for update;
 if c.id is null or c.owner_id<>auth.uid() or c.trashed_at is not null then
  raise exception 'Not the owner of an accessible collection' using errcode='42501';
 end if;
 if not exists(select 1 from public.nr_fields where collection_id=p_id and trashed_at is null) then raise exception 'Empty collection'; end if;
 if exists(select 1 from public.nr_fields f where f.collection_id=p_id and f.trashed_at is null
  and not exists(select 1 from public.nr_versions v where v.field_id=f.id and v.state='ready')) then raise exception 'Some fields have no complete version'; end if;
 update public.nr_collections set state='ready' where id=p_id;
end;
$$;

-- Do not allow new replies to a deleted parent. Existing replies remain intact.
create or replace function public.nr_validate_annotation() returns trigger
language plpgsql set search_path='' as $$
declare w integer; h integer;
begin
 select f.width,f.height into w,h from public.nr_fields f join public.nr_versions v on v.field_id=f.id where v.id=new.version_id;
 if w is null then raise exception 'Unknown or inaccessible field'; end if;
 if tg_table_name='nr_proposals' then
  if not public.nr_valid_geometry(new.geometry,w,h,true) then raise exception 'Invalid proposal geometry'; end if;
 else
  if new.anchor is not null and not public.nr_valid_geometry(new.anchor,w,h,false) then raise exception 'Invalid comment anchor'; end if;
  if new.reply_to is not null and not exists(select 1 from public.nr_comments c where c.id=new.reply_to and c.version_id=new.version_id and c.removed_at is null) then
   raise exception 'Reply must reference a non-deleted comment in the same version';
  end if;
 end if;
 return new;
end;
$$;

-- Neither direct DELETE nor arbitrary UPDATE is granted on the source/feedback tables.
revoke all on function public.nr_management_version(),public.nr_trash_item(text,uuid,boolean),public.nr_list_trash(),public.nr_remove_feedback(text,uuid) from public,anon,authenticated;
grant execute on function public.nr_management_version(),public.nr_trash_item(text,uuid,boolean),public.nr_list_trash(),public.nr_remove_feedback(text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;

select 'Delete / withdraw feedback and recoverable Trash installed. No existing data deleted.' as result;
