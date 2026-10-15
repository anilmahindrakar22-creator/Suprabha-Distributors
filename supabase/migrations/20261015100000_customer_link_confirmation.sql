begin;

-- Evidence versions advance even when their immutable ledger content is reused.
-- An explicit empty/rejected version must never fall back to an older list.
create table private.stockflow_economic_ledger_generations (
 company_id text not null,source_version text not null,observed_at timestamptz not null,
 imported_at timestamptz not null default clock_timestamp(),valid boolean not null,
 catalog_version text,content_hash text,row_count integer,
 primary key(company_id,source_version),
 foreign key(company_id,catalog_version) references private.stockflow_economic_ledger_generations(company_id,source_version),
 check((valid and catalog_version is not null and content_hash is not null and row_count is not null and row_count between 0 and 10000)
  or (not valid and catalog_version is null and content_hash is null and row_count is null))
);
alter table private.stockflow_economic_ledger_generations enable row level security;
revoke all on private.stockflow_economic_ledger_generations from public,anon,authenticated,service_role;
create trigger immutable before update or delete on private.stockflow_economic_ledger_generations
 for each row execute function private.prevent_order_event_mutation();

create table private.stockflow_economic_ledger_masters (
 company_id text not null, source_version text not null,
 guid text not null check(length(btrim(guid)) between 1 and 240),
 name text not null check(length(btrim(name)) between 1 and 240),
 imported_at timestamptz not null default clock_timestamp(),
 primary key(company_id,source_version,guid),unique(company_id,source_version,name),
 foreign key(company_id,source_version) references private.stockflow_economic_ledger_generations(company_id,source_version)
);
alter table private.stockflow_economic_ledger_masters enable row level security;
revoke all on private.stockflow_economic_ledger_masters from public,anon,authenticated,service_role;
create trigger immutable before update or delete on private.stockflow_economic_ledger_masters
 for each row execute function private.prevent_order_event_mutation();

create function private.stockflow_import_customer_ledgers() returns trigger
language plpgsql security definer set search_path=pg_catalog,private,extensions as $$
declare v_doc jsonb:=new.payload->'economicEvidence';v_rows jsonb;v_content jsonb;v_company text;v_version text;
 v_seen timestamptz;v_hash text;v_catalog text;v_existing private.stockflow_economic_ledger_generations%rowtype;
