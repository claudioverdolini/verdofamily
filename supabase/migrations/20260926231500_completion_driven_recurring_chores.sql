-- Recurring chores are templates/available actions, not pre-created daily rows.
-- A finance_chores row is created only when an assignee actually reports a completion.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'verdofamily_recurring_chores_daily') then
    perform cron.unschedule('verdofamily_recurring_chores_daily');
  end if;
end
$$;

create or replace function private.materialize_recurring_chores()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Kept as a compatibility no-op so old callers cannot recreate synthetic rows.
  return 0;
end;
$$;

revoke all on function private.materialize_recurring_chores() from public, anon, authenticated;

-- Remove only untouched rows that were generated automatically by the old model.
-- Pending and approved completions are real history and must be preserved.
delete from public.finance_chores
where recurring_chore_id is not null
  and status = 'open'
  and completed_at is null
  and completed_by_person_id is null
  and approved_at is null
  and approved_by_person_id is null
  and credited_transaction_id is null;

-- Also clean any legacy embedded document rows so an old snapshot cannot
-- reintroduce the synthetic "open" occurrences.
with cleaned as (
  select
    fd.family_id,
    coalesce((
      select jsonb_agg(item order by ord)
      from jsonb_array_elements(coalesce(fd.data->'chores','[]'::jsonb)) with ordinality as x(item, ord)
      where not (
        coalesce(item->>'recurringChoreId','') <> ''
        and coalesce((item->>'done')::boolean, false) = false
        and coalesce(item->>'completionStatus','open') = 'open'
        and coalesce(item->>'completedAt','') = ''
      )
    ), '[]'::jsonb) as chores
  from public.family_documents fd
)
update public.family_documents fd
set data = jsonb_set(fd.data, '{chores}', cleaned.chores, true),
    revision = fd.revision + 1,
    updated_at = now()
from cleaned
where cleaned.family_id = fd.family_id
  and coalesce(fd.data->'chores','[]'::jsonb) is distinct from cleaned.chores;
