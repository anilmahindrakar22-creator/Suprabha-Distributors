begin;

create table private.stockflow_economic_rebuild_status (
 company_id text primary key,
 state text not null check(state in ('ok','paused')),
 reason text,
 since timestamptz,
 updated_at timestamptz not null default clock_timestamp()
);
alter table private.stockflow_economic_rebuild_status enable row level security;
revoke all on private.stockflow_economic_rebuild_status from public,anon,authenticated;

-- Only the publication call is contained. Its subtransaction rolls back every
-- rebuild write on 54000, while the source admission and snapshot can commit.
do $patch$
declare definition text; anchor text := $a$perform private.stockflow_rebuild_instrument_economics('tally-sync');$a$;
begin
 definition:=pg_get_functiondef('private.stockflow_import_economic_vouchers()'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
  raise exception 'Expected exactly one economic rebuild import call';
 end if;
 definition:=replace(definition,anchor,$replacement$begin
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
 end;$replacement$);
 execute definition;
end$patch$;
revoke all on function private.stockflow_import_economic_vouchers() from public,anon,authenticated;
commit;
