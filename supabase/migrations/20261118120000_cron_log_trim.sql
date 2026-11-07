begin;

-- pg_cron never trims its run log. Seven days keeps recent job evidence; rows still running have no end_time and stay.
do $cron$
begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('stockflow-cron-log-trim','10 20 * * *',$job$delete from cron.job_run_details where end_time < now() - interval '7 days'$job$);
 end if;
end $cron$;

commit;
