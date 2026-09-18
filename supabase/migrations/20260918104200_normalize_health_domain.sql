create table if not exists public.family_people (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  legacy_user_id bigint not null,
  auth_user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  role text not null check (role in ('admin','adult','child')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, legacy_user_id)
);

create unique index if not exists family_people_family_auth_uidx
  on public.family_people(family_id, auth_user_id)
  where auth_user_id is not null;
create index if not exists family_people_family_idx on public.family_people(family_id);

create table if not exists public.health_medicines (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  legacy_id bigint not null,
  title text not null,
  legacy_date date,
  active_ingredient text,
  purpose text,
  notes text,
  default_package_size numeric,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, legacy_id)
);
create index if not exists health_medicines_family_idx on public.health_medicines(family_id);

create table if not exists public.health_medicine_packages (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  medicine_id uuid not null references public.health_medicines(id) on delete cascade,
  legacy_id bigint not null,
  expiry_date date,
  quantity numeric not null default 0 check (quantity >= 0),
  package_size numeric,
  lot text,
  added_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (medicine_id, legacy_id)
);
create index if not exists health_medicine_packages_family_idx on public.health_medicine_packages(family_id);
create index if not exists health_medicine_packages_medicine_idx on public.health_medicine_packages(medicine_id);

create table if not exists public.health_therapies (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  legacy_id bigint not null,
  person_id uuid not null references public.family_people(id) on delete cascade,
  title text not null,
  legacy_date date,
  start_date date not null,
  end_date date,
  prescriber text,
  purpose text,
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, legacy_id),
  check (end_date is null or end_date >= start_date)
);
create index if not exists health_therapies_family_idx on public.health_therapies(family_id);
create index if not exists health_therapies_person_idx on public.health_therapies(person_id);

create table if not exists public.health_therapy_medicines (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  therapy_id uuid not null references public.health_therapies(id) on delete cascade,
  medicine_id uuid not null references public.health_medicines(id) on delete restrict,
  legacy_id bigint not null,
  tablets_per_dose numeric not null default 1 check (tablets_per_dose > 0),
  doses_per_day numeric not null default 1 check (doses_per_day > 0),
  usage text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (therapy_id, legacy_id)
);
create index if not exists health_therapy_medicines_family_idx on public.health_therapy_medicines(family_id);
create index if not exists health_therapy_medicines_therapy_idx on public.health_therapy_medicines(therapy_id);
create index if not exists health_therapy_medicines_medicine_idx on public.health_therapy_medicines(medicine_id);

create table if not exists public.health_visits (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  legacy_id bigint not null,
  person_id uuid not null references public.family_people(id) on delete cascade,
  title text not null,
  visit_date date not null,
  visit_time time,
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  specialty text,
  doctor text,
  facility text,
  purpose text,
  outcome text,
  notes text,
  next_visit_date date,
  follow_up_every integer,
  follow_up_unit text check (follow_up_unit is null or follow_up_unit in ('days','weeks','months','years')),
  follow_up_visit_legacy_id bigint,
  follow_up_source_legacy_id bigint,
  auto_generated boolean not null default false,
  calendar_event_id bigint,
  booking_reminder_every integer,
  booking_reminder_unit text check (booking_reminder_unit is null or booking_reminder_unit in ('days','weeks','months')),
  booking_reminder_event_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, legacy_id)
);
create index if not exists health_visits_family_idx on public.health_visits(family_id);
create index if not exists health_visits_person_idx on public.health_visits(person_id);
create index if not exists health_visits_date_idx on public.health_visits(visit_date);

create table if not exists public.health_records (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  legacy_id bigint not null,
  person_id uuid not null references public.family_people(id) on delete cascade,
  title text not null,
  record_date date not null,
  record_kind text not null default 'document' check (record_kind in ('exam','report','vaccine','document','note')),
  provider text,
  result text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, legacy_id)
);
create index if not exists health_records_family_idx on public.health_records(family_id);
create index if not exists health_records_person_idx on public.health_records(person_id);
create index if not exists health_records_date_idx on public.health_records(record_date);

