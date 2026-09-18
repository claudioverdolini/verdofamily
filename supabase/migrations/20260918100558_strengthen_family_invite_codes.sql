create or replace function public.make_invite_code()
returns text
language sql
set search_path = public, pg_temp
as $$
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
$$;

revoke execute on function public.make_invite_code() from public, anon, authenticated;
