-- VerdoFamily / Family Hub backend
-- Auth: Supabase Auth (email + password)
-- Multi-family: membership + invite code
-- App data: one versioned JSON document per family for reliable migration from the current local store.
-- The document approach keeps every existing feature working while providing multi-device sync + realtime.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Common helpers
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.make_invite_code()
returns text
language sql
volatile
as $$
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
$$;

-- -----------------------------------------------------------------------------
-- Profiles / families / memberships
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  username text,
  avatar_url text,
  color text not null default '#38bdf8',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_uidx
  on public.profiles (lower(username))
  where username is not null and btrim(username) <> '';

create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.family_members (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'adult' check (role in ('admin', 'adult', 'child')),
  prefs jsonb not null default '{}'::jsonb,
  joined_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

create index if not exists family_members_user_id_idx on public.family_members(user_id);

create table if not exists public.family_invites (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  code text not null default public.make_invite_code(),
  email text,
  role text not null default 'adult' check (role in ('admin', 'adult', 'child')),
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '7 days'),
  max_uses integer not null default 1 check (max_uses > 0),
  uses integer not null default 0 check (uses >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (code)
);

create index if not exists family_invites_family_id_idx on public.family_invites(family_id);
create index if not exists family_invites_code_idx on public.family_invites(code);

-- One canonical app document per family. It stores the current FamilyData object.
-- Revision is used for optimistic concurrency, avoiding silent overwrites.
create table if not exists public.family_documents (
  family_id uuid primary key references public.families(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Identity/profile trigger
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(new.email, ''), '@', 1), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- Backfill profiles for auth users that existed before this migration.
insert into public.profiles (id, display_name)
select
  u.id,
  coalesce(nullif(u.raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(u.email, ''), '@', 1), '')
from auth.users u
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Membership helpers used by RLS
-- -----------------------------------------------------------------------------

create or replace function public.is_family_member(p_family_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.family_members fm
    where fm.family_id = p_family_id
      and fm.user_id = p_user_id
  );
$$;

create or replace function public.is_family_admin(p_family_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.family_members fm
    where fm.family_id = p_family_id
      and fm.user_id = p_user_id
      and fm.role = 'admin'
  );
$$;

create or replace function public.shares_family_with(p_other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.family_members mine
    join public.family_members theirs on theirs.family_id = mine.family_id
    where mine.user_id = auth.uid()
      and theirs.user_id = p_other_user_id
  );
$$;

-- -----------------------------------------------------------------------------
-- Family operations
-- -----------------------------------------------------------------------------

create or replace function public.create_family(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_family_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'family_name_required';
  end if;

  insert into public.families (name, owner_id)
  values (btrim(p_name), v_uid)
  returning id into v_family_id;

  insert into public.family_members (family_id, user_id, role)
  values (v_family_id, v_uid, 'admin');

  insert into public.family_documents (family_id, data, revision, updated_by)
  values (v_family_id, '{}'::jsonb, 0, v_uid);

  return v_family_id;
end;
$$;

create or replace function public.create_family_invite(
  p_family_id uuid,
  p_role text default 'adult',
  p_email text default null,
  p_expires_hours integer default 168,
  p_max_uses integer default 1
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_attempts integer := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if not public.is_family_admin(p_family_id, v_uid) then
    raise exception 'not_family_admin';
  end if;

  if p_role not in ('admin', 'adult', 'child') then
    raise exception 'invalid_role';
  end if;

  if coalesce(p_expires_hours, 0) <= 0 then
    raise exception 'invalid_expiry';
  end if;

  if coalesce(p_max_uses, 0) <= 0 then
    raise exception 'invalid_max_uses';
  end if;

  loop
    v_attempts := v_attempts + 1;
    v_code := public.make_invite_code();
    begin
      insert into public.family_invites (
        family_id,
        code,
        email,
        role,
        created_by,
        expires_at,
        max_uses
      )
      values (
        p_family_id,
        v_code,
        nullif(lower(btrim(coalesce(p_email, ''))), ''),
        p_role,
        v_uid,
        now() + make_interval(hours => p_expires_hours),
        p_max_uses
      );
      exit;
    exception when unique_violation then
      if v_attempts >= 5 then
        raise;
      end if;
    end;
  end loop;

  return v_code;
end;
$$;

create or replace function public.join_family_by_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_invite public.family_invites%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select *
  into v_invite
  from public.family_invites
  where code = upper(btrim(coalesce(p_code, '')))
    and active = true
    and expires_at > now()
    and uses < max_uses
  for update;

  if not found then
    raise exception 'invite_invalid_or_expired';
  end if;

  if v_invite.email is not null and lower(v_invite.email) <> v_email then
    raise exception 'invite_email_mismatch';
  end if;

  insert into public.family_members (family_id, user_id, role)
  values (v_invite.family_id, v_uid, v_invite.role)
  on conflict (family_id, user_id) do nothing;

  update public.family_invites
  set
    uses = uses + 1,
    active = case when uses + 1 >= max_uses then false else active end,
    updated_at = now()
  where id = v_invite.id;

  return v_invite.family_id;
end;
$$;

-- Versioned save. The app must send the revision it last read.
create or replace function public.save_family_document(
  p_family_id uuid,
  p_data jsonb,
  p_expected_revision bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_revision bigint;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if not public.is_family_member(p_family_id, v_uid) then
    raise exception 'not_family_member';
  end if;

  update public.family_documents
  set
    data = coalesce(p_data, '{}'::jsonb),
    revision = revision + 1,
    updated_by = v_uid,
    updated_at = now()
  where family_id = p_family_id
    and revision = p_expected_revision
  returning revision into v_revision;

  if v_revision is null then
    raise exception 'revision_conflict';
  end if;

  return v_revision;
end;
$$;

-- -----------------------------------------------------------------------------
-- Timestamps
-- -----------------------------------------------------------------------------

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists families_set_updated_at on public.families;
create trigger families_set_updated_at
before update on public.families
for each row execute function public.set_updated_at();

drop trigger if exists family_invites_set_updated_at on public.family_invites;
create trigger family_invites_set_updated_at
before update on public.family_invites
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.family_invites enable row level security;
alter table public.family_documents enable row level security;

-- Profiles: you can see yourself and people who share one of your families.
drop policy if exists profiles_select_family on public.profiles;
create policy profiles_select_family
on public.profiles for select
to authenticated
using (id = auth.uid() or public.shares_family_with(id));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Families
drop policy if exists families_select_member on public.families;
create policy families_select_member
on public.families for select
to authenticated
using (public.is_family_member(id));

drop policy if exists families_update_admin on public.families;
create policy families_update_admin
on public.families for update
to authenticated
using (public.is_family_admin(id))
with check (public.is_family_admin(id));

drop policy if exists families_delete_owner on public.families;
create policy families_delete_owner
on public.families for delete
to authenticated
using (owner_id = auth.uid());

-- Memberships
drop policy if exists members_select_family on public.family_members;
create policy members_select_family
on public.family_members for select
to authenticated
using (public.is_family_member(family_id));

drop policy if exists members_update_admin on public.family_members;
create policy members_update_admin
on public.family_members for update
to authenticated
using (public.is_family_admin(family_id))
with check (public.is_family_admin(family_id));

drop policy if exists members_delete_admin_or_self on public.family_members;
create policy members_delete_admin_or_self
on public.family_members for delete
to authenticated
using (public.is_family_admin(family_id) or user_id = auth.uid());

-- Invites are visible/manageable only by family admins. Joining uses the RPC above.
drop policy if exists invites_select_admin on public.family_invites;
create policy invites_select_admin
on public.family_invites for select
to authenticated
using (public.is_family_admin(family_id));

drop policy if exists invites_insert_admin on public.family_invites;
create policy invites_insert_admin
on public.family_invites for insert
to authenticated
with check (public.is_family_admin(family_id) and created_by = auth.uid());

drop policy if exists invites_update_admin on public.family_invites;
create policy invites_update_admin
on public.family_invites for update
to authenticated
using (public.is_family_admin(family_id))
with check (public.is_family_admin(family_id));

drop policy if exists invites_delete_admin on public.family_invites;
create policy invites_delete_admin
on public.family_invites for delete
to authenticated
using (public.is_family_admin(family_id));

-- Family documents: all members can read. Writes go through save_family_document()
-- to preserve optimistic concurrency.
drop policy if exists documents_select_member on public.family_documents;
create policy documents_select_member
on public.family_documents for select
to authenticated
using (public.is_family_member(family_id));

-- -----------------------------------------------------------------------------
-- Function permissions
-- -----------------------------------------------------------------------------

revoke all on function public.create_family(text) from public;
revoke all on function public.create_family_invite(uuid, text, text, integer, integer) from public;
revoke all on function public.join_family_by_code(text) from public;
revoke all on function public.save_family_document(uuid, jsonb, bigint) from public;

grant execute on function public.create_family(text) to authenticated;
grant execute on function public.create_family_invite(uuid, text, text, integer, integer) to authenticated;
grant execute on function public.join_family_by_code(text) to authenticated;
grant execute on function public.save_family_document(uuid, jsonb, bigint) to authenticated;

-- Realtime sync for the family document.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'family_documents'
  ) then
    alter publication supabase_realtime add table public.family_documents;
  end if;
end $$;