begin
 if new.id<>'suprabha' or not coalesce(v_doc ? 'customerLedgers',false) then return new;end if;
 v_rows:=v_doc->'customerLedgers';v_company:=v_doc->>'companyId';v_version:=v_doc->>'sourceVersion';
 -- Serialize master generations with confirmation and the existing evidence importer.
 perform pg_advisory_xact_lock(hashtextextended('instrument-economics-v1',0));
 begin
  if jsonb_typeof(v_doc) is distinct from 'object' or v_doc->>'schemaVersion' is distinct from '1'
   or jsonb_typeof(v_doc->'companyId') is distinct from 'string' or length(v_company) not between 1 and 240 or v_company<>btrim(v_company)
   or jsonb_typeof(v_doc->'sourceVersion') is distinct from 'string' or length(v_version) not between 1 and 240
   or v_version !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
  then raise exception 'Invalid customer ledger source identity';end if;
  v_seen:=v_version::timestamptz;
  if jsonb_typeof(v_rows) is distinct from 'array' then raise exception 'Invalid customer ledger master array';end if;
  if jsonb_array_length(v_rows)>10000 then raise exception 'Customer ledger list exceeds supported limit';end if;
  if exists(select 1 from jsonb_array_elements(v_rows) e
    where jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(e->'guid') is distinct from 'string' or jsonb_typeof(e->'name') is distinct from 'string'
     or length(btrim(e->>'guid')) not between 1 and 240 or length(btrim(e->>'name')) not between 1 and 240)
   or exists(select 1 from jsonb_array_elements(v_rows) e group by btrim(e->>'name') having count(*)>1)
   or exists(select 1 from jsonb_array_elements(v_rows) e group by btrim(e->>'guid') having count(*)>1)
  then raise exception 'Invalid or ambiguous customer ledger master array';end if;
  select coalesce(jsonb_agg(jsonb_build_object('guid',btrim(e->>'guid'),'name',btrim(e->>'name')) order by btrim(e->>'guid')),'[]'::jsonb)
   into v_content from jsonb_array_elements(v_rows) e;
  v_hash:=encode(extensions.digest(v_content::text,'sha256'),'hex');
  select * into v_existing from private.stockflow_economic_ledger_generations where company_id=v_company and source_version=v_version;
  if found then
   if not v_existing.valid or v_existing.content_hash<>v_hash then raise exception 'Customer ledger version reused with different content';end if;
   return new;
  end if;
  if exists(select 1 from private.stockflow_economic_ledger_generations where company_id=v_company and
    (observed_at>v_seen or (observed_at=v_seen and content_hash is distinct from v_hash))) then
   raise exception 'Stale or conflicting customer ledger observation';end if;
  select catalog_version into v_catalog from private.stockflow_economic_ledger_generations
   where company_id=v_company and valid and content_hash=v_hash order by observed_at desc limit 1;
  v_catalog:=coalesce(v_catalog,v_version);
  insert into private.stockflow_economic_ledger_generations(company_id,source_version,observed_at,valid,catalog_version,content_hash,row_count)
   values(v_company,v_version,v_seen,true,v_catalog,v_hash,jsonb_array_length(v_content));
  if v_catalog=v_version then
   insert into private.stockflow_economic_ledger_masters(company_id,source_version,guid,name)
    select v_company,v_version,e->>'guid',e->>'name' from jsonb_array_elements(v_content) e;
  end if;
 exception when raise_exception or data_exception or integrity_constraint_violation then
  insert into private.stockflow_economic_import_exceptions(company_id,reason,evidence,recorded_at)
   values(v_company,sqlerrm,jsonb_build_object('kind','customer_ledger_master','sourceVersion',v_version,'blocking',v_seen is null),clock_timestamp());
  if v_seen is not null and length(v_company) between 1 and 240 and length(v_version) between 1 and 240 then
   insert into private.stockflow_economic_ledger_generations(company_id,source_version,observed_at,valid)
    values(v_company,v_version,v_seen,false) on conflict do nothing;
  end if;
 end;
 return new;
end$$;
revoke all on function private.stockflow_import_customer_ledgers() from public,anon,authenticated,service_role;
-- Alphabetical BEFORE trigger order is essential: this fires before
-- stockflow_import_economic_vouchers, which strips economicEvidence.
create trigger stockflow_import_customer_ledgers before insert or update of payload on public.stockflow_snapshots
 for each row execute function private.stockflow_import_customer_ledgers();

create function private.stockflow_current_ledger_generation(p_company text) returns text
language sql stable set search_path=pg_catalog,private as $$
 -- Inspect the latest accepted observation, including explicit empty/rejected lists.
 -- Failed same-version replacement cannot leave that version selectable.
 select case when l.valid and not exists(select 1 from private.stockflow_economic_import_exceptions e
   where e.company_id=l.company_id and e.evidence->>'kind'='customer_ledger_master' and e.recorded_at>=l.imported_at
    and (e.evidence->>'sourceVersion'=l.source_version or e.evidence->>'blocking'='true')) then l.source_version end
 from private.stockflow_economic_ledger_generations l where l.company_id=p_company
  and exists(select 1 from private.stockflow_economic_source_coverage c where c.company_id=l.company_id and c.source_version=l.source_version)
 order by l.observed_at desc,l.imported_at desc,l.source_version desc limit 1
$$;
revoke all on function private.stockflow_current_ledger_generation(text) from public,anon,authenticated,service_role;

