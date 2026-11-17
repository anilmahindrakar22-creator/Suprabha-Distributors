begin;

do $test$
declare actual text;
begin
 select md5(replace(p.prosrc,chr(13),'')) into actual from pg_proc p
 where p.oid='private.stockflow_prune_economic_results(integer)'::regprocedure;
 if actual is distinct from '5515d9b062a1e963cf53447b2b662d72' then
  raise exception 'Unexpected stockflow_prune_economic_results body (md5 %)',actual;end if;
 if exists(select 1 from pg_extension where extname='pg_cron') then
  if (select count(*) from cron.job where jobname='stockflow-economic-result-prune')<>1
   or not exists(select 1 from cron.job where jobname='stockflow-economic-result-prune'
    and schedule='42 20 * * *' and command='select private.stockflow_prune_economic_results(10)') then
   raise exception 'Unexpected stockflow-economic-result-prune job';end if;
  raise notice 'PASS economic prune schedule';
 else
  raise notice 'PASS economic prune schedule (pg_cron absent; schedule not asserted)';
 end if;
end$test$;

rollback;
