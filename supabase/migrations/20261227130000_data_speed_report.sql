begin;

create table private.stockflow_speed_snapshots (
 taken_at timestamptz not null, stats_reset timestamptz, gateway text not null,
 calls bigint not null, total_ms numeric not null, max_ms numeric not null,
 primary key(taken_at,gateway)
);
alter table private.stockflow_speed_snapshots enable row level security;
revoke all on private.stockflow_speed_snapshots from public,anon,authenticated;

-- Envelopes contain stats_reset and cumulative rows (gateway, calls, total_ms,
-- max_ms). p_base may also contain a previous envelope. No clock/table access.
create function private.stockflow_speed_window(p_now jsonb,p_base jsonb) returns jsonb
language sql immutable set search_path=pg_catalog,private,extensions as $$
 with current_rows as (
  select * from jsonb_to_recordset(p_now->'rows') as n(gateway text,calls bigint,total_ms numeric,max_ms numeric)
 ), base_rows as (
  select * from jsonb_to_recordset(coalesce(p_base->'rows','[]'::jsonb)) as b(gateway text,calls bigint,total_ms numeric,max_ms numeric)
  where p_now->'stats_reset' is not distinct from p_base->'stats_reset'
 ), previous_rows as (
  select * from jsonb_to_recordset(coalesce(p_base->'previous'->'rows','[]'::jsonb)) as a(gateway text,calls bigint,total_ms numeric,max_ms numeric)
  where p_base->'stats_reset' is not distinct from p_base->'previous'->'stats_reset'
 ), deltas as (
  select n.gateway,n.calls-coalesce(b.calls,0) calls,
   round((n.total_ms-coalesce(b.total_ms,0))/nullif(n.calls-coalesce(b.calls,0),0)) mean_ms,
   case when b.calls>a.calls then round((b.total_ms-a.total_ms)/(b.calls-a.calls)) end previous_mean_ms,
   round(n.max_ms) max_ms
  from current_rows n left join base_rows b using(gateway) left join previous_rows a using(gateway)
 ), page as (
  select * from deltas where calls>=1 order by mean_ms desc,gateway limit 30
 )
 select coalesce(jsonb_agg(jsonb_build_object('gateway',gateway,'calls',calls,'meanMs',mean_ms,
  'previousMeanMs',previous_mean_ms,'maxMs',max_ms) order by mean_ms desc,gateway),'[]'::jsonb) from page
$$;
revoke all on function private.stockflow_speed_window(jsonb,jsonb) from public,anon,authenticated,service_role;

create function private.stockflow_take_speed_snapshot() returns integer
language plpgsql security definer set search_path=pg_catalog,private,extensions as $$
declare taken timestamptz:=now(); reset_at timestamptz; inserted integer:=0;
begin
 delete from private.stockflow_speed_snapshots where taken_at<taken-interval '190 days';
 begin
  execute 'select stats_reset from extensions.pg_stat_statements_info' into reset_at;
  execute $stats$
   insert into private.stockflow_speed_snapshots(taken_at,stats_reset,gateway,calls,total_ms,max_ms)
   select $1,$2,substring(query from 'stockflow_[a-z_]*gateway'),sum(calls)::bigint,
    sum(total_exec_time)::numeric,max(max_exec_time)::numeric
   from extensions.pg_stat_statements where query ~ 'stockflow_[a-z_]*gateway' and query ~* '^\s*with pgrst_source'
   group by substring(query from 'stockflow_[a-z_]*gateway')
   on conflict(taken_at,gateway) do nothing
  $stats$ using taken,reset_at;
  get diagnostics inserted=row_count;
 exception when others then
  return 0;
 end;
 return inserted;
end $$;
revoke all on function private.stockflow_take_speed_snapshot() from public,anon,authenticated,service_role;