create table private.stockflow_customer_identity_events (
 id uuid primary key default gen_random_uuid(),company_id text not null,source_id text not null,
 customer_id uuid not null references private.stockflow_customers(id),
 action text not null check(action in ('confirmed')),actor text not null,
 reason text not null check(length(btrim(reason)) between 3 and 300),source_version text not null,
 ledger_name_at_confirmation text not null,request_id text not null,
 recorded_at timestamptz not null default clock_timestamp()
);
alter table private.stockflow_customer_identity_events enable row level security;
revoke all on private.stockflow_customer_identity_events from public,anon,authenticated;
create trigger immutable before update or delete on private.stockflow_customer_identity_events
 for each row execute function private.prevent_order_event_mutation();

create function private.stockflow_customer_link_command(p_actor text,p_roles text[],p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private,extensions as $$
declare
 v_company text:=btrim(p_payload->>'companyId'); v_version text; v_companies jsonb; v_search text;
 v_state text; v_page integer; v_rows jsonb; v_total bigint; v_observed timestamptz;
 v_row jsonb; v_customer private.stockflow_customers%rowtype; v_name text; v_key text; v_reason text;
 v_result jsonb; v_ids jsonb:='[]'::jsonb;
begin
 if not coalesce(p_roles&&array['administrator','management'],false) then
  raise exception 'Management approval required' using errcode='42501';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid customer link request' using errcode='22023';end if;
 if p_action='get_link_suggestions' then
  v_search:=coalesce(p_payload->>'search','');v_state:=p_payload->>'state';
  if (p_payload ? 'companyId' and (jsonb_typeof(p_payload->'companyId') is distinct from 'string' or length(btrim(v_company)) not between 1 and 240))
   or (p_payload ? 'search' and jsonb_typeof(p_payload->'search') is distinct from 'string') or length(v_search)>120
   or (p_payload ? 'state' and (jsonb_typeof(p_payload->'state') is distinct from 'string' or v_state not in ('suggested','linked','conflict')))
   or (p_payload ? 'page' and (jsonb_typeof(p_payload->'page') is distinct from 'number' or coalesce(p_payload->>'page','') !~ '^[0-9]{1,10}$'))
  then raise exception 'Invalid customer link filters' using errcode='22023';end if;
  if coalesce((p_payload->>'page')::numeric,1) not between 1 and 2147483647 then raise exception 'Invalid page' using errcode='22023';end if;
  v_page:=coalesce((p_payload->>'page')::integer,1);
  if v_company is null then
   select coalesce(jsonb_agg(c.company_id order by c.company_id),'[]'::jsonb) into v_companies
    from (select d.company_id from (select distinct company_id from private.stockflow_economic_ledger_masters) d
     where private.stockflow_current_ledger_generation(d.company_id) is not null) c;
   if jsonb_array_length(v_companies)>1 then return jsonb_build_object('companies',v_companies);end if;
   v_company:=v_companies->>0;
  end if;
  v_version:=private.stockflow_current_ledger_generation(v_company);
  if v_version is null then return jsonb_build_object('companyId',null,'sourceVersion',null,'rows','[]'::jsonb,'waiting',true);end if;
  select observed_at into v_observed from private.stockflow_economic_ledger_generations where company_id=v_company and source_version=v_version;
  with matches as (
   select c.id,c.name,c.city,l.name ledger_name,l.guid,
    case when ci.source_id=l.guid then 'linked' when ci.source_id is not null or gi.customer_id is not null then 'conflict' else 'suggested' end state,
    case when gi.customer_id is not null and gi.customer_id<>c.id then jsonb_build_object('linkedTo',jsonb_build_object('customerId',gi.customer_id,'name',gc.name))
     when ci.source_id is not null and ci.source_id<>l.guid then jsonb_build_object('linkedTo',jsonb_build_object('guid',ci.source_id)) else '{}'::jsonb end extra
   from private.stockflow_customers c join private.stockflow_economic_ledger_generations g on g.company_id=v_company and g.source_version=v_version
   left join private.stockflow_economic_customer_identities ci on ci.company_id=v_company and ci.customer_id=c.id
   join private.stockflow_economic_ledger_masters l on l.company_id=g.company_id and l.source_version=g.catalog_version
    and (coalesce(c.tally_key,c.name)=btrim(l.name) or ci.source_id=l.guid)
   left join private.stockflow_economic_customer_identities gi on gi.company_id=v_company and gi.source_id=l.guid
   left join private.stockflow_customers gc on gc.id=gi.customer_id
   where c.active and (c.tally_key is not null or ci.source_id=l.guid or exists(
    select 1 from public.stockflow_snapshots s,jsonb_array_elements(case when jsonb_typeof(s.payload->'customers')='array' then s.payload->'customers' else '[]'::jsonb end) d
    where s.id='suprabha' and d->>'tallyKey'=c.name and d->>'name'=c.name))
    and (strpos(lower(c.name),lower(v_search))>0 or strpos(lower(l.name),lower(v_search))>0)
  ), filtered as (select * from matches where v_state is null or state=v_state),
  paged as (select * from filtered order by name,id limit 25 offset (v_page::bigint-1)*25)
  select (select count(*) from filtered),coalesce(jsonb_agg(jsonb_build_object('customerId',id,'customerName',name,'city',city,
   'ledgerName',ledger_name,'guid',guid,'state',state)||extra order by name,id),'[]'::jsonb) into v_total,v_rows from paged;
  return jsonb_build_object('companyId',v_company,'sourceVersion',v_version,'observedAt',v_observed,'rows',v_rows,
   'page',jsonb_build_object('page',v_page,'pageSize',25,'total',v_total));
 end if;
 if p_action is distinct from 'confirm_customer_links' then raise exception 'Unsupported customer link action' using errcode='22023';end if;
 v_version:=btrim(p_payload->>'sourceVersion');v_key:=btrim(p_payload->>'idempotencyKey');v_reason:=btrim(p_payload->>'reason');
 if jsonb_typeof(p_payload->'companyId') is distinct from 'string' or length(btrim(v_company)) not between 1 and 240
  or jsonb_typeof(p_payload->'sourceVersion') is distinct from 'string' or length(btrim(v_version)) not between 1 and 240
  or jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(v_reason) not between 3 and 300
  or jsonb_typeof(p_payload->'idempotencyKey') is distinct from 'string' or length(v_key)<16 or length(p_payload->>'idempotencyKey')>200
  or jsonb_typeof(p_payload->'rows') is distinct from 'array'
  or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('companyId','sourceVersion','rows','reason','idempotencyKey'))
 then raise exception 'Invalid customer link command' using errcode='22023';end if;
 v_rows:=p_payload->'rows';
 if jsonb_array_length(v_rows) not between 1 and 50 then raise exception 'Select 1 to 50 distinct links' using errcode='22023';end if;
 for v_row in select value from jsonb_array_elements(v_rows) loop
  if jsonb_typeof(v_row) is distinct from 'object' then raise exception 'Invalid link row' using errcode='22023';end if;
  if jsonb_typeof(v_row->'customerId') is distinct from 'string' or coalesce(v_row->>'customerId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(v_row->'ledgerGuid') is distinct from 'string' or length(btrim(v_row->>'ledgerGuid')) not between 1 and 240
   or exists(select 1 from jsonb_object_keys(v_row) k where k not in ('customerId','ledgerGuid'))
  then raise exception 'Invalid link row' using errcode='22023';end if;
 end loop;
 if (select count(distinct (e->>'customerId')::uuid) from jsonb_array_elements(v_rows) e)<>jsonb_array_length(v_rows)
  or (select count(distinct btrim(e->>'ledgerGuid')) from jsonb_array_elements(v_rows) e)<>jsonb_array_length(v_rows)
 then raise exception 'Select distinct customers and GUIDs' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('instrument-economics-v1',0));
 v_result:=private.begin_stockflow_command(p_actor,'confirm_customer_links',v_key,p_payload);
 if v_result is not null then return v_result;end if;
 if v_version is distinct from private.stockflow_current_ledger_generation(v_company) then
  raise exception 'The Tally ledger list changed. Reload and review.' using errcode='PT409';end if;
 -- No customer row locks: identity writes are serialized by the economics advisory lock and
 -- the identity unique keys; the identity FK takes only KEY SHARE, compatible with the
 -- AFTER-trigger customer sync's non-key updates.
 for v_row in select value from jsonb_array_elements(v_rows) order by (value->>'customerId')::uuid loop
  select * into v_customer from private.stockflow_customers where id=(v_row->>'customerId')::uuid;
  select l.name into v_name from private.stockflow_economic_ledger_masters l
   join private.stockflow_economic_ledger_generations g on g.company_id=l.company_id and g.catalog_version=l.source_version
   where g.company_id=v_company and g.source_version=v_version and l.guid=btrim(v_row->>'ledgerGuid');
  if v_customer.id is null or not v_customer.active or v_name is null or btrim(v_name) is distinct from coalesce(v_customer.tally_key,v_customer.name)
   or (v_customer.tally_key is null and not exists(
    select 1 from public.stockflow_snapshots s,jsonb_array_elements(case when jsonb_typeof(s.payload->'customers')='array' then s.payload->'customers' else '[]'::jsonb end) d
    where s.id='suprabha' and d->>'tallyKey'=v_customer.name and d->>'name'=v_customer.name))
   or exists(select 1 from private.stockflow_economic_customer_identities where company_id=v_company
    and (source_id=btrim(v_row->>'ledgerGuid') or customer_id=v_customer.id)) then
   raise exception '%: no longer an exact unlinked match. Reload.',coalesce(v_customer.name,v_row->>'customerId') using errcode='PT409';end if;
  insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
   values(v_company,btrim(v_row->>'ledgerGuid'),v_customer.id,p_actor);
  insert into private.stockflow_customer_identity_events(company_id,source_id,customer_id,action,actor,reason,source_version,ledger_name_at_confirmation,request_id)
   values(v_company,btrim(v_row->>'ledgerGuid'),v_customer.id,'confirmed',p_actor,v_reason,v_version,v_name,v_key);
  v_ids:=v_ids||jsonb_build_array(v_customer.id);
 end loop;
 v_result:=jsonb_build_object('ok',true,'confirmed',jsonb_array_length(v_ids),'customerIds',v_ids);
 perform private.finish_stockflow_command(p_actor,'confirm_customer_links',v_key,p_payload,null,v_result);
 return v_result;
