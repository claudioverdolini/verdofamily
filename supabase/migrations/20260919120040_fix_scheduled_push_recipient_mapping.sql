CREATE OR REPLACE FUNCTION public.push_due_scheduled_reminders(p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(family_id uuid, notification_key text, category text, target_user_ids uuid[], title text, body text, url text, tag text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with docs as (
  select fd.family_id, fd.data
  from public.family_documents fd
),
calendar_items as (
  select
    d.family_id,
    ev,
    case
      when pg_catalog.jsonb_typeof(ev->'reminderMinutes') = 'array'
       and pg_catalog.jsonb_array_length(ev->'reminderMinutes') > 0
        then ev->'reminderMinutes'
      else '[60]'::jsonb
    end as reminder_values
  from docs d
  cross join lateral pg_catalog.jsonb_array_elements(
    case when pg_catalog.jsonb_typeof(d.data->'calendarEvents')='array'
      then d.data->'calendarEvents' else '[]'::jsonb end
  ) ev
  where coalesce(ev->>'date','') ~ '^\d{4}-\d{2}-\d{2}$'
    and coalesce(ev->>'time','') ~ '^\d{2}:\d{2}$'
),
calendar_due as (
  select
    c.family_id,
    c.ev,
    ((rv #>> '{}')::int) as reminder_minutes,
    (((c.ev->>'date')::date + (c.ev->>'time')::time) at time zone 'Europe/Rome') as event_at
  from calendar_items c
  cross join lateral pg_catalog.jsonb_array_elements(c.reminder_values) rv
  where pg_catalog.jsonb_typeof(rv)='number'
    and ((rv #>> '{}')::int) between 0 and 10080
),
calendar_ready as (
  select
    c.*,
    c.event_at - pg_catalog.make_interval(mins => c.reminder_minutes) as due_at,
    array(
      select distinct fp.auth_user_id
      from public.family_people fp
      where fp.family_id=c.family_id
        and fp.auth_user_id is not null
        and (
          coalesce(c.ev->>'audience','users')='family'
          or (
            (coalesce(c.ev->>'userId','') ~ '^\d+$' and fp.legacy_user_id=(c.ev->>'userId')::bigint)
            or exists (
              select 1
              from pg_catalog.jsonb_array_elements_text(
                case when pg_catalog.jsonb_typeof(c.ev->'userIds')='array'
                  then c.ev->'userIds' else '[]'::jsonb end
              ) x(uid)
              where x.uid ~ '^\d+$' and x.uid::bigint=fp.legacy_user_id
            )
          )
        )
    ) as recipients
  from calendar_due c
),
deadline_items as (
  select
    d.family_id,
    dl,
    case
      when pg_catalog.jsonb_typeof(dl->'reminderDays')='array'
       and pg_catalog.jsonb_array_length(dl->'reminderDays') > 0
        then dl->'reminderDays'
      else '[90,30,7]'::jsonb
    end as reminder_values
  from docs d
  cross join lateral pg_catalog.jsonb_array_elements(
    case when pg_catalog.jsonb_typeof(d.data->'deadlines')='array'
      then d.data->'deadlines' else '[]'::jsonb end
  ) dl
  where coalesce(dl->>'date','') ~ '^\d{4}-\d{2}-\d{2}$'
    and coalesce(dl->>'done','false') <> 'true'
    and coalesce(dl->>'kind','general')='general'
),
deadline_due as (
  select
    d.family_id,
    d.dl,
    ((rv #>> '{}')::int) as reminder_days,
    ((((d.dl->>'date')::date - ((rv #>> '{}')::int)) + time '09:00') at time zone 'Europe/Rome') as due_at,
    array(
      select distinct fp.auth_user_id
      from public.family_people fp
      where fp.family_id=d.family_id
        and fp.auth_user_id is not null
        and coalesce(d.dl->>'userId','') ~ '^\d+$'
        and fp.legacy_user_id=(d.dl->>'userId')::bigint
    ) as recipients
  from deadline_items d
  cross join lateral pg_catalog.jsonb_array_elements(d.reminder_values) rv
  where pg_catalog.jsonb_typeof(rv)='number'
    and ((rv #>> '{}')::int) between 0 and 3650
)
select
  c.family_id,
  'calendar:' || c.family_id::text || ':' || coalesce(c.ev->>'id','unknown') || ':' ||
    (c.ev->>'date') || ':' || (c.ev->>'time') || ':' || c.reminder_minutes::text as notification_key,
  'calendar'::text as category,
  c.recipients as target_user_ids,
  'Promemoria VerdoFamily'::text as title,
  case
    when c.reminder_minutes = 0 then 'Hai un impegno in programma adesso.'
    when c.reminder_minutes < 60 then 'Hai un impegno in programma tra ' || c.reminder_minutes || ' minuti.'
    when c.reminder_minutes % 1440 = 0 then
      'Hai un impegno in programma tra ' || (c.reminder_minutes / 1440) ||
      case when c.reminder_minutes = 1440 then ' giorno.' else ' giorni.' end
    when c.reminder_minutes % 60 = 0 then
      'Hai un impegno in programma tra ' || (c.reminder_minutes / 60) ||
      case when c.reminder_minutes = 60 then ' ora.' else ' ore.' end
    else 'Hai un impegno in programma a breve.'
  end as body,
  '/?page=calendar'::text as url,
  'verdofamily-calendar-reminder-' || coalesce(c.ev->>'id','event') as tag
from calendar_ready c
where c.due_at <= p_now
  and c.due_at > p_now - interval '10 minutes'
  and c.event_at >= p_now - interval '10 minutes'
  and cardinality(c.recipients) > 0

union all

select
  d.family_id,
  'deadline:' || d.family_id::text || ':' || coalesce(d.dl->>'id','unknown') || ':' ||
    (d.dl->>'date') || ':' || d.reminder_days::text as notification_key,
  'deadlines'::text as category,
  d.recipients as target_user_ids,
  'Promemoria VerdoFamily'::text as title,
  case
    when d.reminder_days = 0 then 'Hai una scadenza oggi.'
    when d.reminder_days = 1 then 'Hai una scadenza domani.'
    else 'Hai una scadenza tra ' || d.reminder_days || ' giorni.'
  end as body,
  '/?page=deadlines'::text as url,
  'verdofamily-deadline-reminder-' || coalesce(d.dl->>'id','deadline') as tag
from deadline_due d
where d.due_at <= p_now
  and d.due_at > p_now - interval '10 minutes'
  and cardinality(d.recipients) > 0;
$function$


revoke all on function public.push_due_scheduled_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.push_due_scheduled_reminders(timestamptz) to service_role;

select cron.schedule(
  'verdofamily_scheduled_push_minutely',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://dufenyedfayvejlxjfqj.supabase.co/functions/v1/push-notifications',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-push-secret',(select value from public.system_settings where key='push_cron_secret')
    ),
    body := '{"action":"process-scheduled"}'::jsonb,
    timeout_milliseconds := 50000
  );
  $cron$
);
