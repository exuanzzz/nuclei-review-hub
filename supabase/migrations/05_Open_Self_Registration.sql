-- Nuclei Review Hub / 05: public registration with verified-email auto-enrollment.
-- 在当前 Nuclei Review 项目的 SQL Editor / Database 中运行。
-- 此脚本允许任何具有已确认邮箱的正常账号，在首次登录时自动加入共享工作空间。
-- 新成员固定为 contributor，可访问所有已发布集合；不会成为 reviewer 或 admin。
-- 不改变现有图片、原始 ROI、Storage 私有桶或现有表的 RLS，不自动加入历史账号。
-- Supabase 的 Allow new users to sign up 和 Confirm email 仍须开启，并配置 SMTP。
-- 已被停用的成员不会通过再次登录恢复权限。此脚本不会修改现有成员角色。
begin;

-- 独立私有 schema：客户端不能直接读取或修改注册开关。
create schema if not exists nr_registration_private;
revoke all on schema nr_registration_private from public, anon, authenticated;
create table if not exists nr_registration_private.settings (
    singleton boolean primary key default true check (singleton),
    enabled boolean not null default false,
    changed_at timestamptz not null default now()
);
alter table nr_registration_private.settings enable row level security;
revoke all on table nr_registration_private.settings from public, anon, authenticated;
-- 首次安装启用公开加入；重复运行不覆盖后来主动暂停的状态。
insert into nr_registration_private.settings(singleton, enabled)
values (true, true) on conflict (singleton) do nothing;

-- 未登录访客只能读取是否开放注册，不会收到成员名单、邮箱、图片或文件路径。
create or replace function public.nr_registration_status() returns jsonb
language sql stable security definer set search_path = '' as $$
    select jsonb_build_object(
        'enabled', coalesce((select enabled from nr_registration_private.settings where singleton), false),
        'default_role', 'contributor',
        'email_confirmation_required', true
    );
$$;

-- 只允许当前已认证用户为自己加入；无可指定的用户 ID 或角色参数。
create or replace function public.nr_join_open_workspace() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
    caller uuid := auth.uid();
    auth_record record;
    member_record public.nr_members;
    registration_open boolean;
    safe_name text;
begin
    if caller is null then
        raise exception 'Please sign in before joining.' using errcode = '42501';
    end if;
    -- 同一账号并发首次登录会被串行处理，不创建重复成员。
    select id, email, email_confirmed_at, is_anonymous, banned_until, raw_user_meta_data
      into auth_record from auth.users where id = caller for update;
    if not found then
        raise exception 'Your authentication account is unavailable.' using errcode = '42501';
    end if;
    if coalesce(auth_record.is_anonymous, false)
       or auth_record.email is null or btrim(auth_record.email) = ''
       or auth_record.email_confirmed_at is null then
        raise exception 'Confirm your email address before joining this workspace.' using errcode = '42501';
    end if;
    if auth_record.banned_until > now() then
        raise exception 'This authentication account is suspended.' using errcode = '42501';
    end if;
    select * into member_record from public.nr_members where user_id = caller for update;
    if found then
        if not member_record.active then
            raise exception 'Your workspace access was revoked. Contact the administrator.' using errcode = '42501';
        end if;
        -- 已存在的管理员/审核员不降级，也不受新注册暂停影响。
        return jsonb_build_object('joined', false, 'role', member_record.role);
    end if;
    select enabled into registration_open from nr_registration_private.settings
      where singleton for share;
    if registration_open is distinct from true then
        raise exception 'Public joining is currently paused.' using errcode = '42501';
    end if;
    -- 用户可修改的 metadata 仅用于显示名，绝不用于决定角色或 active 状态。
    safe_name := left(btrim(regexp_replace(
        coalesce(auth_record.raw_user_meta_data->>'display_name', ''),
        '[[:cntrl:]]', '', 'g')), 80);
    if safe_name = '' then safe_name := 'Member ' || left(caller::text, 8); end if;
    insert into public.nr_members(user_id, display_name, role, active)
    values (caller, safe_name, 'contributor', true)
    on conflict (user_id) do nothing;
    select * into member_record from public.nr_members where user_id = caller for update;
    if member_record.user_id is null or not member_record.active then
        raise exception 'Workspace access is not active.' using errcode = '42501';
    end if;
    return jsonb_build_object('joined', true, 'role', member_record.role);
end;
$$;

-- 管理员可以暂停/重新开放加入；不会删除成员或数据，也不会授予任何人新角色。
create or replace function public.nr_set_open_registration(p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
    if auth.uid() is null or not public.nr_is_admin() then
        raise exception 'Workspace administrator required.' using errcode = '42501';
    end if;
    if p_enabled is null then raise exception 'An explicit true or false value is required.'; end if;
    update nr_registration_private.settings
       set enabled = p_enabled, changed_at = now() where singleton;
    return public.nr_registration_status();
end;
$$;

-- 明确限定调用者，不授予客户端对成员表的直接 INSERT/UPDATE 权限。
revoke all on function public.nr_registration_status(), public.nr_join_open_workspace(),
    public.nr_set_open_registration(boolean) from public, anon, authenticated;
grant execute on function public.nr_registration_status() to anon, authenticated;
grant execute on function public.nr_join_open_workspace() to authenticated;
grant execute on function public.nr_set_open_registration(boolean) to authenticated;
notify pgrst, 'reload schema';
commit;

-- 返回 enabled=true 代表应用侧已允许自动加入，邮件/注册设置仍需在 Auth 后台完成。
select public.nr_registration_status() as registration_settings;
