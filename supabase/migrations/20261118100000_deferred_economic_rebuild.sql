begin;

create table private.stockflow_economic_rebuild_settings (
 id boolean primary key default true check(id),
 mode text not null default 'inline' check(mode in ('inline','deferred')),
 updated_at timestamptz not null default clock_timestamp()
);
insert into private.stockflow_economic_rebuild_settings default values;
alter table private.stockflow_economic_rebuild_settings enable row level security;
revoke all on private.stockflow_economic_rebuild_settings from public,anon,authenticated,service_role;

alter table private.stockflow_economic_rebuild_status
 add column pending_since timestamptz,
 add column attempts integer not null default 0;

create function private.stockflow_request_economic_rebuild(p_company text) returns void
language plpgsql volatile set search_path=pg_catalog,private,public as $$
begin
 -- Imports already hold this lock. Direct requests must also serialize with publication
 -- so a request arriving during a rebuild cannot be cleared without its evidence being read.
 perform pg_advisory_xact_lock(hashtextextended('instrument-economics-v1',0));
 -- An inline command may have covered the old request before this new evidence arrived.
 -- Retaining that covered timestamp would let the worker discard the new request as covered too.
 update private.stockflow_economic_rebuild_status set pending_since=null
 where company_id=p_company and pending_since<(select r.created_at from private.stockflow_economic_runs r
  where r.active order by r.created_at desc limit 1);
 insert into private.stockflow_economic_rebuild_status(company_id,state,pending_since)
 values(p_company,'ok',clock_timestamp())
 on conflict(company_id) do update set
  pending_since=coalesce(stockflow_economic_rebuild_status.pending_since,clock_timestamp()),
  attempts=0,updated_at=clock_timestamp();
end$$;

create function private.stockflow_run_pending_economic_rebuild() returns integer
language plpgsql volatile set search_path=pg_catalog,private,public as $$
declare published_at timestamptz;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('instrument-economics-v1',0)) then return 0;end if;
 if not exists(select 1 from private.stockflow_economic_rebuild_status where pending_since is not null) then return 0;end if;

 -- A user command may already have published this evidence, including after rollback to inline.
 select r.created_at into published_at from private.stockflow_economic_runs r
 where r.active order by r.created_at desc limit 1;
 update private.stockflow_economic_rebuild_status set pending_since=null,attempts=0,updated_at=clock_timestamp()
 where pending_since<published_at;
 if not exists(select 1 from private.stockflow_economic_rebuild_status where pending_since is not null) then return 0;end if;
 if (select s.mode from private.stockflow_economic_rebuild_settings s) is distinct from 'deferred' then return 0;end if;
 if not exists(select 1 from private.stockflow_economic_rebuild_status where pending_since is not null and attempts<3) then return 0;end if;

 begin
  perform private.stockflow_rebuild_instrument_economics('tally-sync');
  update private.stockflow_economic_rebuild_status
  set state='ok',reason=null,since=null,pending_since=null,attempts=0,updated_at=clock_timestamp()
  where pending_since is not null;
  return 1;
 exception when sqlstate '54000' then
  update private.stockflow_economic_rebuild_status
  set state='paused',reason=sqlerrm,since=coalesce(since,clock_timestamp()),
   pending_since=null,attempts=0,updated_at=clock_timestamp()
  where pending_since is not null;
  return 0;
 when others or query_canceled then
  update private.stockflow_economic_rebuild_status
  set state='paused',reason=sqlerrm,since=coalesce(since,clock_timestamp()),
   attempts=attempts+1,updated_at=clock_timestamp()
  where pending_since is not null;
  return 0;
 end;
end$$;
revoke all on function private.stockflow_request_economic_rebuild(text),
 private.stockflow_run_pending_economic_rebuild() from public,anon,authenticated,service_role;

do $patch$
declare definition text; old_text text; new_text text;
begin
 definition:=replace(pg_get_functiondef('private.stockflow_import_economic_vouchers()'::regprocedure),chr(13),'');
 old_text:=$old$begin
  perform private.stockflow_rebuild_instrument_economics('tally-sync');
  insert into private.stockflow_economic_rebuild_status(company_id,state,reason,since,updated_at)
  values(doc->>'companyId','ok',null,null,clock_timestamp())
  on conflict(company_id) do update set state='ok',reason=null,since=null,updated_at=excluded.updated_at;
 exception when sqlstate '54000' then
  insert into private.stockflow_economic_rebuild_status(company_id,state,reason,since,updated_at)
  values(doc->>'companyId','paused',sqlerrm,clock_timestamp(),clock_timestamp())
  on conflict(company_id) do update set state='paused',reason=excluded.reason,
   since=case when stockflow_economic_rebuild_status.state='paused' then stockflow_economic_rebuild_status.since else excluded.since end,
   updated_at=excluded.updated_at;
 end;$old$;
 new_text:=$new$if (select s.mode from private.stockflow_economic_rebuild_settings s)='deferred' then
  perform private.stockflow_request_economic_rebuild(doc->>'companyId');
 else
  $new$||old_text||E'\n end if;';
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
  raise exception 'Unexpected economic import containment anchor: %',old_text;
 end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;
end $patch$;

do $patch$
declare definition text; old_text text; new_text text;
begin
 definition:=replace(pg_get_functiondef('private.stockflow_sales_coverage_read(text[])'::regprocedure),chr(13),'');
 old_text:=$old$'state',s.state,'since',s.since,'reason',s.reason$old$;
 new_text:=$new$'state',s.state,'since',s.since,'reason',s.reason,'pendingSince',s.pending_since$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
  raise exception 'Unexpected sales coverage rebuild anchor: %',old_text;
 end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;
end $patch$;

do $patch$
declare definition text; old_text text; new_text text;
begin
 definition:=replace(pg_get_functiondef('public.stockflow_order_summary_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
 old_text:=$old$'sourceUpdatedAt',(select s.updated_at from public.stockflow_snapshots s order by s.updated_at desc limit 1)$old$;
 new_text:=$new$'sourceUpdatedAt',(select s.updated_at from public.stockflow_snapshots s order by s.updated_at desc limit 1),
    'economicsStatus',(select jsonb_build_object('state',r.state,'pendingSince',r.pending_since) from private.stockflow_economic_rebuild_status r order by r.updated_at desc limit 1)$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
  raise exception 'Unexpected order summary economics status anchor: %',old_text;
 end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;
end $patch$;

-- Mode stays inline until the deployment step flips it so an absent job cannot strand a rebuild; 20 s keeps a waiting save inside the Edge function's 25 s abort.
do $cron$
begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('stockflow-economic-rebuild','*/5 * * * *',$job$set statement_timeout='20s'; select private.stockflow_run_pending_economic_rebuild()$job$);
  perform cron.schedule('stockflow-nightly-analyze','30 20 * * *',$job$analyze$job$);
 end if;
end $cron$;

commit;