end$$;
revoke all on function private.stockflow_customer_link_command(text,text[],text,jsonb) from public,anon,authenticated,service_role;

-- A changed payload under a used key keeps the shared contract (22023 from begin_stockflow_command).
do $patch$
declare v_definition text;v_anchor text;
begin
 v_definition:=replace(pg_get_functiondef('public.stockflow_economics_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
 v_anchor:=$anchor$if p_action='get_instrument_economics' then
  if coalesce(p_payload->>'view','full') not in ('summary','full') then
   raise exception 'Invalid economics read view' using errcode='22023';
  end if;
  return private.stockflow_economic_workspace_read(roles,coalesce(p_payload->>'view','full')='summary');
 end if;$anchor$;
 if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor)<>1 then raise exception 'Unexpected economics gateway customer link seam';end if;
 v_definition:=replace(v_definition,v_anchor,v_anchor||E'\n'||$line$ if p_action in ('get_link_suggestions','confirm_customer_links') then return private.stockflow_customer_link_command(actor,roles,p_action,p_payload);end if;$line$);
 -- The existing triple FK already prevents a mismatched target from committing.
 -- Return one governed error for conflicts on either side instead of raw 23503/23505.
 v_anchor:=$identity$  insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
  values(btrim(p_payload->>'companyId'),btrim(p_payload->>'customerSourceId'),(p_payload->>'customerId')::uuid,actor) on conflict(company_id,source_id) do nothing;$identity$;
 if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor)<>1 then raise exception 'Unexpected create_target identity seam';end if;
 v_definition:=replace(v_definition,v_anchor,$guard$  if exists(select 1 from private.stockflow_economic_customer_identities i
   where i.company_id=btrim(p_payload->>'companyId') and
    ((i.source_id=btrim(p_payload->>'customerSourceId') and i.customer_id<>(p_payload->>'customerId')::uuid)
     or (i.customer_id=(p_payload->>'customerId')::uuid and i.source_id<>btrim(p_payload->>'customerSourceId')))) then
   raise exception 'Canonical customer identity conflicts with existing verification' using errcode='22023';end if;
  insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
   values(btrim(p_payload->>'companyId'),btrim(p_payload->>'customerSourceId'),(p_payload->>'customerId')::uuid,actor) on conflict do nothing;
  if not exists(select 1 from private.stockflow_economic_customer_identities i where i.company_id=btrim(p_payload->>'companyId')
    and i.source_id=btrim(p_payload->>'customerSourceId') and i.customer_id=(p_payload->>'customerId')::uuid) then
   raise exception 'Canonical customer identity conflicts with existing verification' using errcode='22023';end if;$guard$);
 execute v_definition;
