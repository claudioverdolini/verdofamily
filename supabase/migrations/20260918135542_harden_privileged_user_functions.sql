create or replace function public.create_family(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_family_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if btrim(coalesce(p_name,'')) = '' then raise exception 'family_name_required'; end if;

  if not private.consume_security_rate_limit('create_family', v_uid::text, 5, 3600) then
    raise exception 'rate_limited';
  end if;

  insert into public.families(name, owner_id)
  values(btrim(p_name), v_uid)
  returning id into v_family_id;

  insert into public.family_members(family_id, user_id, role)
  values(v_family_id, v_uid, 'admin');

  insert into public.family_documents(family_id, data, revision, updated_by)
  values(v_family_id, '{}'::jsonb, 0, v_uid);

  perform private.write_security_audit(
    v_uid, v_family_id, 'family_created', true, 'info',
    'family', v_family_id::text, jsonb_build_object('nameLength', length(btrim(p_name)))
  );

  return v_family_id;
end;
$$;

create or replace function public.bootstrap_family_document(p_family_id uuid, p_data jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_revision bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not private.is_family_admin(p_family_id, v_uid) then raise exception 'not_family_admin'; end if;
  if jsonb_typeof(coalesce(p_data, '{}'::jsonb)) <> 'object' then raise exception 'invalid_document'; end if;
  if octet_length(coalesce(p_data, '{}'::jsonb)::text) > 5242880 then raise exception 'document_too_large'; end if;

  if not private.consume_security_rate_limit('bootstrap_family_document', v_uid::text || ':' || p_family_id::text, 10, 3600) then
    raise exception 'rate_limited';
  end if;

  update public.family_documents
  set data = jsonb_set(coalesce(p_data, '{}'::jsonb), '{users}', (
        select coalesce(jsonb_agg(jsonb_set(u.value, '{password}', '""'::jsonb, true)), '[]'::jsonb)
        from jsonb_array_elements(coalesce(p_data->'users','[]'::jsonb)) u(value)
      ), true),
      revision = revision + 1,
      updated_by = v_uid,
      updated_at = now()
  where family_id = p_family_id
    and (data = '{}'::jsonb or data is null)
  returning revision into v_revision;

  if v_revision is null then raise exception 'family_document_already_initialized'; end if;

  perform private.write_security_audit(
    v_uid, p_family_id, 'family_document_initialized', true, 'info',
    'family', p_family_id::text, jsonb_build_object('revision', v_revision)
  );

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
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_attempts integer := 0;
  v_invite_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not private.is_family_admin(p_family_id, v_uid) then raise exception 'not_family_admin'; end if;
  if p_role not in ('admin','adult','child') then raise exception 'invalid_role'; end if;
  if coalesce(p_expires_hours,0) <= 0 or p_expires_hours > 720 then raise exception 'invalid_expiry'; end if;
  if coalesce(p_max_uses,0) <= 0 or p_max_uses > 20 then raise exception 'invalid_max_uses'; end if;

  if not private.consume_security_rate_limit(
    'create_family_invite', v_uid::text || ':' || p_family_id::text, 30, 3600
  ) then
    raise exception 'rate_limited';
  end if;

  loop
    v_attempts := v_attempts + 1;
    v_code := public.make_invite_code();
    begin
      insert into public.family_invites(
        family_id, code, email, role, created_by, expires_at, max_uses
      )
      values(
        p_family_id,
        v_code,
        nullif(lower(btrim(coalesce(p_email,''))),''),
        p_role,
        v_uid,
        now() + make_interval(hours => p_expires_hours),
        p_max_uses
      )
      returning id into v_invite_id;
      exit;
    exception when unique_violation then
      if v_attempts >= 5 then raise; end if;
    end;
  end loop;

  perform private.write_security_audit(
    v_uid, p_family_id, 'family_invite_created', true, 'info',
    'family_invite', v_invite_id::text,
    jsonb_build_object(
      'role', p_role,
      'emailBound', nullif(lower(btrim(coalesce(p_email,''))),'') is not null,
      'expiresHours', p_expires_hours,
      'maxUses', p_max_uses
    )
  );

  return v_code;
end;
$$;

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
  on conflict(family_id,user_id) do nothing;

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

create or replace function public.configure_drive_backup(
  p_family_id uuid,
  p_webhook_url text,
  p_webhook_secret text,
  p_enabled boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (
    select 1 from public.families
    where id = p_family_id and owner_id = v_uid
  ) then
    raise exception 'not_authorized';
  end if;

  if p_webhook_url !~ '^https://script\.google\.com/'
     and p_webhook_url !~ '^https://script\.googleusercontent\.com/' then
    raise exception 'invalid_google_apps_script_url';
  end if;

  if not private.consume_security_rate_limit(
    'configure_drive_backup', v_uid::text || ':' || p_family_id::text, 20, 3600
  ) then
    raise exception 'rate_limited';
  end if;

  insert into public.drive_backup_configs(family_id, webhook_url, webhook_secret, enabled, updated_at)
  values (p_family_id, trim(p_webhook_url), p_webhook_secret, p_enabled, now())
  on conflict (family_id) do update
    set webhook_url = excluded.webhook_url,
        webhook_secret = excluded.webhook_secret,
        enabled = excluded.enabled,
        updated_at = now();

  perform private.write_security_audit(
    v_uid, p_family_id, 'drive_backup_configured', true, 'info',
    'drive_backup', p_family_id::text, jsonb_build_object('enabled', p_enabled)
  );
end;
$$;

create or replace function public.disable_drive_backup(p_family_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (
    select 1 from public.families
    where id = p_family_id and owner_id = v_uid
  ) then
    raise exception 'not_authorized';
  end if;

  update public.drive_backup_configs
  set enabled = false, updated_at = now()
  where family_id = p_family_id;

  perform private.write_security_audit(
    v_uid, p_family_id, 'drive_backup_disabled', true, 'info',
    'drive_backup', p_family_id::text, '{}'::jsonb
  );
end;
$$;

create or replace function public.create_family_backup(
  p_family_id uuid,
  p_reason text default 'manual'
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_role text;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_role := private.family_role(p_family_id, v_uid);
  if v_role not in ('admin','adult') then raise exception 'adult_or_admin_required'; end if;

  if not private.consume_security_rate_limit(
    'create_family_backup', v_uid::text || ':' || p_family_id::text, 30, 3600
  ) then
    raise exception 'rate_limited';
  end if;

  insert into public.family_backups(
    family_id, revision, data, health_data, finance_data, school_data,
    backup_format_version, reason, created_by
  )
  select
    family_id,
    revision,
    private.family_data_without_sensitive(data),
    private.health_backup_snapshot(family_id),
    private.finance_backup_snapshot(family_id),
    private.school_backup_snapshot(family_id),
    4,
    coalesce(nullif(trim(p_reason), ''), 'manual'),
    v_uid
  from public.family_documents
  where family_id = p_family_id
  returning id into v_id;

  if v_id is null then raise exception 'family_document_not_found'; end if;

  perform private.write_security_audit(
    v_uid, p_family_id, 'family_backup_created', true, 'info',
    'family_backup', v_id::text,
    jsonb_build_object('reason', left(coalesce(nullif(trim(p_reason), ''), 'manual'), 80))
  );

  return v_id;
end;
$$;

create or replace function public.restore_family_backup(p_backup_id bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family_id uuid;
  v_data jsonb;
  v_health_data jsonb;
  v_finance_data jsonb;
  v_school_data jsonb;
  v_revision bigint;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select b.family_id, b.data, b.health_data, b.finance_data, b.school_data
  into v_family_id, v_data, v_health_data, v_finance_data, v_school_data
  from public.family_backups b
  where b.id = p_backup_id;

  if v_family_id is null then raise exception 'backup_not_found'; end if;
  if not private.is_family_admin(v_family_id, v_uid) then raise exception 'family_admin_required'; end if;

  if not private.consume_security_rate_limit(
    'restore_family_backup', v_uid::text || ':' || v_family_id::text, 5, 3600
  ) then
    raise exception 'rate_limited';
  end if;

  insert into public.family_backups(
    family_id, revision, data, health_data, finance_data, school_data,
    backup_format_version, reason, created_by
  )
  select
    fd.family_id,
    fd.revision,
    private.family_data_without_sensitive(fd.data),
    private.health_backup_snapshot(fd.family_id),
    private.finance_backup_snapshot(fd.family_id),
    private.school_backup_snapshot(fd.family_id),
    4,
    'pre_restore',
    v_uid
  from public.family_documents fd
  where fd.family_id = v_family_id;

  perform private.restore_health_backup(v_family_id, v_health_data, v_data);
  perform private.restore_finance_backup(v_family_id, v_finance_data, v_data);
  perform private.restore_school_backup(v_family_id, v_school_data, v_data);

  perform set_config('app.skip_family_backup_trigger', 'on', true);
  update public.family_documents
  set data = private.family_data_without_sensitive(v_data),
      revision = revision + 1,
      updated_by = v_uid,
      updated_at = now()
  where family_id = v_family_id
  returning revision into v_revision;
  perform set_config('app.skip_family_backup_trigger', 'off', true);

  if v_revision is null then raise exception 'family_document_not_found'; end if;

  perform private.write_security_audit(
    v_uid, v_family_id, 'family_backup_restored', true, 'warning',
    'family_backup', p_backup_id::text,
    jsonb_build_object('revision', v_revision)
  );

  return v_revision;
end;
$$;

revoke all on function public.create_family(text) from public, anon;
revoke all on function public.bootstrap_family_document(uuid,jsonb) from public, anon;
revoke all on function public.create_family_invite(uuid,text,text,integer,integer) from public, anon;
revoke all on function public.join_family_by_code(text) from public, anon;
revoke all on function public.configure_drive_backup(uuid,text,text,boolean) from public, anon;
revoke all on function public.disable_drive_backup(uuid) from public, anon;
revoke all on function public.create_family_backup(uuid,text) from public, anon;
revoke all on function public.restore_family_backup(bigint) from public, anon;

grant execute on function public.create_family(text) to authenticated;
grant execute on function public.bootstrap_family_document(uuid,jsonb) to authenticated;
grant execute on function public.create_family_invite(uuid,text,text,integer,integer) to authenticated;
grant execute on function public.join_family_by_code(text) to authenticated;
grant execute on function public.configure_drive_backup(uuid,text,text,boolean) to authenticated;
grant execute on function public.disable_drive_backup(uuid) to authenticated;
grant execute on function public.create_family_backup(uuid,text) to authenticated;
grant execute on function public.restore_family_backup(bigint) to authenticated;
