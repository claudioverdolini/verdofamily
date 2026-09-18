create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.materialize_recurring_chores()
returns integer
language plpgsql
set search_path = public, private
as $$
declare
  doc record;
  template jsonb;
  chore jsonb;
  v_data jsonb;
  v_chores jsonb;
  v_date text := to_char(clock_timestamp() at time zone 'Europe/Rome', 'YYYY-MM-DD');
  v_weekday integer := extract(isodow from (clock_timestamp() at time zone 'Europe/Rome'))::integer;
  v_template_id bigint;
  v_next_id bigint;
  v_generated integer := 0;
  v_doc_generated integer;
  v_due boolean;
  v_exists boolean;
begin
  for doc in
    select family_id, data, revision
    from public.family_documents
    where jsonb_typeof(coalesce(data->'recurringChores', '[]'::jsonb)) = 'array'
      and jsonb_array_length(coalesce(data->'recurringChores', '[]'::jsonb)) > 0
    for update skip locked
  loop
    v_data := coalesce(doc.data, '{}'::jsonb);
    v_chores := case
      when jsonb_typeof(v_data->'chores') = 'array' then v_data->'chores'
      else '[]'::jsonb
    end;
    v_doc_generated := 0;

    select coalesce(max(
      case when (item->>'id') ~ '^[0-9]+$' then (item->>'id')::bigint else 0 end
    ), 0)
    into v_next_id
    from jsonb_array_elements(v_chores) item;

    for template in
      select value
      from jsonb_array_elements(coalesce(v_data->'recurringChores', '[]'::jsonb))
    loop
      v_template_id := case
        when coalesce(template->>'id','') ~ '^[0-9]+$' then (template->>'id')::bigint
        else 0
      end;
      if v_template_id <= 0 then
        continue;
      end if;

      v_due :=
        coalesce((template->>'active')::boolean, true)
        and (coalesce(template->>'startDate','') = '' or template->>'startDate' <= v_date)
        and (coalesce(template->>'endDate','') = '' or template->>'endDate' >= v_date)
        and exists (
          select 1
          from jsonb_array_elements_text(
            case
              when jsonb_typeof(template->'weekdays') = 'array' then template->'weekdays'
              else '[1,2,3,4,5,6,7]'::jsonb
            end
          ) d
          where d.value ~ '^[1-7]$' and d.value::integer = v_weekday
        );

      if not v_due then
        continue;
      end if;

      select exists (
        select 1
        from jsonb_array_elements(v_chores) existing
        where existing->>'deadline' = v_date
          and coalesce(existing->>'recurringChoreId','') ~ '^[0-9]+$'
          and (existing->>'recurringChoreId')::bigint = v_template_id
      ) into v_exists;

      if v_exists then
        continue;
      end if;

      v_next_id := v_next_id + 1;
      chore := jsonb_build_object(
        'id', v_next_id,
        'title', coalesce(nullif(template->>'title',''), 'Compito ricorrente'),
        'deadline', v_date,
        'userId', coalesce(nullif(template->>'userId','')::integer, 0),
        'amount', greatest(coalesce(nullif(template->>'amount','')::numeric, 0), 0),
        'done', false,
        'recurringChoreId', v_template_id
      );
      v_chores := v_chores || jsonb_build_array(chore);
      v_doc_generated := v_doc_generated + 1;
      v_generated := v_generated + 1;
    end loop;

    if v_doc_generated > 0 then
      v_data := jsonb_set(v_data, '{chores}', v_chores, true);
      v_data := jsonb_set(v_data, '{version}', '6'::jsonb, true);

      update public.family_documents
      set data = v_data,
          revision = revision + 1,
          updated_by = null,
          updated_at = now()
      where family_id = doc.family_id;
    end if;
  end loop;

  return v_generated;
end;
$$;

revoke all on function private.materialize_recurring_chores() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'verdofamily_recurring_chores_daily') then
    perform cron.unschedule('verdofamily_recurring_chores_daily');
  end if;
end
$$;

select cron.schedule(
  'verdofamily_recurring_chores_daily',
  '10 2 * * *',
  'select private.materialize_recurring_chores();'
);
