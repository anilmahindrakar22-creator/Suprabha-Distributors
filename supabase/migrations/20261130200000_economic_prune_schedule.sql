begin;

do $guard$
declare actual text;
begin
 select md5(replace(p.prosrc,chr(13),'')) into actual from pg_proc p
 where p.oid='private.stockflow_prune_economic_results(integer)'::regprocedure;
 if actual is distinct from '5515d9b062a1e963cf53447b2b662d72' then
  raise exception 'Unexpected stockflow_prune_economic_results body (md5 %)',actual;end if;
end$guard$;

-- 20:42 is off the */5 rebuild grid; ANALYZE runs at 20:30 and cron log trim at 20:10.
do $cron$
declare job_count integer; actual_schedule text; actual_command text;
begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('stockflow-economic-result-prune','42 20 * * *',$job$select private.stockflow_prune_economic_results(10)$job$);
  select count(*),min(j.schedule),min(j.command) into job_count,actual_schedule,actual_command
  from cron.job j where j.jobname='stockflow-economic-result-prune';
  if job_count<>1 or actual_schedule is distinct from '42 20 * * *'
   or actual_command is distinct from 'select private.stockflow_prune_economic_results(10)' then
   raise exception 'Unexpected stockflow-economic-result-prune schedule (count %, schedule %, command %)',job_count,actual_schedule,actual_command;
  end if;
 end if;
end$cron$;

commit;