end$patch$;
revoke all on function public.stockflow_economics_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_economics_gateway(text,text,text,jsonb) to service_role;

-- Preserve the existing customer UUID when a visit-only customer gains a ledger,
-- and use its confirmed GUID after a ledger rename. No fuzzy automatic links.
do $sync_upgrade$
declare v_definition text;v_anchor text;
begin
 v_definition:=replace(pg_get_functiondef('private.stockflow_sync_tally_customers()'::regprocedure),chr(13),'');
 v_anchor:='v_balance numeric(18,2);';
 if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor)<>1 then raise exception 'Unexpected customer sync declaration';end if;
 v_definition:=replace(v_definition,v_anchor,v_anchor||' v_linked_ids uuid[];');
 v_anchor:=$old$    insert into private.stockflow_customers(tally_key,name,phone,city,active,created_by_email,updated_at,tally_balance,balance_as_of)$old$;
 if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor)<>1 then raise exception 'Unexpected customer sync insert seam';end if;
 v_definition:=replace(v_definition,v_anchor,$new$    select array_agg(distinct i.customer_id) into v_linked_ids
    from private.stockflow_economic_customer_identities i
    join private.stockflow_economic_ledger_generations g on g.company_id=i.company_id
      and g.source_version=private.stockflow_current_ledger_generation(i.company_id)
    join private.stockflow_economic_ledger_masters l on l.company_id=g.company_id and l.source_version=g.catalog_version
      and l.guid=i.source_id and btrim(l.name)=v_tally_key;
    if cardinality(v_linked_ids)>1 then raise exception 'Customer ledger identity is ambiguous across companies' using errcode='22023';end if;
    if cardinality(v_linked_ids)=1 then
      if exists(select 1 from private.stockflow_customers where tally_key=v_tally_key and id<>v_linked_ids[1]) then
        raise exception 'Ledger already has a different customer record; review the conflict' using errcode='22023';end if;
      update private.stockflow_customers set tally_key=v_tally_key,name=v_name,
        phone=coalesce(nullif(left(btrim(coalesce(v_customer->>'phone','')),80),''),phone),
        city=coalesce(nullif(left(btrim(coalesce(v_customer->>'city','')),160),''),city),
        active=true,updated_at=now(),tally_balance=v_balance,balance_as_of=case when v_balance is null then null else now() end
      where id=v_linked_ids[1];
      continue;
    end if;
    -- Keep the visit customer pending for explicit exact-name confirmation.
    -- The source snapshot retains the ledger while its financial fields stay unavailable.
    if exists(select 1 from private.stockflow_customers where active and tally_key is null and name=v_tally_key) then continue;end if;
$new$||v_anchor);
 execute v_definition;
end $sync_upgrade$;
commit;
