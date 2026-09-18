create table if not exists public.school_subjects (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  legacy_id bigint not null,
  name text not null,
  short_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, legacy_id)
);
create index if not exists school_subjects_family_idx on public.school_subjects(family_id);

create table if not exists public.school_timetable_entries (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  legacy_id bigint not null,
  person_id uuid not null references public.family_people(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  lesson_order integer not null check (lesson_order >= 1),
  subject_id uuid not null references public.school_subjects(id) on delete cascade,
  start_time time,
  end_time time,
  room text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, legacy_id)
);
create index if not exists school_timetable_family_idx on public.school_timetable_entries(family_id);
create index if not exists school_timetable_person_idx on public.school_timetable_entries(person_id);
create index if not exists school_timetable_weekday_idx on public.school_timetable_entries(weekday);

create table if not exists public.school_items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  legacy_id bigint not null,
  person_id uuid not null references public.family_people(id) on delete cascade,
  type text not null check (type in ('homework','test','oral','material','circular','permission','trip','payment')),
  title text not null,
  item_date date not null,
  subject_id uuid references public.school_subjects(id) on delete set null,
  notes text,
  amount numeric(14,2) check (amount is null or amount >= 0),
  done boolean not null default false,
  created_on date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, legacy_id)
);
create index if not exists school_items_family_idx on public.school_items(family_id);
create index if not exists school_items_person_idx on public.school_items(person_id);
create index if not exists school_items_date_idx on public.school_items(item_date);

create or replace function private.school_is_adult(p_family_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and coalesce(private.family_role(p_family_id, p_user_id), '') in ('admin','adult')
$$;

create or replace function private.school_person_for_user(p_family_id uuid, p_user_id uuid default auth.uid())
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

create or replace function private.school_can_read_person(p_family_id uuid, p_person_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.school_is_adult(p_family_id, p_user_id)
    or (
      p_user_id is not null
      and p_person_id = private.school_person_for_user(p_family_id, p_user_id)
    )
$$;

create or replace function private.school_is_member(p_family_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and private.family_role(p_family_id, p_user_id) is not null
$$;

revoke all on function private.school_is_adult(uuid,uuid) from public, anon, authenticated;
revoke all on function private.school_person_for_user(uuid,uuid) from public, anon, authenticated;
revoke all on function private.school_can_read_person(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function private.school_is_member(uuid,uuid) from public, anon, authenticated;
grant execute on function private.school_is_adult(uuid,uuid) to authenticated;
grant execute on function private.school_person_for_user(uuid,uuid) to authenticated;
grant execute on function private.school_can_read_person(uuid,uuid,uuid) to authenticated;
grant execute on function private.school_is_member(uuid,uuid) to authenticated;

alter table public.school_subjects enable row level security;
alter table public.school_timetable_entries enable row level security;
alter table public.school_items enable row level security;

create policy school_subjects_select
on public.school_subjects for select to authenticated
using ((select private.school_is_member(family_id, auth.uid())));

create policy school_timetable_select
on public.school_timetable_entries for select to authenticated
using ((select private.school_can_read_person(family_id, person_id, auth.uid())));

create policy school_items_select
on public.school_items for select to authenticated
using ((select private.school_can_read_person(family_id, person_id, auth.uid())));

revoke all privileges on public.school_subjects,
  public.school_timetable_entries,
  public.school_items
from anon, authenticated;

grant select on public.school_subjects,
  public.school_timetable_entries,
  public.school_items
to authenticated;

grant select, insert, update, delete on public.school_subjects,
  public.school_timetable_entries,
  public.school_items
to service_role;

insert into public.school_subjects(family_id, legacy_id, name, short_name)
select
  fd.family_id,
  (s.value->>'id')::bigint,
  coalesce(nullif(s.value->>'name',''), 'Materia'),
  nullif(s.value->>'shortName','')
from public.family_documents fd
cross join lateral jsonb_array_elements(coalesce(fd.data->'schoolSubjects','[]'::jsonb)) s(value)
where coalesce(s.value->>'id','') ~ '^[0-9]+$'
on conflict (family_id, legacy_id) do update
set name = excluded.name,
    short_name = excluded.short_name,
    updated_at = now();

insert into public.school_timetable_entries(
  family_id, legacy_id, person_id, weekday, lesson_order, subject_id,
  start_time, end_time, room, notes
)
select
  fd.family_id,
  (e.value->>'id')::bigint,
  fp.id,
  least(7, greatest(1, coalesce(nullif(e.value->>'weekday','')::integer,1))),
  greatest(1, coalesce(nullif(e.value->>'order','')::integer,1)),
  ss.id,
  nullif(e.value->>'startTime','')::time,
  nullif(e.value->>'endTime','')::time,
  nullif(e.value->>'room',''),
  nullif(e.value->>'notes','')
from public.family_documents fd
cross join lateral jsonb_array_elements(coalesce(fd.data->'schoolTimetable','[]'::jsonb)) e(value)
join public.family_people fp
  on fp.family_id=fd.family_id and fp.legacy_user_id=(e.value->>'userId')::bigint
join public.school_subjects ss
  on ss.family_id=fd.family_id and ss.legacy_id=(e.value->>'subjectId')::bigint
where coalesce(e.value->>'id','') ~ '^[0-9]+$'
  and coalesce(e.value->>'userId','') ~ '^[0-9]+$'
  and coalesce(e.value->>'subjectId','') ~ '^[0-9]+$'
on conflict (family_id, legacy_id) do update
set person_id=excluded.person_id,
    weekday=excluded.weekday,
    lesson_order=excluded.lesson_order,
    subject_id=excluded.subject_id,
    start_time=excluded.start_time,
    end_time=excluded.end_time,
    room=excluded.room,
    notes=excluded.notes,
    updated_at=now();

insert into public.school_items(
  family_id, legacy_id, person_id, type, title, item_date, subject_id,
  notes, amount, done, created_on
)
select
  fd.family_id,
  (i.value->>'id')::bigint,
  fp.id,
  case when i.value->>'type' in ('homework','test','oral','material','circular','permission','trip','payment')
    then i.value->>'type' else 'homework' end,
  coalesce(nullif(i.value->>'title',''), 'Impegno scolastico'),
  coalesce(nullif(i.value->>'date','')::date,current_date),
  ss.id,
  nullif(i.value->>'notes',''),
  case when nullif(i.value->>'amount','') is null then null
       else greatest((i.value->>'amount')::numeric,0) end,
  coalesce((i.value->>'done')::boolean,false),
  coalesce(nullif(i.value->>'createdAt','')::date,current_date)
from public.family_documents fd
cross join lateral jsonb_array_elements(coalesce(fd.data->'schoolItems','[]'::jsonb)) i(value)
join public.family_people fp
  on fp.family_id=fd.family_id and fp.legacy_user_id=(i.value->>'userId')::bigint
left join public.school_subjects ss
  on ss.family_id=fd.family_id
 and coalesce(i.value->>'subjectId','') ~ '^[0-9]+$'
 and ss.legacy_id=(i.value->>'subjectId')::bigint
where coalesce(i.value->>'id','') ~ '^[0-9]+$'
  and coalesce(i.value->>'userId','') ~ '^[0-9]+$'
on conflict (family_id, legacy_id) do update
set person_id=excluded.person_id,
    type=excluded.type,
    title=excluded.title,
    item_date=excluded.item_date,
    subject_id=excluded.subject_id,
    notes=excluded.notes,
    amount=excluded.amount,
    done=excluded.done,
    created_on=excluded.created_on,
    updated_at=now();
