begin;

do $patch$
declare definition text; anchor text := $a$'Complete window omitted known vouchers; supply cancellation revisions',doc-'vouchers'$a$;
begin
 definition:=pg_get_functiondef('private.stockflow_import_economic_vouchers()'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'Expected one omission evidence anchor';end if;
 definition:=replace(definition,anchor,$replacement$'Complete window omitted known vouchers; supply cancellation revisions',
  (doc-'vouchers') || (select jsonb_build_object('missingCount',count(*),'missingSourceIds',
   coalesce(jsonb_agg(source_id order by source_id) filter(where ordinal<=50),'[]'::jsonb))
   from (select source_id,row_number() over(order by source_id) ordinal from (
    select distinct v.source_id from private.stockflow_economic_source_vouchers v
    where v.company_id=doc->>'companyId' and v.kind<>'purchase' and v.business_date>=from_date and v.business_date<to_date
     and not exists(select 1 from jsonb_array_elements(doc->'vouchers') e where e->>'sourceId'=v.source_id)
   ) missing) numbered)$replacement$);
 execute definition;
end$patch$;

-- Invalid or absent dates are undated evidence, never silently outside a window.
create function private.stockflow_sales_exception_date(p_evidence jsonb) returns date
language plpgsql immutable set search_path=pg_catalog as $$
begin
 if coalesce(p_evidence->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then return null;end if;
 return (p_evidence->>'date')::date;
exception when data_exception then return null;
end$$;

create function private.stockflow_sales_coverage_status(p_company text,p_from date,p_to_inclusive date) returns jsonb
language plpgsql stable set search_path=pg_catalog,private as $$
declare coverage private.stockflow_economic_source_coverage%rowtype; blockers jsonb; total bigint;
begin
 if p_from is null or p_to_inclusive is null or p_to_inclusive<p_from then raise exception 'Invalid sales window' using errcode='22023';end if;
 select * into coverage from private.stockflow_economic_source_coverage c
 where c.company_id=p_company and c.window_from<=p_from and c.window_to>p_to_inclusive
 order by c.imported_at desc,c.source_version desc,c.id desc limit 1;
 select count(*),coalesce(jsonb_agg(jsonb_build_object('sourceId',coalesce(source_id,'Company-wide'),'reason',reason,'recordedAt',recorded_at)
  order by recorded_at desc,id desc) filter(where ordinal<=20),'[]'::jsonb) into total,blockers
 from (select e.*,row_number() over(order by recorded_at desc,id desc) ordinal
  from private.stockflow_economic_import_exceptions e
  where (e.company_id=p_company or e.company_id is null)
   and (coverage.id is null or e.recorded_at>coverage.imported_at)
   and (private.stockflow_sales_exception_date(e.evidence) is null
    or private.stockflow_sales_exception_date(e.evidence) between p_from and p_to_inclusive)) exceptions;
 return jsonb_build_object('complete',coverage.id is not null and total=0,
  'coveredFrom',coverage.window_from,'coveredTo',coverage.window_to-1,
  'sourceVersion',coverage.source_version,'importedAt',coverage.imported_at,
  'blockingExceptions',blockers,'blockingCount',total);
end$$;

create table private.stockflow_sales_control_totals (
 company_id text not null,month date not null,kind text not null check(kind in ('sales_ledger','customer')),
 source_key text not null,name text,net_paise bigint not null check(abs(net_paise::numeric)<=9000000000000000),
 source_version text not null,imported_at timestamptz not null default clock_timestamp(),
 primary key(company_id,month,kind,source_key,source_version)
);
-- A generation manifest prevents partial or empty invalid ledger sets from
-- masquerading as a zero control. It also freezes replayed source versions.
create table private.stockflow_sales_control_imports (
 id bigint generated always as identity primary key,company_id text,source_version text,
 imported_at timestamptz not null default clock_timestamp(),valid_months date[] not null default '{}',
 rejected_parts integer not null default 0,unique(company_id,source_version)
);
alter table private.stockflow_sales_control_totals enable row level security;
alter table private.stockflow_sales_control_imports enable row level security;
revoke all on private.stockflow_sales_control_totals,private.stockflow_sales_control_imports from public,anon,authenticated;
create trigger immutable before update or delete on private.stockflow_sales_control_totals
 for each row execute function private.prevent_immutable_pricing_update();
create trigger immutable before update or delete on private.stockflow_sales_control_imports
 for each row execute function private.prevent_immutable_pricing_update();

create function private.stockflow_import_sales_control_totals() returns trigger
language plpgsql security definer set search_path=pg_catalog,private,public as $$
declare doc jsonb; part jsonb; item jsonb; month_date date; valid_months date[]:='{}';
 rejected integer:=0; company text; version text; seen_keys text[];
 amount numeric; opening numeric; closing numeric;
begin
 doc:=new.payload->'salesControlTotals';
 new.payload:=new.payload-'salesControlTotals';
 if doc is null then return new;end if;
 -- Contain all payload failures, independently of economic import admission.
 begin
  if new.id<>'suprabha' or jsonb_typeof(doc) is distinct from 'object'
   or jsonb_typeof(doc->'companyId') is distinct from 'string' or nullif(btrim(doc->>'companyId'),'') is null
   or jsonb_typeof(doc->'sourceVersion') is distinct from 'string' or nullif(btrim(doc->>'sourceVersion'),'') is null
   or jsonb_typeof(doc->'months') is distinct from 'array' then raise exception 'Invalid control envelope';end if;
  company:=doc->>'companyId';version:=doc->>'sourceVersion';
  perform version::timestamptz;
  if jsonb_array_length(doc->'months') not between 1 and 3 then raise exception 'Control month bound';end if;
  perform pg_advisory_xact_lock(hashtextextended('sales-controls:'||company,0));
  if exists(select 1 from private.stockflow_sales_control_imports i where i.company_id=company and i.source_version=version) then return new;end if;
  -- Duplicate months invalidate the envelope: do not choose an arbitrary copy.
  if (select count(distinct value->>'month') from jsonb_array_elements(doc->'months'))<>jsonb_array_length(doc->'months') then raise exception 'Duplicate control month';end if;
  for part in select value from jsonb_array_elements(doc->'months') loop
   begin
    if jsonb_typeof(part) is distinct from 'object' or coalesce(part->>'month','') !~ '^\d{4}-(0[1-9]|1[0-2])$'
     or jsonb_typeof(part->'salesLedgers') is distinct from 'array' then raise exception 'Invalid control month';end if;
    month_date:=((part->>'month')||'-01')::date;
    if jsonb_array_length(part->'salesLedgers')>500 then raise exception 'Ledger bound';end if;
    seen_keys:='{}';
    for item in select value from jsonb_array_elements(part->'salesLedgers') loop
     if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'ledgerId') is distinct from 'string'
      or nullif(btrim(item->>'ledgerId'),'') is null or (item->>'ledgerId')=any(seen_keys)
      or jsonb_typeof(item->'name') is distinct from 'string'
      or coalesce(item->>'openingPaise','') !~ '^-?[0-9]+$' or coalesce(item->>'closingPaise','') !~ '^-?[0-9]+$'
      or coalesce(item->>'netPaise','') !~ '^-?[0-9]+$' then raise exception 'Invalid sales ledger';end if;
     opening:=(item->>'openingPaise')::numeric;closing:=(item->>'closingPaise')::numeric;amount:=(item->>'netPaise')::numeric;
     if greatest(abs(opening),abs(closing),abs(amount))>9000000000000000 or amount<>closing-opening then raise exception 'Invalid ledger movement';end if;
     seen_keys:=array_append(seen_keys,item->>'ledgerId');
     insert into private.stockflow_sales_control_totals(company_id,month,kind,source_key,name,net_paise,source_version)
     values(company,month_date,'sales_ledger',item->>'ledgerId',item->>'name',amount::bigint,version);
    end loop;
    if abs((select coalesce(sum(net_paise),0) from private.stockflow_sales_control_totals where company_id=company and month=month_date and source_version=version and kind='sales_ledger'))>9000000000000000 then raise exception 'Unsafe ledger total';end if;
    -- Customer failures do not invalidate the independent Sales Accounts sum.
    begin
     if part ? 'customers' then
      if jsonb_typeof(part->'customers') is distinct from 'array' then raise exception 'Invalid customers';end if;
      if jsonb_array_length(part->'customers')>5000 then raise exception 'Customer bound';end if;
      seen_keys:='{}';
      for item in select value from jsonb_array_elements(part->'customers') loop
       if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'customerSourceId') is distinct from 'string'
        or nullif(btrim(item->>'customerSourceId'),'') is null or (item->>'customerSourceId')=any(seen_keys)
        or coalesce(item->>'grossPaise','') !~ '^-?[0-9]+$' then raise exception 'Invalid customer gross';end if;
       amount:=(item->>'grossPaise')::numeric;
       if abs(amount)>9000000000000000 then raise exception 'Unsafe customer gross';end if;
       seen_keys:=array_append(seen_keys,item->>'customerSourceId');
       insert into private.stockflow_sales_control_totals(company_id,month,kind,source_key,net_paise,source_version)
       values(company,month_date,'customer',item->>'customerSourceId',amount::bigint,version);
      end loop;
     end if;
    exception when others then rejected:=rejected+1;
    end;
    valid_months:=array_append(valid_months,month_date);
   exception when others then rejected:=rejected+1;
   end;
  end loop;
  insert into private.stockflow_sales_control_imports(company_id,source_version,valid_months,rejected_parts)
  values(company,version,valid_months,rejected);
 exception when others then
  -- Invalid envelopes are counted without retaining customer data in snapshots.
  insert into private.stockflow_sales_control_imports(rejected_parts) values(1);
 end;
 return new;