create table if not exists public.health_attachments (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  visit_id uuid references public.health_visits(id) on delete cascade,
  therapy_id uuid references public.health_therapies(id) on delete cascade,
  record_id uuid references public.health_records(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  file_size bigint,
  created_at timestamptz not null default now(),
  check (num_nonnulls(visit_id, therapy_id, record_id) = 1)
);
create index if not exists health_attachments_family_idx on public.health_attachments(family_id);
create index if not exists health_attachments_visit_idx on public.health_attachments(visit_id);
create index if not exists health_attachments_therapy_idx on public.health_attachments(therapy_id);
create index if not exists health_attachments_record_idx on public.health_attachments(record_id);

create or replace function private.health_is_adult(p_family_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select p_user_id is not null
    and coalesce(private.family_role(p_family_id, p_user_id), '') in ('admin','adult')
$$;

create or replace function private.health_person_for_user(p_family_id uuid, p_user_id uuid default auth.uid())
returns uuid
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select fp.id
  from public.family_people fp
  where fp.family_id = p_family_id
    and fp.auth_user_id = p_user_id
  limit 1
$$;

create or replace function private.health_can_read_person(p_family_id uuid, p_person_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select private.health_is_adult(p_family_id, p_user_id)
    or (
      p_user_id is not null
      and p_person_id = private.health_person_for_user(p_family_id, p_user_id)
    )
$$;

create or replace function private.health_can_read_medicine(p_family_id uuid, p_medicine_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select private.health_is_adult(p_family_id, p_user_id)
    or exists (
      select 1
      from public.health_therapy_medicines htm
      join public.health_therapies ht on ht.id = htm.therapy_id
      where htm.family_id = p_family_id
        and htm.medicine_id = p_medicine_id
        and ht.person_id = private.health_person_for_user(p_family_id, p_user_id)
    )
$$;

create or replace function private.health_can_read_attachment(
  p_family_id uuid,
  p_visit_id uuid,
  p_therapy_id uuid,
  p_record_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select private.health_is_adult(p_family_id, p_user_id)
    or exists (
      select 1
      from public.health_visits hv
      where hv.id = p_visit_id
        and hv.family_id = p_family_id
        and hv.person_id = private.health_person_for_user(p_family_id, p_user_id)
    )
    or exists (
      select 1
      from public.health_therapies ht
      where ht.id = p_therapy_id
        and ht.family_id = p_family_id
        and ht.person_id = private.health_person_for_user(p_family_id, p_user_id)
    )
    or exists (
      select 1
      from public.health_records hr
      where hr.id = p_record_id
        and hr.family_id = p_family_id
        and hr.person_id = private.health_person_for_user(p_family_id, p_user_id)
    )
$$;

revoke all on function private.health_is_adult(uuid,uuid) from public, anon;
revoke all on function private.health_person_for_user(uuid,uuid) from public, anon;
revoke all on function private.health_can_read_person(uuid,uuid,uuid) from public, anon;
revoke all on function private.health_can_read_medicine(uuid,uuid,uuid) from public, anon;
revoke all on function private.health_can_read_attachment(uuid,uuid,uuid,uuid,uuid) from public, anon;

grant execute on function private.health_is_adult(uuid,uuid) to authenticated;
grant execute on function private.health_person_for_user(uuid,uuid) to authenticated;
grant execute on function private.health_can_read_person(uuid,uuid,uuid) to authenticated;
grant execute on function private.health_can_read_medicine(uuid,uuid,uuid) to authenticated;
grant execute on function private.health_can_read_attachment(uuid,uuid,uuid,uuid,uuid) to authenticated;

alter table public.family_people enable row level security;
alter table public.health_medicines enable row level security;
alter table public.health_medicine_packages enable row level security;
alter table public.health_therapies enable row level security;
alter table public.health_therapy_medicines enable row level security;
alter table public.health_visits enable row level security;
alter table public.health_records enable row level security;
alter table public.health_attachments enable row level security;

create policy family_people_select_family
on public.family_people for select to authenticated
using ((select private.is_family_member(family_id, auth.uid())));

create policy health_medicines_select
on public.health_medicines for select to authenticated
using ((select private.health_can_read_medicine(family_id, id, auth.uid())));

create policy health_medicines_insert
on public.health_medicines for insert to authenticated
with check ((select private.health_is_adult(family_id, auth.uid())));
create policy health_medicines_update
on public.health_medicines for update to authenticated
using ((select private.health_is_adult(family_id, auth.uid())))
with check ((select private.health_is_adult(family_id, auth.uid())));
create policy health_medicines_delete
on public.health_medicines for delete to authenticated
using ((select private.health_is_adult(family_id, auth.uid())));

create policy health_packages_select
on public.health_medicine_packages for select to authenticated
using ((select private.health_can_read_medicine(family_id, medicine_id, auth.uid())));
create policy health_packages_insert
on public.health_medicine_packages for insert to authenticated
with check ((select private.health_is_adult(family_id, auth.uid())));
create policy health_packages_update
on public.health_medicine_packages for update to authenticated
using ((select private.health_is_adult(family_id, auth.uid())))
with check ((select private.health_is_adult(family_id, auth.uid())));
create policy health_packages_delete
on public.health_medicine_packages for delete to authenticated
using ((select private.health_is_adult(family_id, auth.uid())));

create policy health_therapies_select
on public.health_therapies for select to authenticated
using ((select private.health_can_read_person(family_id, person_id, auth.uid())));
create policy health_therapies_insert
on public.health_therapies for insert to authenticated
with check ((select private.health_is_adult(family_id, auth.uid())));
create policy health_therapies_update
on public.health_therapies for update to authenticated
using ((select private.health_is_adult(family_id, auth.uid())))
with check ((select private.health_is_adult(family_id, auth.uid())));
create policy health_therapies_delete
on public.health_therapies for delete to authenticated
using ((select private.health_is_adult(family_id, auth.uid())));

create policy health_therapy_medicines_select
on public.health_therapy_medicines for select to authenticated
using (
  (select private.health_is_adult(family_id, auth.uid()))
  or exists (
    select 1 from public.health_therapies ht
    where ht.id = therapy_id
      and ht.person_id = (select private.health_person_for_user(family_id, auth.uid()))
  )
);
create policy health_therapy_medicines_insert
on public.health_therapy_medicines for insert to authenticated
with check ((select private.health_is_adult(family_id, auth.uid())));
create policy health_therapy_medicines_update
on public.health_therapy_medicines for update to authenticated
using ((select private.health_is_adult(family_id, auth.uid())))
with check ((select private.health_is_adult(family_id, auth.uid())));
create policy health_therapy_medicines_delete
on public.health_therapy_medicines for delete to authenticated
using ((select private.health_is_adult(family_id, auth.uid())));

create policy health_visits_select
on public.health_visits for select to authenticated
using ((select private.health_can_read_person(family_id, person_id, auth.uid())));
create policy health_visits_insert
on public.health_visits for insert to authenticated
with check ((select private.health_is_adult(family_id, auth.uid())));
create policy health_visits_update
on public.health_visits for update to authenticated
using ((select private.health_is_adult(family_id, auth.uid())))
with check ((select private.health_is_adult(family_id, auth.uid())));
create policy health_visits_delete
on public.health_visits for delete to authenticated
using ((select private.health_is_adult(family_id, auth.uid())));

create policy health_records_select
on public.health_records for select to authenticated
using ((select private.health_can_read_person(family_id, person_id, auth.uid())));
create policy health_records_insert
on public.health_records for insert to authenticated
with check ((select private.health_is_adult(family_id, auth.uid())));
create policy health_records_update
on public.health_records for update to authenticated
using ((select private.health_is_adult(family_id, auth.uid())))
with check ((select private.health_is_adult(family_id, auth.uid())));
create policy health_records_delete
on public.health_records for delete to authenticated
using ((select private.health_is_adult(family_id, auth.uid())));

create policy health_attachments_select
on public.health_attachments for select to authenticated
using ((select private.health_can_read_attachment(family_id, visit_id, therapy_id, record_id, auth.uid())));
create policy health_attachments_insert
on public.health_attachments for insert to authenticated
with check ((select private.health_is_adult(family_id, auth.uid())));
create policy health_attachments_update
on public.health_attachments for update to authenticated
using ((select private.health_is_adult(family_id, auth.uid())))
with check ((select private.health_is_adult(family_id, auth.uid())));
create policy health_attachments_delete
on public.health_attachments for delete to authenticated
using ((select private.health_is_adult(family_id, auth.uid())));

revoke all privileges on public.family_people from anon, authenticated;
grant select on public.family_people to authenticated;

revoke all privileges on public.health_medicines,
  public.health_medicine_packages,
  public.health_therapies,
  public.health_therapy_medicines,
  public.health_visits,
  public.health_records,
  public.health_attachments
from anon, authenticated;

grant select, insert, update, delete on
  public.health_medicines,
  public.health_medicine_packages,
  public.health_therapies,
  public.health_therapy_medicines,
  public.health_visits,
  public.health_records,
  public.health_attachments
to authenticated;

insert into public.family_people(family_id, legacy_user_id, auth_user_id, display_name, role)
select
  fd.family_id,
  (u.value->>'id')::bigint,
  case
    when coalesce(u.value->>'cloudUserId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (u.value->>'cloudUserId')::uuid
    else null
  end,
  coalesce(nullif(u.value->>'name',''), 'Familiare'),
  case coalesce(u.value->>'role','adulto')
    when 'admin' then 'admin'
    when 'bimbo' then 'child'
    else 'adult'
  end
from public.family_documents fd
cross join lateral jsonb_array_elements(coalesce(fd.data->'users','[]'::jsonb)) u(value)
where coalesce(u.value->>'id','') ~ '^[0-9]+$'
on conflict (family_id, legacy_user_id) do update
set auth_user_id = excluded.auth_user_id,
    display_name = excluded.display_name,
    role = excluded.role,
    updated_at = now();

insert into public.health_medicines(
  family_id, legacy_id, title, legacy_date, active_ingredient, purpose, notes, default_package_size, archived
)
select
  fd.family_id,
  (d.value->>'id')::bigint,
  coalesce(nullif(d.value->>'title',''), 'Medicinale'),
  nullif(d.value->>'date','')::date,
  nullif(d.value->>'activeIngredient',''),
  nullif(d.value->>'purpose',''),
  nullif(d.value->>'notes',''),
  nullif(d.value->>'defaultPackageSize','')::numeric,
  coalesce((d.value->>'done')::boolean, false)
from public.family_documents fd
cross join lateral jsonb_array_elements(coalesce(fd.data->'deadlines','[]'::jsonb)) d(value)
where d.value->>'kind' = 'medicine'
  and coalesce(d.value->>'id','') ~ '^[0-9]+$'
on conflict (family_id, legacy_id) do update
set title = excluded.title,
    legacy_date = excluded.legacy_date,
    active_ingredient = excluded.active_ingredient,
    purpose = excluded.purpose,
    notes = excluded.notes,
    default_package_size = excluded.default_package_size,
    archived = excluded.archived,
    updated_at = now();

insert into public.health_medicine_packages(
  family_id, medicine_id, legacy_id, expiry_date, quantity, package_size, lot, added_at
)
select
  fd.family_id,
  hm.id,
  coalesce(nullif(pkg.value->>'id','')::bigint, pkg.ordinality::bigint),
  nullif(pkg.value->>'expiryDate','')::date,
  greatest(coalesce(nullif(pkg.value->>'quantity','')::numeric,0),0),
  nullif(pkg.value->>'packageSize','')::numeric,
  nullif(pkg.value->>'lot',''),
  nullif(pkg.value->>'addedAt','')::date
from public.family_documents fd
cross join lateral jsonb_array_elements(coalesce(fd.data->'deadlines','[]'::jsonb)) d(value)
join public.health_medicines hm
  on hm.family_id = fd.family_id and hm.legacy_id = (d.value->>'id')::bigint
cross join lateral jsonb_array_elements(coalesce(d.value->'packages','[]'::jsonb)) with ordinality pkg(value, ordinality)
where d.value->>'kind' = 'medicine'
on conflict (medicine_id, legacy_id) do update
set expiry_date = excluded.expiry_date,
    quantity = excluded.quantity,
    package_size = excluded.package_size,
    lot = excluded.lot,
    added_at = excluded.added_at,
    updated_at = now();

insert into public.health_therapies(
  family_id, legacy_id, person_id, title, legacy_date, start_date, end_date, prescriber, purpose, notes, archived
)
select
  fd.family_id,
  (d.value->>'id')::bigint,
  fp.id,
  coalesce(nullif(d.value->>'title',''), 'Terapia'),
  nullif(d.value->>'date','')::date,
  coalesce(nullif(d.value->>'therapyStartDate','')::date, nullif(d.value->>'date','')::date, current_date),
  nullif(d.value->>'therapyEndDate','')::date,
  nullif(d.value->>'prescriber',''),
  nullif(d.value->>'purpose',''),
  nullif(d.value->>'notes',''),
  coalesce((d.value->>'done')::boolean, false)
from public.family_documents fd
cross join lateral jsonb_array_elements(coalesce(fd.data->'deadlines','[]'::jsonb)) d(value)
join public.family_people fp
  on fp.family_id = fd.family_id and fp.legacy_user_id = (d.value->>'userId')::bigint
where d.value->>'kind' = 'therapy'
  and coalesce(d.value->>'id','') ~ '^[0-9]+$'
  and coalesce(d.value->>'userId','') ~ '^[0-9]+$'
on conflict (family_id, legacy_id) do update
set person_id = excluded.person_id,
    title = excluded.title,
    legacy_date = excluded.legacy_date,
    start_date = excluded.start_date,
    end_date = excluded.end_date,
    prescriber = excluded.prescriber,
    purpose = excluded.purpose,
    notes = excluded.notes,
    archived = excluded.archived,
    updated_at = now();

insert into public.health_therapy_medicines(
  family_id, therapy_id, medicine_id, legacy_id, tablets_per_dose, doses_per_day, usage
)
select
  fd.family_id,
  ht.id,
  hm.id,
  coalesce(nullif(line.value->>'id','')::bigint, line.ordinality::bigint),
  greatest(coalesce(nullif(line.value->>'tabletsPerDose','')::numeric,1),0.001),
  greatest(coalesce(nullif(line.value->>'dosesPerDay','')::numeric,1),0.001),
  nullif(line.value->>'usage','')
from public.family_documents fd
cross join lateral jsonb_array_elements(coalesce(fd.data->'deadlines','[]'::jsonb)) d(value)
join public.health_therapies ht
  on ht.family_id = fd.family_id and ht.legacy_id = (d.value->>'id')::bigint
cross join lateral jsonb_array_elements(coalesce(d.value->'therapyMedicines','[]'::jsonb)) with ordinality line(value, ordinality)
join public.health_medicines hm
  on hm.family_id = fd.family_id and hm.legacy_id = (line.value->>'medicineId')::bigint
where d.value->>'kind' = 'therapy'
on conflict (therapy_id, legacy_id) do update
set medicine_id = excluded.medicine_id,
    tablets_per_dose = excluded.tablets_per_dose,
    doses_per_day = excluded.doses_per_day,
    usage = excluded.usage,
    updated_at = now();

insert into public.health_visits(
  family_id, legacy_id, person_id, title, visit_date, visit_time, status,
  specialty, doctor, facility, purpose, outcome, notes, next_visit_date,
  follow_up_every, follow_up_unit, follow_up_visit_legacy_id, follow_up_source_legacy_id,
  auto_generated, calendar_event_id, booking_reminder_every, booking_reminder_unit,
  booking_reminder_event_id
)
select
  fd.family_id,
  (d.value->>'id')::bigint,
  fp.id,
  coalesce(nullif(d.value->>'title',''), 'Visita'),
  coalesce(nullif(d.value->>'date','')::date, current_date),
  nullif(d.value->>'time','')::time,
  case
    when d.value->>'healthStatus' in ('scheduled','completed','cancelled') then d.value->>'healthStatus'
    when coalesce((d.value->>'done')::boolean,false) then 'completed'
    else 'scheduled'
  end,
  nullif(d.value->>'specialty',''),
  nullif(d.value->>'doctor',''),
  nullif(d.value->>'facility',''),
  nullif(d.value->>'purpose',''),
  nullif(d.value->>'outcome',''),
  nullif(d.value->>'notes',''),
  nullif(d.value->>'nextVisitDate','')::date,
  nullif(d.value->>'followUpEvery','')::integer,
  nullif(d.value->>'followUpUnit',''),
  nullif(d.value->>'followUpVisitId','')::bigint,
  nullif(d.value->>'followUpSourceId','')::bigint,
  coalesce((d.value->>'autoGenerated')::boolean,false),
  nullif(d.value->>'calendarEventId','')::bigint,
  nullif(d.value->>'bookingReminderEvery','')::integer,
  nullif(d.value->>'bookingReminderUnit',''),
  nullif(d.value->>'bookingReminderEventId','')::bigint
from public.family_documents fd
cross join lateral jsonb_array_elements(coalesce(fd.data->'deadlines','[]'::jsonb)) d(value)
join public.family_people fp
  on fp.family_id = fd.family_id and fp.legacy_user_id = (d.value->>'userId')::bigint
where d.value->>'kind' = 'visit'
  and coalesce(d.value->>'id','') ~ '^[0-9]+$'
  and coalesce(d.value->>'userId','') ~ '^[0-9]+$'
on conflict (family_id, legacy_id) do update
set person_id = excluded.person_id,
    title = excluded.title,
    visit_date = excluded.visit_date,
    visit_time = excluded.visit_time,
    status = excluded.status,
    specialty = excluded.specialty,
    doctor = excluded.doctor,
    facility = excluded.facility,
    purpose = excluded.purpose,
    outcome = excluded.outcome,
    notes = excluded.notes,
    next_visit_date = excluded.next_visit_date,
    follow_up_every = excluded.follow_up_every,
    follow_up_unit = excluded.follow_up_unit,
    follow_up_visit_legacy_id = excluded.follow_up_visit_legacy_id,
    follow_up_source_legacy_id = excluded.follow_up_source_legacy_id,
    auto_generated = excluded.auto_generated,
    calendar_event_id = excluded.calendar_event_id,
    booking_reminder_every = excluded.booking_reminder_every,
    booking_reminder_unit = excluded.booking_reminder_unit,
    booking_reminder_event_id = excluded.booking_reminder_event_id,
    updated_at = now();

insert into public.health_records(
  family_id, legacy_id, person_id, title, record_date, record_kind, provider, result, notes
)
select
  fd.family_id,
  (d.value->>'id')::bigint,
  fp.id,
  coalesce(nullif(d.value->>'title',''), 'Documento sanitario'),
  coalesce(nullif(d.value->>'date','')::date, current_date),
  case when d.value->>'healthRecordKind' in ('exam','report','vaccine','document','note')
    then d.value->>'healthRecordKind' else 'document' end,
  nullif(d.value->>'provider',''),
  nullif(d.value->>'result',''),
  nullif(d.value->>'notes','')
from public.family_documents fd
cross join lateral jsonb_array_elements(coalesce(fd.data->'deadlines','[]'::jsonb)) d(value)
join public.family_people fp
  on fp.family_id = fd.family_id and fp.legacy_user_id = (d.value->>'userId')::bigint
where d.value->>'kind' = 'health-record'
  and coalesce(d.value->>'id','') ~ '^[0-9]+$'
  and coalesce(d.value->>'userId','') ~ '^[0-9]+$'
on conflict (family_id, legacy_id) do update
set person_id = excluded.person_id,
    title = excluded.title,
    record_date = excluded.record_date,
    record_kind = excluded.record_kind,
    provider = excluded.provider,
    result = excluded.result,
    notes = excluded.notes,
    updated_at = now();

insert into public.health_attachments(
  id, family_id, visit_id, storage_path, file_name, mime_type, file_size, created_at
)
select
  case when coalesce(a.value->>'id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (a.value->>'id')::uuid else gen_random_uuid() end,
  fd.family_id,
  hv.id,
  a.value->>'path',
  coalesce(nullif(a.value->>'name',''), 'allegato'),
  nullif(a.value->>'mimeType',''),
  nullif(a.value->>'size','')::bigint,
  case when coalesce(a.value->>'createdAt','') ~ '^\d{4}-\d{2}-\d{2}T'
    then (a.value->>'createdAt')::timestamptz else now() end
from public.family_documents fd
cross join lateral jsonb_array_elements(coalesce(fd.data->'deadlines','[]'::jsonb)) d(value)
join public.health_visits hv
  on hv.family_id = fd.family_id and hv.legacy_id = (d.value->>'id')::bigint
cross join lateral jsonb_array_elements(coalesce(d.value->'attachments','[]'::jsonb)) a(value)
where d.value->>'kind' = 'visit'
  and coalesce(a.value->>'path','') <> ''
on conflict (storage_path) do update
set file_name = excluded.file_name,
    mime_type = excluded.mime_type,
    file_size = excluded.file_size;

insert into public.health_attachments(
  id, family_id, therapy_id, storage_path, file_name, mime_type, file_size, created_at
)
select
  case when coalesce(a.value->>'id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (a.value->>'id')::uuid else gen_random_uuid() end,
  fd.family_id,
  ht.id,
  a.value->>'path',
  coalesce(nullif(a.value->>'name',''), 'allegato'),
  nullif(a.value->>'mimeType',''),
  nullif(a.value->>'size','')::bigint,
  case when coalesce(a.value->>'createdAt','') ~ '^\d{4}-\d{2}-\d{2}T'
    then (a.value->>'createdAt')::timestamptz else now() end
from public.family_documents fd
cross join lateral jsonb_array_elements(coalesce(fd.data->'deadlines','[]'::jsonb)) d(value)
join public.health_therapies ht
  on ht.family_id = fd.family_id and ht.legacy_id = (d.value->>'id')::bigint
cross join lateral jsonb_array_elements(coalesce(d.value->'attachments','[]'::jsonb)) a(value)
where d.value->>'kind' = 'therapy'
  and coalesce(a.value->>'path','') <> ''
on conflict (storage_path) do update
set file_name = excluded.file_name,
    mime_type = excluded.mime_type,
    file_size = excluded.file_size;

insert into public.health_attachments(
  id, family_id, record_id, storage_path, file_name, mime_type, file_size, created_at
)
select
  case when coalesce(a.value->>'id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (a.value->>'id')::uuid else gen_random_uuid() end,
  fd.family_id,
  hr.id,
  a.value->>'path',
  coalesce(nullif(a.value->>'name',''), 'allegato'),
  nullif(a.value->>'mimeType',''),
  nullif(a.value->>'size','')::bigint,
  case when coalesce(a.value->>'createdAt','') ~ '^\d{4}-\d{2}-\d{2}T'
    then (a.value->>'createdAt')::timestamptz else now() end
from public.family_documents fd
cross join lateral jsonb_array_elements(coalesce(fd.data->'deadlines','[]'::jsonb)) d(value)
join public.health_records hr
  on hr.family_id = fd.family_id and hr.legacy_id = (d.value->>'id')::bigint
cross join lateral jsonb_array_elements(coalesce(d.value->'attachments','[]'::jsonb)) a(value)
where d.value->>'kind' = 'health-record'
  and coalesce(a.value->>'path','') <> ''
on conflict (storage_path) do update
set file_name = excluded.file_name,
    mime_type = excluded.mime_type,
    file_size = excluded.file_size;