create function private.stockflow_data_speed_report_read(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,private,extensions as $$
declare available boolean:=true; reset_at timestamptz; base_at timestamptz; previous_at timestamptz;
 current_rows jsonb; base_rows jsonb; previous_rows jsonb; reads jsonb:='[]'; problems jsonb;
begin
 if p is distinct from '{}'::jsonb then
  raise exception 'Invalid speed report payload' using errcode='22023';
 end if;
 begin
  execute 'select stats_reset from extensions.pg_stat_statements_info' into reset_at;
  execute $stats$
   select coalesce(jsonb_agg(jsonb_build_object('gateway',gateway,'calls',calls,'total_ms',total_ms,'max_ms',max_ms)),'[]'::jsonb)
   from (select substring(query from 'stockflow_[a-z_]*gateway') gateway,sum(calls)::bigint calls,
    sum(total_exec_time)::numeric total_ms,max(max_exec_time)::numeric max_ms
    from extensions.pg_stat_statements where query ~ 'stockflow_[a-z_]*gateway' and query ~* '^\s*with pgrst_source'
    group by substring(query from 'stockflow_[a-z_]*gateway')) s
  $stats$ into current_rows;
 exception when others then
  available:=false; reset_at:=null; current_rows:='[]';
 end;
 if available then
  select max(taken_at) into base_at from private.stockflow_speed_snapshots
   where taken_at<=now()-interval '6 days' and stats_reset is not distinct from reset_at;
  select max(taken_at) into previous_at from private.stockflow_speed_snapshots
   where taken_at<=base_at-interval '6 days' and stats_reset is not distinct from reset_at;
  select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) into base_rows
   from private.stockflow_speed_snapshots s where taken_at=base_at and stats_reset is not distinct from reset_at;
  select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) into previous_rows
   from private.stockflow_speed_snapshots s where taken_at=previous_at and stats_reset is not distinct from reset_at;
  reads:=private.stockflow_speed_window(jsonb_build_object('stats_reset',reset_at,'rows',current_rows),
   jsonb_build_object('stats_reset',reset_at,'rows',base_rows,
    'previous',jsonb_build_object('stats_reset',reset_at,'rows',previous_rows)));
 end if;
 select coalesce(jsonb_agg(to_jsonb(e) order by total desc,reason),'[]'::jsonb) into problems from (
  select e.reason,count(*) total,
   count(*) filter(where now()-e.recorded_at<interval '7 days') as "under7Days",
   count(*) filter(where now()-e.recorded_at between interval '7 days' and interval '30 days') as "from7To30Days",
   count(*) filter(where now()-e.recorded_at>interval '30 days') as "over30Days"
  from private.stockflow_economic_import_exceptions e where private.stockflow_economic_import_exception_open(e.id)
  group by e.reason order by total desc,e.reason limit 50
 ) e;
 return jsonb_build_object('statsAvailable',available,'statsResetAt',reset_at,'windowFrom',base_at,'reads',reads,
  'budget',jsonb_build_object('meanMs',1000,'maxMs',3000),
  'lastImportAt',(select max(imported_at) from private.stockflow_economic_source_vouchers),
  'lastRebuildAt',(select created_at from private.stockflow_economic_runs where active),
  'exceptions',problems,'snapshotCount',(select count(distinct taken_at) from private.stockflow_speed_snapshots));
end $$;
revoke all on function private.stockflow_data_speed_report_read(jsonb) from public,anon,authenticated,service_role;

alter function public.stockflow_economics_gateway(text,text,text,jsonb)
 rename to stockflow_economics_gateway_before_speed_report;
create function public.stockflow_economics_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private,extensions set statement_timeout='20s' as $$
declare v_hash text; v_roles text[];
begin
 if p_action='get_data_speed_report' then
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
   raise exception 'Unauthorized gateway' using errcode='42501';
  end if;
  v_roles:=private.stockflow_active_member_roles(lower(btrim(coalesce(p_actor_email,''))));
  if not coalesce(v_roles&&array['administrator','management'],false) then
   raise exception 'Data checks are restricted' using errcode='42501';
  end if;
  return private.stockflow_data_speed_report_read(p_payload);
 end if;
 return public.stockflow_economics_gateway_before_speed_report(p_gateway_key,p_actor_email,p_action,p_payload);
end $$;
revoke all on function public.stockflow_economics_gateway_before_speed_report(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.stockflow_economics_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_economics_gateway(text,text,text,jsonb) to service_role;

-- Sunday 20:55 UTC = Monday 02:25 IST, off the */5 rebuild grid.
do $cron$
declare job_count integer; actual_schedule text; actual_command text;
begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('stockflow-speed-snapshot','55 20 * * 0',$job$select private.stockflow_take_speed_snapshot()$job$);
  select count(*),min(j.schedule),min(j.command) into job_count,actual_schedule,actual_command
  from cron.job j where j.jobname='stockflow-speed-snapshot';
  if job_count<>1 or actual_schedule is distinct from '55 20 * * 0'
   or actual_command is distinct from 'select private.stockflow_take_speed_snapshot()' then
   raise exception 'Unexpected stockflow-speed-snapshot schedule (count %, schedule %, command %)',job_count,actual_schedule,actual_command;
  end if;
 end if;
end$cron$;
notify pgrst, 'reload schema';
commit;
