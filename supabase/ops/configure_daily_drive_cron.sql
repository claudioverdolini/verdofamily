-- VerdoFamily Google Drive backup cron recovery script.
-- Replace <SUPABASE_PROJECT_REF> if restoring into another Supabase project.
-- Before enabling the job, insert a fresh secret in public.system_settings:
--   insert into public.system_settings(key, value)
--   values ('drive_backup_cron_secret', '<NEW_SECRET>')
--   on conflict (key) do update set value = excluded.value, updated_at = now();
-- Never commit the real secret.

create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname = 'verdofamily_google_drive_backup_daily';

select cron.schedule(
  'verdofamily_google_drive_backup_daily',
  '30 2 * * *',
  $job$
  select net.http_post(
    url := 'https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/google-drive-backup-runner',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret',(select value from public.system_settings where key='drive_backup_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
