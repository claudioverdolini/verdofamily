create table if not exists private.security_rate_limits (
  scope text not null,
  subject_key text not null,
  window_started_at timestamptz not null default now(),
  hits integer not null default 0 check (hits >= 0),
  updated_at timestamptz not null default now(),
  primary key (scope, subject_key)
);

create table if not exists private.security_audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid,
  family_id uuid,
  event_type text not null,
  success boolean not null default true,
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists security_audit_family_created_idx
  on private.security_audit_logs(family_id, created_at desc);
create index if not exists security_audit_actor_created_idx
  on private.security_audit_logs(actor_user_id, created_at desc);
create index if not exists security_audit_event_created_idx
  on private.security_audit_logs(event_type, created_at desc);

revoke all on private.security_rate_limits from public, anon, authenticated;
revoke all on private.security_audit_logs from public, anon, authenticated;

create or replace function private.consume_security_rate_limit(
  p_scope text,
  p_subject_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_hits integer;
begin
  if coalesce(length(trim(p_scope)),0) = 0
     or coalesce(length(trim(p_subject_key)),0) = 0
     or p_limit < 1 or p_limit > 10000
     or p_window_seconds < 1 or p_window_seconds > 86400 then
    return false;
  end if;

  insert into private.security_rate_limits(scope, subject_key, window_started_at, hits, updated_at)
  values(trim(p_scope), left(trim(p_subject_key), 256), v_now, 1, v_now)
  on conflict (scope, subject_key) do update
  set
    hits = case
      when v_now - private.security_rate_limits.window_started_at >= make_interval(secs => p_window_seconds)
        then 1
      else private.security_rate_limits.hits + 1
    end,
    window_started_at = case
      when v_now - private.security_rate_limits.window_started_at >= make_interval(secs => p_window_seconds)
        then v_now
      else private.security_rate_limits.window_started_at
    end,
    updated_at = v_now
  returning hits into v_hits;

  return v_hits <= p_limit;
end;
$$;

create or replace function private.write_security_audit(
  p_actor_user_id uuid,
  p_family_id uuid,
  p_event_type text,
  p_success boolean default true,
  p_severity text default 'info',
  p_target_type text default null,
  p_target_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if coalesce(length(trim(p_event_type)),0) = 0 then
    return;
  end if;
  if p_severity not in ('info','warning','critical') then
    p_severity := 'warning';
  end if;
  if pg_column_size(v_metadata) > 8192 then
    v_metadata := jsonb_build_object('truncated', true);
  end if;

  insert into private.security_audit_logs(
    actor_user_id, family_id, event_type, success, severity,
    target_type, target_id, metadata
  )
  values(
    p_actor_user_id, p_family_id, left(trim(p_event_type),120), coalesce(p_success,false),
    p_severity, left(coalesce(p_target_type,''),80), left(coalesce(p_target_id,''),200),
    v_metadata
  );
end;
$$;

create or replace function public.system_security_rate_limit(
  p_scope text,
  p_subject_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select private.consume_security_rate_limit(p_scope, p_subject_key, p_limit, p_window_seconds)
$$;

create or replace function public.system_security_audit(
  p_actor_user_id uuid,
  p_family_id uuid,
  p_event_type text,
  p_success boolean default true,
  p_severity text default 'info',
  p_target_type text default null,
  p_target_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.write_security_audit(
    p_actor_user_id, p_family_id, p_event_type, p_success, p_severity,
    p_target_type, p_target_id, p_metadata
  )
$$;

revoke all on function private.consume_security_rate_limit(text,text,integer,integer) from public, anon, authenticated;
revoke all on function private.write_security_audit(uuid,uuid,text,boolean,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.system_security_rate_limit(text,text,integer,integer) from public, anon, authenticated;
revoke all on function public.system_security_audit(uuid,uuid,text,boolean,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.system_security_rate_limit(text,text,integer,integer) to service_role;
grant execute on function public.system_security_audit(uuid,uuid,text,boolean,text,text,text,jsonb) to service_role;

create or replace function private.security_maintenance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.security_rate_limits
  where updated_at < now() - interval '2 days';

  delete from private.security_audit_logs
  where created_at < now() - interval '180 days';
end;
$$;

revoke all on function private.security_maintenance() from public, anon, authenticated;