end$$;
-- PostgreSQL orders same-event triggers by name; sales sorts after economic.
create trigger stockflow_import_sales_control_totals before insert or update of payload on public.stockflow_snapshots
 for each row execute function private.stockflow_import_sales_control_totals();

create function private.stockflow_sales_reconciliation(p_company text,p_month date) returns jsonb
language plpgsql stable set search_path=pg_catalog,private as $$
declare app numeric; tally numeric; version text; difference numeric;
begin
 if p_month is null or p_month<>date_trunc('month',p_month)::date then raise exception 'Expected month start' using errcode='22023';end if;
 with latest as (select distinct on(source_id) * from private.stockflow_economic_source_vouchers
  where company_id=p_company order by source_id,source_revision desc)
 select coalesce(sum(l.net_sales_paise),0) into app from latest v join private.stockflow_economic_source_lines l on l.voucher_id=v.id
 where not v.cancelled and v.kind in ('sale','return','credit') and v.business_date>=p_month and v.business_date<(p_month+interval '1 month')::date;
 select i.source_version into version from private.stockflow_sales_control_imports i
 where i.company_id=p_company and p_month=any(i.valid_months) order by i.imported_at desc,i.id desc limit 1;
 if version is not null then
  select coalesce(sum(net_paise),0) into tally from private.stockflow_sales_control_totals
  where company_id=p_company and month=p_month and source_version=version and kind='sales_ledger';
 end if;
 difference:=app-tally;
 if greatest(abs(app),abs(tally),abs(difference))>9000000000000000 then raise exception 'Unsafe sales reconciliation amount' using errcode='22003';end if;
 return jsonb_build_object('month',to_char(p_month,'YYYY-MM'),'appNetPaise',app,'tallyNetPaise',tally,
  'differencePaise',difference,'state',case when tally is null then 'no_control' when difference=0 then 'matches' else 'differs' end);
