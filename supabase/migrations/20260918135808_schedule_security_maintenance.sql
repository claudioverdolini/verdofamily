do $$
begin
  if not exists (
    select 1 from cron.job where jobname='verdofamily_security_maintenance_daily'
  ) then
    perform cron.schedule(
      'verdofamily_security_maintenance_daily',
      '20 3 * * *',
      'select private.security_maintenance();'
    );
  end if;
end;
$$;