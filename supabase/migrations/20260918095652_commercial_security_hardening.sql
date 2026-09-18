-- VerdoFamily commercial hardening: least privilege + private authorization helpers.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.family_role(p_family_id uuid, p_user_id uuid default auth.uid())
returns text language sql stable security definer
set search_path = public, pg_temp
as $$
  select fm.role from public.family_members fm
  where fm.family_id = p_family_id and fm.user_id = p_user_id
  limit 1
$$;

create or replace function private.is_family_member(p_family_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select p_user_id is not null and exists (
    select 1 from public.family_members fm
    where fm.family_id = p_family_id and fm.user_id = p_user_id
  )
$$;

create or replace function private.is_family_admin(p_family_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select p_user_id is not null and exists (
    select 1 from public.family_members fm
    where fm.family_id = p_family_id and fm.user_id = p_user_id and fm.role = 'admin'
  )
$$;

create or replace function private.shares_family_with(p_other_user_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select p_user_id is not null and exists (
    select 1
    from public.family_members mine
    join public.family_members theirs on theirs.family_id = mine.family_id
    where mine.user_id = p_user_id and theirs.user_id = p_other_user_id
  )
$$;

revoke all on function private.family_role(uuid,uuid) from public, anon;
revoke all on function private.is_family_member(uuid,uuid) from public, anon;
revoke all on function private.is_family_admin(uuid,uuid) from public, anon;
revoke all on function private.shares_family_with(uuid,uuid) from public, anon;
grant execute on function private.family_role(uuid,uuid) to authenticated;
grant execute on function private.is_family_member(uuid,uuid) to authenticated;
grant execute on function private.is_family_admin(uuid,uuid) to authenticated;
grant execute on function private.shares_family_with(uuid,uuid) to authenticated;

drop policy if exists families_select_member on public.families;
create policy families_select_member on public.families for select to authenticated
using ((select private.is_family_member(id, auth.uid())));

drop policy if exists families_update_admin on public.families;
create policy families_update_admin on public.families for update to authenticated
using ((select private.is_family_admin(id, auth.uid())))
with check ((select private.is_family_admin(id, auth.uid())));

drop policy if exists members_select_family on public.family_members;
create policy members_select_family on public.family_members for select to authenticated
using ((select private.is_family_member(family_id, auth.uid())));

drop policy if exists members_update_admin on public.family_members;
create policy members_update_admin on public.family_members for update to authenticated
using ((select private.is_family_admin(family_id, auth.uid())))
with check ((select private.is_family_admin(family_id, auth.uid())));

drop policy if exists members_delete_admin_or_self on public.family_members;
create policy members_delete_admin_or_self on public.family_members for delete to authenticated
using ((select private.is_family_admin(family_id, auth.uid())) or user_id = (select auth.uid()));

drop policy if exists invites_select_admin on public.family_invites;
create policy invites_select_admin on public.family_invites for select to authenticated
using ((select private.is_family_admin(family_id, auth.uid())));

drop policy if exists invites_insert_admin on public.family_invites;
create policy invites_insert_admin on public.family_invites for insert to authenticated
with check ((select private.is_family_admin(family_id, auth.uid())) and created_by = (select auth.uid()));

drop policy if exists invites_update_admin on public.family_invites;
create policy invites_update_admin on public.family_invites for update to authenticated
using ((select private.is_family_admin(family_id, auth.uid())))
with check ((select private.is_family_admin(family_id, auth.uid())));

drop policy if exists invites_delete_admin on public.family_invites;
create policy invites_delete_admin on public.family_invites for delete to authenticated
using ((select private.is_family_admin(family_id, auth.uid())));

drop policy if exists documents_select_member on public.family_documents;
drop policy if exists documents_select_adult_member on public.family_documents;
create policy documents_select_adult_member on public.family_documents for select to authenticated
using ((select private.family_role(family_id, auth.uid())) in ('admin','adult'));

drop policy if exists "family members can read backups" on public.family_backups;
drop policy if exists family_backups_select_adult on public.family_backups;
create policy family_backups_select_adult on public.family_backups for select to authenticated
using ((select private.family_role(family_id, auth.uid())) in ('admin','adult'));

drop policy if exists profiles_select_family on public.profiles;
create policy profiles_select_family on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or (select private.shares_family_with(id, auth.uid()))
);

create or replace function public.bootstrap_family_document(p_family_id uuid, p_data jsonb)
returns bigint language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_revision bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not private.is_family_admin(p_family_id, v_uid) then raise exception 'not_family_admin'; end if;
  if jsonb_typeof(coalesce(p_data, '{}'::jsonb)) <> 'object' then raise exception 'invalid_document'; end if;
  if octet_length(coalesce(p_data, '{}'::jsonb)::text) > 5242880 then raise exception 'document_too_large'; end if;

  update public.family_documents
  set data = jsonb_set(coalesce(p_data, '{}'::jsonb), '{users}', (
        select coalesce(jsonb_agg(jsonb_set(u.value, '{password}', '""'::jsonb, true)), '[]'::jsonb)
        from jsonb_array_elements(coalesce(p_data->'users','[]'::jsonb)) u(value)
      ), true),
      revision = revision + 1,
      updated_by = v_uid,
      updated_at = now()
  where family_id = p_family_id and (data = '{}'::jsonb or data is null)
  returning revision into v_revision;

  if v_revision is null then raise exception 'family_document_already_initialized'; end if;
  return v_revision;
end;
$$;

create or replace function public.create_family_invite(
  p_family_id uuid,
  p_role text default 'adult',
  p_email text default null,
  p_expires_hours integer default 168,
  p_max_uses integer default 1
)
returns text language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_attempts integer := 0;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not private.is_family_admin(p_family_id, v_uid) then raise exception 'not_family_admin'; end if;
  if p_role not in ('admin','adult','child') then raise exception 'invalid_role'; end if;
  if coalesce(p_expires_hours,0) <= 0 or p_expires_hours > 720 then raise exception 'invalid_expiry'; end if;
  if coalesce(p_max_uses,0) <= 0 or p_max_uses > 20 then raise exception 'invalid_max_uses'; end if;

  loop
    v_attempts := v_attempts + 1;
    v_code := public.make_invite_code();
    begin
      insert into public.family_invites(family_id,code,email,role,created_by,expires_at,max_uses)
      values(
        p_family_id,
        v_code,
        nullif(lower(btrim(coalesce(p_email,''))),''),
        p_role,
        v_uid,
        now() + make_interval(hours => p_expires_hours),
        p_max_uses
      );
      exit;
    exception when unique_violation then
      if v_attempts >= 5 then raise; end if;
    end;
  end loop;
  return v_code;
end;
$$;

revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;
revoke all privileges on all tables in schema public from authenticated;
revoke all privileges on all sequences in schema public from authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, username, avatar_url, color) on public.profiles to authenticated;
grant select on public.families to authenticated;
grant select on public.family_members to authenticated;
grant select on public.family_documents to authenticated;
grant select on public.family_backups to authenticated;
grant select (family_id, enabled, last_attempt_at, last_success_at, last_error)
  on public.drive_backup_configs to authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.create_family(text) to authenticated;
grant execute on function public.bootstrap_family_document(uuid,jsonb) to authenticated;
grant execute on function public.create_family_invite(uuid,text,text,integer,integer) to authenticated;
grant execute on function public.join_family_by_code(text) to authenticated;
grant execute on function public.create_family_backup(uuid,text) to authenticated;
grant execute on function public.restore_family_backup(bigint) to authenticated;
grant execute on function public.configure_drive_backup(uuid,text,text,boolean) to authenticated;
grant execute on function public.disable_drive_backup(uuid) to authenticated;
grant execute on function public.get_drive_backup_status(uuid) to authenticated;
revoke execute on function public.save_family_document(uuid,jsonb,bigint) from public, anon, authenticated;

drop function if exists public.is_family_admin(uuid,uuid);
drop function if exists public.is_family_member(uuid,uuid);
drop function if exists public.shares_family_with(uuid);

revoke create on schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