end$$;

-- Customer controls are gross of GST and are intentionally separate from the
-- fixed three-month response contract.
create function private.stockflow_sales_customer_reconciliation(p_company text,p_month date) returns jsonb
language sql stable set search_path=pg_catalog,private as $$
 with generation as (
  select source_version from private.stockflow_sales_control_imports
  where company_id=p_company and p_month=any(valid_months) order by imported_at desc,id desc limit 1
 ), latest as (
  select distinct on(source_id) * from private.stockflow_economic_source_vouchers
  where company_id=p_company order by source_id,source_revision desc
 ), app as (
  select v.customer_source_id source_key,sum(l.net_sales_paise::numeric+l.gst_paise) gross
  from latest v join private.stockflow_economic_source_lines l on l.voucher_id=v.id
  where not v.cancelled and v.kind in ('sale','return','credit') and v.business_date>=p_month
   and v.business_date<(p_month+interval '1 month')::date and v.customer_source_id is not null
  group by v.customer_source_id
 ), tally as (
  select source_key,net_paise gross from private.stockflow_sales_control_totals
  where company_id=p_company and month=p_month and kind='customer' and source_version=(select source_version from generation)
 )
 select coalesce(jsonb_agg(jsonb_build_object('customerSourceId',coalesce(a.source_key,t.source_key),
  'appGrossPaise',coalesce(a.gross,0),'tallyGrossPaise',t.gross,'differencePaise',coalesce(a.gross,0)-t.gross,
  'state',case when t.gross is null then 'no_control' when coalesce(a.gross,0)=t.gross then 'matches' else 'differs' end)
  order by coalesce(a.source_key,t.source_key)),'[]'::jsonb)
 from app a full join tally t using(source_key);
