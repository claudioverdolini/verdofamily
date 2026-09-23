-- Link invited cloud accounts to the app-level family user immediately.
-- This prevents child memberships from being created without a matching
-- cloudUserId inside family_documents, which made family-document-gateway
-- reject the first read with child_identity_not_linked.

create or replace function private.link_family_member_identity(
  p_family_id uuid,
  p_user_id uuid,
  p_role text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc jsonb;
  v_users jsonb;
  v_revision bigint;
  v_profile_name text;
  v_profile_color text;
  v_profile_avatar text;
  v_app_role text;
  v_legacy_id bigint;
  v_index integer;
  v_user jsonb;
begin
  if p_family_id is null or p_user_id is null then
    raise exception 'invalid_identity';
  end if;

  if p_role not in ('admin','adult','child') then
    raise exception 'invalid_role';
  end if;

  select
    coalesce(nullif(btrim(p.display_name), ''), nullif(split_part(u.email, '@', 1), ''), 'Utente'),
    coalesce(nullif(btrim(p.color), ''), '#5B5BD6'),
    coalesce(p.avatar_url, '')
  into v_profile_name, v_profile_color, v_profile_avatar
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = p_user_id;

  if v_profile_name is null then
    raise exception 'profile_not_found';
  end if;

  v_app_role := case
    when p_role = 'admin' then 'admin'
    when p_role = 'child' then 'bimbo'
    else 'adulto'
  end;

  select coalesce(fd.data, '{}'::jsonb), coalesce(fd.revision, 0)
  into v_doc, v_revision
  from public.family_documents fd
  where fd.family_id = p_family_id
  for update;

  if not found then
    raise exception 'family_document_not_found';
  end if;

  v_users := case
    when jsonb_typeof(v_doc->'users') = 'array' then v_doc->'users'
    else '[]'::jsonb
  end;

  -- Prefer an already-linked user.
  select
    (entry.value->>'id')::bigint,
    (entry.ordinality - 1)::integer
  into v_legacy_id, v_index
  from jsonb_array_elements(v_users) with ordinality as entry(value, ordinality)
  where coalesce(entry.value->>'cloudUserId', '') = p_user_id::text
    and coalesce(entry.value->>'id', '') ~ '^[0-9]+$'
  order by entry.ordinality
  limit 1;

  -- Otherwise reuse a same-name local profile when possible.
  if v_legacy_id is null then
    select
      (entry.value->>'id')::bigint,
      (entry.ordinality - 1)::integer
    into v_legacy_id, v_index
    from jsonb_array_elements(v_users) with ordinality as entry(value, ordinality)
    where coalesce(entry.value->>'cloudUserId', '') = ''
      and coalesce(entry.value->>'id', '') ~ '^[0-9]+$'
      and lower(btrim(coalesce(entry.value->>'name', ''))) = lower(btrim(v_profile_name))
    order by entry.ordinality
    limit 1;
  end if;

  if v_legacy_id is null then
    select coalesce(max((entry.value->>'id')::bigint), 0) + 1
    into v_legacy_id
    from jsonb_array_elements(v_users) as entry(value)
    where coalesce(entry.value->>'id', '') ~ '^[0-9]+$';

    v_user := jsonb_build_object(
      'id', v_legacy_id,
      'cloudUserId', p_user_id::text,
      'name', v_profile_name,
      'role', v_app_role,
      'password', '',
      'color', v_profile_color,
      'avatarUrl', v_profile_avatar,
      'balance', 0,
      'prefs', '{}'::jsonb
    );
    v_users := v_users || jsonb_build_array(v_user);
  else
    v_user := coalesce(v_users->v_index, '{}'::jsonb) || jsonb_build_object(
      'id', v_legacy_id,
      'cloudUserId', p_user_id::text,
      'name', v_profile_name,
      'role', v_app_role,
      'password', '',
      'color', v_profile_color,
      'avatarUrl', v_profile_avatar
    );
    v_users := jsonb_set(v_users, array[v_index::text], v_user, false);
  end if;

  if (v_doc->'users') is distinct from v_users then
    update public.family_documents
    set data = jsonb_set(v_doc, '{users}', v_users, true),
        revision = v_revision + 1,
        updated_by = p_user_id,
        updated_at = now()
    where family_id = p_family_id;
  end if;

  insert into public.family_people(
    family_id,
    legacy_user_id,
    auth_user_id,
    display_name,
    role,
    updated_at
  )
  values(
    p_family_id,
    v_legacy_id,
    p_user_id,
    v_profile_name,
    p_role,
    now()
  )
  on conflict (family_id, legacy_user_id) do update
    set auth_user_id = excluded.auth_user_id,
        display_name = excluded.display_name,
        role = excluded.role,
        updated_at = now();

  return v_legacy_id;
end;
$$;

revoke all on function private.link_family_member_identity(uuid,uuid,text) from public;

create or replace function public.join_family_by_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
  v_invite public.family_invites%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  if not private.consume_security_rate_limit('join_family_by_code', v_uid::text, 20, 600) then
    raise exception 'rate_limited';
  end if;

  select * into v_invite
  from public.family_invites
  where code = upper(btrim(coalesce(p_code,'')))
    and active = true
    and expires_at > now()
    and uses < max_uses
  for update;

  if not found then raise exception 'invite_invalid_or_expired'; end if;
  if v_invite.email is not null and lower(v_invite.email) <> v_email then
    raise exception 'invite_email_mismatch';
  end if;

  insert into public.family_members(family_id, user_id, role)
  values(v_invite.family_id, v_uid, v_invite.role)
  on conflict(family_id,user_id) do update
    set role = excluded.role;

  -- Keep the app document and normalized identity map in sync with membership
  -- before the client performs its first family read.
  perform private.link_family_member_identity(v_invite.family_id, v_uid, v_invite.role);

  update public.family_invites
  set uses = uses + 1,
      active = case when uses + 1 >= max_uses then false else active end,
      updated_at = now()
  where id = v_invite.id;

  perform private.write_security_audit(
    v_uid, v_invite.family_id, 'family_joined_by_invite', true, 'info',
    'family_invite', v_invite.id::text,
    jsonb_build_object('role', v_invite.role)
  );

  return v_invite.family_id;
end;
$$;

grant execute on function public.join_family_by_code(text) to authenticated;

-- Repair memberships created before this fix. The helper is idempotent and
-- links an existing same-name local profile when available.
do $$
declare
  r record;
begin
  for r in
    select fm.family_id, fm.user_id, fm.role
    from public.family_members fm
  loop
    perform private.link_family_member_identity(r.family_id, r.user_id, r.role);
  end loop;
end;
$$;
