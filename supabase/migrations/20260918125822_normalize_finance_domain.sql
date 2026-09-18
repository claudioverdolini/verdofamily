create table if not exists public.finance_wallets (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  person_id uuid not null references public.family_people(id) on delete cascade,
  balance numeric(14,2) not null default 0 check (balance >= 0),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, person_id)
);
create index if not exists finance_wallets_family_idx on public.finance_wallets(family_id);
create index if not exists finance_wallets_person_idx on public.finance_wallets(person_id);

create table if not exists public.finance_recurring_chores (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  legacy_id bigint not null,
  person_id uuid not null references public.family_people(id) on delete cascade,
  title text not null,
  amount numeric(14,2) not null default 0 check (amount >= 0),
  weekdays smallint[] not null default array[1,2,3,4,5,6,7]::smallint[],
  active boolean not null default true,
  start_date date not null,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, legacy_id),
  check (array_length(weekdays, 1) is not null),
  check (end_date is null or end_date >= start_date)
);
create index if not exists finance_recurring_chores_family_idx on public.finance_recurring_chores(family_id);
create index if not exists finance_recurring_chores_person_idx on public.finance_recurring_chores(person_id);

create table if not exists public.finance_transactions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  legacy_id bigint not null,
  person_id uuid not null references public.family_people(id) on delete cascade,
  type text not null check (type in ('credit','payment','reversal')),
  amount numeric(14,2) not null check (amount >= 0),
  transaction_date date not null,
  note text not null default '',
  reversed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, legacy_id)
);
create index if not exists finance_transactions_family_idx on public.finance_transactions(family_id);
create index if not exists finance_transactions_person_idx on public.finance_transactions(person_id);
create index if not exists finance_transactions_date_idx on public.finance_transactions(transaction_date desc);

create table if not exists public.finance_chores (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  legacy_id bigint not null,
  person_id uuid not null references public.family_people(id) on delete cascade,
  title text not null,
  deadline date not null,
  amount numeric(14,2) not null default 0 check (amount >= 0),
  status text not null default 'open' check (status in ('open','pending','approved')),
  completed_at timestamptz,
  completed_by_person_id uuid references public.family_people(id) on delete set null,
  approved_at timestamptz,
  approved_by_person_id uuid references public.family_people(id) on delete set null,
  credited_transaction_id uuid references public.finance_transactions(id) on delete set null,
  recurring_chore_id uuid references public.finance_recurring_chores(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, legacy_id)
);
create index if not exists finance_chores_family_idx on public.finance_chores(family_id);
create index if not exists finance_chores_person_idx on public.finance_chores(person_id);
create index if not exists finance_chores_deadline_idx on public.finance_chores(deadline);
create unique index if not exists finance_chores_recurring_day_uidx
  on public.finance_chores(family_id, recurring_chore_id, deadline)
  where recurring_chore_id is not null;