$$;

create function private.stockflow_sales_coverage_read(p_roles text[]) returns jsonb
language plpgsql stable set search_path=pg_catalog,private as $$
declare company text; companies text[]; latest_at timestamptz; coverage jsonb; rebuild jsonb; months jsonb;
 window_to_exclusive date:=date_trunc('month',now() at time zone 'Asia/Kolkata')::date;
 window_from date:=(window_to_exclusive-interval '3 months')::date;
begin
 if not coalesce(p_roles&&array['administrator','management','accounts'],false) then
  raise exception 'Instrument economics access required' using errcode='42501';
 end if;
 -- The workspace's sourceImportedAt is max(source_vouchers.imported_at).
 -- Select its canonical company, never a caller-supplied company or snapshot name.
 select max(imported_at) into latest_at from private.stockflow_economic_source_vouchers;
 select array_agg(distinct company_id) into companies from private.stockflow_economic_source_vouchers where imported_at=latest_at;
 if latest_at is null then
  -- An empty complete envelope is still canonical economic evidence.
  select max(imported_at) into latest_at from private.stockflow_economic_source_coverage;
  select array_agg(distinct company_id) into companies from private.stockflow_economic_source_coverage where imported_at=latest_at;
 end if;
 if cardinality(companies)>1 then raise exception 'Ambiguous latest economic company' using errcode='22023';end if;
 company:=companies[1];
 coverage:=private.stockflow_sales_coverage_status(company,window_from,window_to_exclusive-1);
 select jsonb_build_object('state',s.state,'since',s.since,'reason',s.reason) into rebuild
 from private.stockflow_economic_rebuild_status s where s.company_id=company;
 select jsonb_agg(private.stockflow_sales_reconciliation(company,(window_from+n*interval '1 month')::date) order by n)
 into months from generate_series(0,2) n;
 return jsonb_build_object('window',jsonb_build_object('from',window_from,'to',window_to_exclusive-1),
  'complete',coverage->'complete','coveredFrom',coverage->'coveredFrom','coveredTo',coverage->'coveredTo',
  'sourceVersion',coverage->'sourceVersion','importedAt',coverage->'importedAt',
  'blockingCount',coverage->'blockingCount','blockingItems',coverage->'blockingExceptions',
  'rebuild',coalesce(rebuild,jsonb_build_object('state','ok','since',null,'reason',null)),'months',months);
end$$;

-- Keep the complete existing gateway body, including authentication, roles,
-- register commands and every existing action. Insert only a new read branch.
do $patch$
declare definition text; anchor text := $a$if p_action='get_instrument_economics' then$a$;
begin
 definition:=pg_get_functiondef('public.stockflow_economics_gateway(text,text,text,jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'Expected one economics gateway read anchor';end if;
 definition:=replace(definition,anchor,$branch$if p_action='get_sales_coverage' then
  if p_payload is distinct from '{}'::jsonb then raise exception 'Sales coverage takes an empty payload' using errcode='22023';end if;
  return private.stockflow_sales_coverage_read(roles);
 end if;
 $branch$||anchor);
 execute definition;
end$patch$;
revoke all on function public.stockflow_economics_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_economics_gateway(text,text,text,jsonb) to service_role;

revoke all on function private.stockflow_sales_coverage_read(text[]),private.stockflow_import_economic_vouchers(),private.stockflow_sales_exception_date(jsonb),
 private.stockflow_sales_coverage_status(text,date,date),private.stockflow_import_sales_control_totals(),
 private.stockflow_sales_reconciliation(text,date),private.stockflow_sales_customer_reconciliation(text,date) from public,anon,authenticated;

commit;