create or replace function private.finance_is_adult(p_family_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and coalesce(private.family_role(p_family_id, p_user_id), '') in ('admin','adult')
$$;

create or replace function private.finance_person_for_user(p_family_id uuid, p_user_id uuid default auth.uid())
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select fp.id
  from public.family_people fp
  where fp.family_id = p_family_id
    and fp.auth_user_id = p_user_id
  limit 1
$$;

create or replace function private.finance_can_read_person(p_family_id uuid, p_person_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.finance_is_adult(p_family_id, p_user_id)
    or (
      p_user_id is not null
      and p_person_id = private.finance_person_for_user(p_family_id, p_user_id)
    )
$$;

revoke all on function private.finance_is_adult(uuid,uuid) from public, anon, authenticated;
revoke all on function private.finance_person_for_user(uuid,uuid) from public, anon, authenticated;
revoke all on function private.finance_can_read_person(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function private.finance_is_adult(uuid,uuid) to authenticated;
grant execute on function private.finance_person_for_user(uuid,uuid) to authenticated;
grant execute on function private.finance_can_read_person(uuid,uuid,uuid) to authenticated;

alter table public.finance_wallets enable row level security;
alter table public.finance_recurring_chores enable row level security;
alter table public.finance_transactions enable row level security;
alter table public.finance_chores enable row level security;

create policy finance_wallets_select
on public.finance_wallets for select to authenticated
using ((select private.finance_can_read_person(family_id, person_id, auth.uid())));

create policy finance_recurring_chores_select
on public.finance_recurring_chores for select to authenticated
using ((select private.finance_can_read_person(family_id, person_id, auth.uid())));

create policy finance_transactions_select
on public.finance_transactions for select to authenticated
using ((select private.finance_can_read_person(family_id, person_id, auth.uid())));

create policy finance_chores_select
on public.finance_chores for select to authenticated
using ((select private.finance_can_read_person(family_id, person_id, auth.uid())));

revoke all privileges on public.finance_wallets,
  public.finance_recurring_chores,
  public.finance_transactions,
  public.finance_chores
from anon, authenticated;

grant select on public.finance_wallets,
  public.finance_recurring_chores,
  public.finance_transactions,
  public.finance_chores
to authenticated;

grant select, insert, update, delete on public.finance_wallets,
  public.finance_recurring_chores,
  public.finance_transactions,
  public.finance_chores
to service_role;

insert into public.finance_wallets(family_id, person_id, balance, currency)
select
  fd.family_id,
  fp.id,
  greatest(coalesce(nullif(u.value->>'balance','')::numeric, 0), 0),
  'EUR'
from public.family_documents fd
cross join lateral jsonb_array_elements(coalesce(fd.data->'users','[]'::jsonb)) u(value)
join public.family_people fp
  on fp.family_id = fd.family_id
 and fp.legacy_user_id = (u.value->>'id')::bigint
where coalesce(u.value->>'id','') ~ '^[0-9]+$'
on conflict (family_id, person_id) do update
set balance = excluded.balance,
    updated_at = now();

insert into public.finance_recurring_chores(
  family_id, legacy_id, person_id, title, amount, weekdays, active, start_date, end_date
)
select
  fd.family_id,
  (c.value->>'id')::bigint,
  fp.id,
  coalesce(nullif(c.value->>'title',''), 'Compito ricorrente'),
  greatest(coalesce(nullif(c.value->>'amount','')::numeric,0),0),
  coalesce((
    select array_agg(day::smallint order by day)
    from (
      select distinct d.value::integer as day
      from jsonb_array_elements_text(
        case when jsonb_typeof(c.value->'weekdays')='array'
          then c.value->'weekdays' else '[1,2,3,4,5,6,7]'::jsonb end
      ) d
      where d.value ~ '^[1-7]$'
    ) q
  ), array[1,2,3,4,5,6,7]::smallint[]),
  coalesce((c.value->>'active')::boolean,true),
  coalesce(nullif(c.value->>'startDate','')::date,current_date),
  nullif(c.value->>'endDate','')::date
from public.family_documents fd
cross join lateral jsonb_array_elements(coalesce(fd.data->'recurringChores','[]'::jsonb)) c(value)
join public.family_people fp
  on fp.family_id = fd.family_id and fp.legacy_user_id = (c.value->>'userId')::bigint
where coalesce(c.value->>'id','') ~ '^[0-9]+$'
  and coalesce(c.value->>'userId','') ~ '^[0-9]+$'
on conflict (family_id, legacy_id) do update
set person_id = excluded.person_id,
    title = excluded.title,
    amount = excluded.amount,
    weekdays = excluded.weekdays,
    active = excluded.active,
    start_date = excluded.start_date,
    end_date = excluded.end_date,
    updated_at = now();

insert into public.finance_transactions(
  family_id, legacy_id, person_id, type, amount, transaction_date, note, reversed
)
select
  fd.family_id,
  (t.value->>'id')::bigint,
  fp.id,
  case when t.value->>'type' in ('credit','payment','reversal') then t.value->>'type' else 'credit' end,
  greatest(coalesce(nullif(t.value->>'amount','')::numeric,0),0),
  coalesce(nullif(t.value->>'date','')::date,current_date),
  coalesce(t.value->>'note',''),
  coalesce((t.value->>'reversed')::boolean,false)
from public.family_documents fd
cross join lateral jsonb_array_elements(coalesce(fd.data->'transactions','[]'::jsonb)) t(value)
join public.family_people fp
  on fp.family_id = fd.family_id and fp.legacy_user_id = (t.value->>'userId')::bigint
where coalesce(t.value->>'id','') ~ '^[0-9]+$'
  and coalesce(t.value->>'userId','') ~ '^[0-9]+$'
on conflict (family_id, legacy_id) do update
set person_id = excluded.person_id,
    type = excluded.type,
    amount = excluded.amount,
    transaction_date = excluded.transaction_date,
    note = excluded.note,
    reversed = excluded.reversed,
    updated_at = now();

insert into public.finance_chores(
  family_id, legacy_id, person_id, title, deadline, amount, status,
  completed_at, completed_by_person_id, approved_at, approved_by_person_id,
  credited_transaction_id, recurring_chore_id
)
select
  fd.family_id,
  (c.value->>'id')::bigint,
  fp.id,
  coalesce(nullif(c.value->>'title',''), 'Compito'),
  coalesce(nullif(c.value->>'deadline','')::date,current_date),
  greatest(coalesce(nullif(c.value->>'amount','')::numeric,0),0),
  case
    when coalesce((c.value->>'done')::boolean,false) then 'approved'
    when c.value->>'completionStatus'='pending' then 'pending'
    else 'open'
  end,
  nullif(c.value->>'completedAt','')::timestamptz,
  (select p.id from public.family_people p
   where p.family_id=fd.family_id and p.legacy_user_id=nullif(c.value->>'completedByUserId','')::bigint),
  nullif(c.value->>'approvedAt','')::timestamptz,
  (select p.id from public.family_people p
   where p.family_id=fd.family_id and p.legacy_user_id=nullif(c.value->>'approvedByUserId','')::bigint),
  (select tx.id from public.finance_transactions tx
   where tx.family_id=fd.family_id and tx.legacy_id=nullif(c.value->>'creditedTransactionId','')::bigint),
  (select rc.id from public.finance_recurring_chores rc
   where rc.family_id=fd.family_id and rc.legacy_id=nullif(c.value->>'recurringChoreId','')::bigint)
from public.family_documents fd
cross join lateral jsonb_array_elements(coalesce(fd.data->'chores','[]'::jsonb)) c(value)
join public.family_people fp
  on fp.family_id = fd.family_id and fp.legacy_user_id = (c.value->>'userId')::bigint
where coalesce(c.value->>'id','') ~ '^[0-9]+$'
  and coalesce(c.value->>'userId','') ~ '^[0-9]+$'
on conflict (family_id, legacy_id) do update
set person_id = excluded.person_id,
    title = excluded.title,
    deadline = excluded.deadline,
    amount = excluded.amount,
    status = excluded.status,
    completed_at = excluded.completed_at,
    completed_by_person_id = excluded.completed_by_person_id,
    approved_at = excluded.approved_at,
    approved_by_person_id = excluded.approved_by_person_id,
    credited_transaction_id = excluded.credited_transaction_id,
    recurring_chore_id = excluded.recurring_chore_id,
    updated_at = now();

create or replace function private.materialize_recurring_chores()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record;
  v_date date := (clock_timestamp() at time zone 'Europe/Rome')::date;
  v_weekday integer := extract(isodow from (clock_timestamp() at time zone 'Europe/Rome'))::integer;
  v_next_id bigint;
  v_generated integer := 0;
begin
  for rec in
    select rc.*
    from public.finance_recurring_chores rc
    where rc.active
      and rc.start_date <= v_date
      and (rc.end_date is null or rc.end_date >= v_date)
      and v_weekday = any(rc.weekdays)
    order by rc.family_id, rc.legacy_id
  loop
    if exists (
      select 1
      from public.finance_chores fc
      where fc.family_id = rec.family_id
        and fc.recurring_chore_id = rec.id
        and fc.deadline = v_date
    ) then
      continue;
    end if;

    select coalesce(max(fc.legacy_id),0) + 1
    into v_next_id
    from public.finance_chores fc
    where fc.family_id = rec.family_id;

    insert into public.finance_chores(
      family_id, legacy_id, person_id, title, deadline, amount, status, recurring_chore_id
    )
    values (
      rec.family_id, v_next_id, rec.person_id, rec.title, v_date, rec.amount, 'open', rec.id
    )
    on conflict do nothing;

    if found then v_generated := v_generated + 1; end if;
  end loop;

  return v_generated;
end;
$$;

revoke all on function private.materialize_recurring_chores() from public, anon, authenticated;
