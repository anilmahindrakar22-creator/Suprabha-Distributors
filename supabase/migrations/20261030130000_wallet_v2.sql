begin;

create table private.stockflow_wallet_divisions (
 id uuid primary key default extensions.gen_random_uuid(), code text not null unique,
 name text not null, sort_order integer not null, active boolean not null default true
);
insert into private.stockflow_wallet_divisions(code,name,sort_order) values
 ('BIOCHEM','Biochemistry',1),('HAEM','Haematology',2),('IMMUNO','Immunoassay',3),
 ('MOLECULAR','Molecular',4),('MICRO','Microbiology',5),('RAPID','Rapid',6),
 ('COAG','Coagulation',7),('ELECTRO','Electrolytes',8),('HBA1C','HbA1c',9),('OTHERS','Others',10);
create table private.stockflow_wallet_snapshots (
 id uuid primary key default extensions.gen_random_uuid(),
 customer_id uuid not null references private.stockflow_customers(id),
 monthly_wallet_paise bigint not null check(monthly_wallet_paise between 0 and 9000000000000000),
 method text not null check(method in ('customer_stated','test_volume','manager_estimate')),
 source text not null check(length(btrim(source)) between 3 and 500),
 confidence text not null check(confidence in ('high','medium','low')),
 as_of date not null check(as_of<=(now() at time zone 'Asia/Kolkata')::date),
 note text not null check(length(btrim(note)) between 3 and 500),
 lowered_reason text check(length(btrim(lowered_reason)) between 3 and 500),
 entered_by text not null, entered_at timestamptz not null default clock_timestamp(),
 verified_by text check(verified_by is null)
);
create index stockflow_wallet_current on private.stockflow_wallet_snapshots(customer_id,as_of desc,entered_at desc,id desc);
create table private.stockflow_wallet_snapshot_divisions (
 snapshot_id uuid not null references private.stockflow_wallet_snapshots(id),
 division_id uuid not null references private.stockflow_wallet_divisions(id),
 monthly_wallet_paise bigint not null check(monthly_wallet_paise between 0 and 9000000000000000),
 primary key(snapshot_id,division_id)
);
create table private.stockflow_wallet_policies (
 version integer primary key, wallet_share_target_bps integer not null check(wallet_share_target_bps between 1000 and 10000),
 focus_band_bps integer not null check(focus_band_bps between 1000 and 10000),
 stale_after_months integer not null check(stale_after_months between 1 and 24),
 note text not null check(length(btrim(note)) between 3 and 500), entered_by text not null,
 entered_at timestamptz not null default clock_timestamp()
);
insert into private.stockflow_wallet_policies values(1,8000,8000,6,'Initial wallet policy','seed',clock_timestamp());
do $$
declare t text;
begin
 foreach t in array array['stockflow_wallet_divisions','stockflow_wallet_snapshots','stockflow_wallet_snapshot_divisions','stockflow_wallet_policies'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
  execute format('create trigger %I before delete on private.%I for each row execute function private.prevent_business_delete()',t||'_no_delete',t);
  if t<>'stockflow_wallet_divisions' then
   execute format('create trigger %I before update on private.%I for each row execute function private.prevent_immutable_pricing_update()',t||'_immutable',t);
  end if;
 end loop;
end$$;

create function private.stockflow_wallet_policy_read() returns jsonb
language sql stable set search_path=pg_catalog,private as $$
 select jsonb_build_object('version',version,'walletShareTargetBps',wallet_share_target_bps,
  'focusBandBps',focus_band_bps,'staleAfterMonths',stale_after_months,'note',note,'enteredBy',entered_by,'enteredAt',entered_at)
 from private.stockflow_wallet_policies order by version desc limit 1;
$$;
create function private.stockflow_wallet_monthly(p_sum numeric) returns numeric
language sql immutable set search_path=pg_catalog as $$
 select case when p_sum>=0 then floor((p_sum*2+3)/6) else -floor((-p_sum*2+3)/6) end;
$$;

-- One shared read calculation: rank the complete population before any filter or page.
create function private.stockflow_wallet_read(p_today date) returns jsonb
language plpgsql stable set search_path=pg_catalog,private as $$
declare window_end date:=date_trunc('month',p_today)::date;
 window_start date:=(window_end-interval '3 months')::date; company text; month_index integer;
 certified boolean:=true; reason text; status jsonb; policy jsonb:=private.stockflow_wallet_policy_read();
 rows jsonb; summary jsonb; unlinked numeric; unlinked_count bigint;
begin
 if p_today is null then raise exception 'Wallet date required' using errcode='22023';end if;
 if not exists(select 1 from private.stockflow_economic_customer_identities) then
  certified:=false; reason:='No linked companies';
 end if;
 for company in select distinct company_id from private.stockflow_economic_customer_identities order by company_id loop
  status:=private.stockflow_sales_coverage_status(company,window_start,window_end-1);
  if (status->>'complete')::boolean is distinct from true then
   certified:=false; reason:=coalesce(reason,'Sales coverage incomplete: '||company);
  end if;
  for month_index in 0..2 loop
   status:=private.stockflow_sales_reconciliation(company,(window_start+month_index*interval '1 month')::date);
   if status->>'state' is distinct from 'matches' then
    certified:=false; reason:=coalesce(reason,'Sales reconciliation '||(status->>'state')||': '||company||' '||(status->>'month'));
   end if;
  end loop;
 end loop;
 with latest as (
  select distinct on(v.company_id,v.source_id) v.* from private.stockflow_economic_source_vouchers v
  order by v.company_id,v.source_id,v.source_revision desc
 ), ledgers as (
  select v.company_id,v.customer_source_id,sum(l.net_sales_paise::numeric) net
  from latest v join private.stockflow_economic_source_lines l on l.voucher_id=v.id
  where not v.cancelled and v.kind in ('sale','return','credit') and v.business_date>=window_start and v.business_date<window_end
  group by v.company_id,v.customer_source_id
 ), sales as (
  select i.customer_id,private.stockflow_wallet_monthly(sum(l.net)) amount
  from ledgers l join private.stockflow_economic_customer_identities i on i.company_id=l.company_id and i.source_id=l.customer_source_id
  group by i.customer_id
 ), current_snapshots as (
  select distinct on(customer_id) * from private.stockflow_wallet_snapshots order by customer_id,as_of desc,entered_at desc,id desc
 ), figures as (
  select c.id,c.name,c.city,s.monthly_wallet_paise wallet,s.confidence,s.as_of,
   s.as_of<(p_today-make_interval(months=>(policy->>'staleAfterMonths')::integer))::date stale,
   case when certified then coalesce(a.amount,0) end sales
  from private.stockflow_customers c left join current_snapshots s on s.customer_id=c.id left join sales a on a.customer_id=c.id
 ), gaps as (
  select *,case when certified and wallet is not null then greatest(ceil((policy->>'walletShareTargetBps')::numeric*wallet/10000)-sales,0) end gap
  from figures
 ), ranked as (
  select id,sum(gap) over(order by gap desc,name,id rows between unbounded preceding and current row)-gap preceding_gap,
   sum(gap) over() total_gap from gaps where gap>0
 ), output as (
  select g.*,case when certified then coalesce(r.preceding_gap*10000<(policy->>'focusBandBps')::numeric*r.total_gap,false) end focus
  from gaps g left join ranked r using(id)
 )
 select coalesce(jsonb_agg(jsonb_build_object('customerId',id,'name',name,'city',city,
  'walletPaise',wallet,'salesPaise',sales,'sharePermille',case when wallet>0 then round(sales*1000/wallet) end,
  'untappedPaise',case when certified and wallet is not null then greatest(wallet-sales,0) end,'captureGapPaise',gap,
  'confidence',confidence,'asOf',as_of,'verified',false,'stale',coalesce(stale,false),
  'belowSales',coalesce(sales>wallet,false),'inFocusBand',focus) order by gap desc nulls last,name,id),'[]'::jsonb),
  jsonb_build_object('focusCount',case when certified then count(*) filter(where focus) end,
   'focusGapPaise',case when certified then coalesce(sum(gap) filter(where focus),0) end,
   'estimatedAccounts',count(wallet),'accountsWithSales',case when certified then count(*) filter(where sales>0) end),
  (select private.stockflow_wallet_monthly(coalesce(sum(l.net),0)) from ledgers l where not exists(
   select 1 from private.stockflow_economic_customer_identities i where i.company_id=l.company_id and i.source_id=l.customer_source_id)),
  (select count(*) from ledgers l where not exists(
   select 1 from private.stockflow_economic_customer_identities i where i.company_id=l.company_id and i.source_id=l.customer_source_id))
 into rows,summary,unlinked,unlinked_count from output;
 return jsonb_build_object('policy',policy,'coverage',jsonb_build_object('certified',certified,'windowFrom',window_start,
  'windowTo',window_end-1,'windowLabel',to_char(window_start,'Mon')||chr(8211)||to_char(window_end-1,'Mon YYYY'),'reason',reason),
  'rows',rows,'summary',summary||jsonb_build_object('unlinkedSalesPaise',case when certified then unlinked end,
   'unlinkedLedgers',case when certified then unlinked_count end));
end$$;

create function private.stockflow_wallet_workspace_read(p_today date,p_view text,p_page integer,p_search text) returns jsonb
language plpgsql stable set search_path=pg_catalog,private as $$
declare data jsonb; selected jsonb; total bigint;
begin
 if p_view is null or p_view not in ('focus','all','no_estimate','stale','below_sales') or p_page is null or p_page<1
  or p_search is null or length(p_search)>80 then raise exception 'Invalid wallet request' using errcode='22023';end if;
 data:=private.stockflow_wallet_read(p_today);
 with filtered as (
  select value r from jsonb_array_elements(data->'rows') where
   (p_view='all' or (p_view='focus' and (value->>'inFocusBand')::boolean)
    or (p_view='no_estimate' and value->'walletPaise'='null'::jsonb)
    or (p_view='stale' and (value->>'stale')::boolean) or (p_view='below_sales' and (value->>'belowSales')::boolean))
   and (strpos(lower(value->>'name'),lower(p_search))>0 or strpos(lower(coalesce(value->>'city','')),lower(p_search))>0)
 ), numbered as (
  select r,row_number() over(order by (r->>'captureGapPaise')::numeric desc nulls last,r->>'name',r->>'customerId') n from filtered
 ) select count(*),coalesce(jsonb_agg(r order by n) filter(where n>(p_page::bigint-1)*50 and n<=p_page::bigint*50),'[]'::jsonb)
 into total,selected from numbered;
 return (data-'rows')||jsonb_build_object('view',p_view,'page',p_page,'pageSize',50,'total',total,'rows',selected);
end$$;

create function private.stockflow_wallet_account_read(p_today date,p_customer uuid) returns jsonb
language plpgsql stable set search_path=pg_catalog,private as $$
declare data jsonb:=private.stockflow_wallet_read(p_today); row_data jsonb; history jsonb; divisions jsonb;
begin
 select value into row_data from jsonb_array_elements(data->'rows') where value->>'customerId'=p_customer::text;
 if row_data is null then raise exception 'Customer not found' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'monthlyWalletPaise',s.monthly_wallet_paise,'method',s.method,
  'source',s.source,'confidence',s.confidence,'asOf',s.as_of,'note',s.note,'loweredReason',s.lowered_reason,
  'enteredBy',s.entered_by,'enteredAt',s.entered_at,'verifiedBy',s.verified_by,
  'divisions',coalesce(d.items,'[]'::jsonb),'unallocatedPaise',s.monthly_wallet_paise-coalesce(d.allocated,0))
  order by s.as_of desc,s.entered_at desc,s.id desc),'[]'::jsonb) into history
 from private.stockflow_wallet_snapshots s left join lateral (
  select jsonb_agg(jsonb_build_object('code',v.code,'name',v.name,'monthlyWalletPaise',d.monthly_wallet_paise) order by v.sort_order) items,
   sum(d.monthly_wallet_paise::numeric) allocated from private.stockflow_wallet_snapshot_divisions d
   join private.stockflow_wallet_divisions v on v.id=d.division_id where d.snapshot_id=s.id
 ) d on true where s.customer_id=p_customer;
 select coalesce(jsonb_agg(jsonb_build_object('code',code,'name',name) order by sort_order),'[]'::jsonb)
 into divisions from private.stockflow_wallet_divisions where active;
 return jsonb_build_object('policy',data->'policy','coverage',data->'coverage','row',row_data,
  'current',history->0,'history',history,'divisions',divisions);
end$$;

create function public.stockflow_wallet_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare actor text:=lower(btrim(p_actor_email)); roles text[]; hash text; key text; replay jsonb; result jsonb;
 customer uuid; current_snapshot private.stockflow_wallet_snapshots%rowtype; entity uuid; amount numeric;
 item jsonb; division uuid; division_sum numeric:=0; codes text[]:='{}'; version_now integer;
 today date:=(now() at time zone 'Asia/Kolkata')::date;
begin
 -- Latest economics gateway patch: 20261030101000_sales_coverage.sql retains this preamble.
 select secret_sha256 into hash from private.stockflow_gateway_config where name='orders';
 if hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>hash then raise exception 'Unauthorized gateway' using errcode='42501';end if;
 roles:=private.stockflow_active_member_roles(actor);
 if not coalesce(roles&&array['administrator','management'],false) then raise exception 'Wallet management access required' using errcode='PT403';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid wallet request' using errcode='22023';end if;
 if p_action='get_wallet_workspace' then
  return private.stockflow_wallet_workspace_read(today,p_payload->>'view',(p_payload->>'page')::integer,p_payload->>'search');
 elsif p_action='get_wallet_account' then
  return private.stockflow_wallet_account_read(today,(p_payload->>'customerId')::uuid);
 end if;
 if p_action is null or p_action not in ('record_wallet_snapshot','set_wallet_policy') then raise exception 'Unsupported wallet action' using errcode='22023';end if;
 key:=p_payload->>'requestId';
 replay:=private.begin_stockflow_command(actor,p_action,key,p_payload);if replay is not null then return replay;end if;
 if length(btrim(coalesce(p_payload->>'note',''))) not between 3 and 500 then raise exception 'Wallet note required' using errcode='22023';end if;
 if p_action='record_wallet_snapshot' then
  customer:=(p_payload->>'customerId')::uuid;
  perform pg_advisory_xact_lock(hashtextextended('wallet:'||customer,0));
  if not exists(select 1 from private.stockflow_customers where id=customer) then raise exception 'Customer not found' using errcode='22023';end if;
  select * into current_snapshot from private.stockflow_wallet_snapshots where customer_id=customer order by as_of desc,entered_at desc,id desc limit 1;
  if current_snapshot.id is distinct from (p_payload->>'expectedCurrentSnapshotId')::uuid then raise exception 'Wallet changed; refresh before retrying' using errcode='PT409';end if;
  amount:=(p_payload->>'monthlyWalletPaise')::numeric;
  if jsonb_typeof(p_payload->'monthlyWalletPaise') is distinct from 'number'
   or amount is null or amount<>trunc(amount) or amount not between 0 and 9000000000000000
   or coalesce(p_payload->>'method','') not in ('customer_stated','test_volume','manager_estimate')
   or coalesce(p_payload->>'confidence','') not in ('high','medium','low')
   or length(btrim(coalesce(p_payload->>'source',''))) not between 3 and 500
   or coalesce(p_payload->>'asOf','') !~ '^\d{4}-\d{2}-\d{2}$' or (p_payload->>'asOf')::date>today
   or jsonb_typeof(p_payload->'divisions') is distinct from 'array' then raise exception 'Invalid wallet snapshot' using errcode='22023';end if;
  if (amount<current_snapshot.monthly_wallet_paise and length(btrim(coalesce(p_payload->>'loweredReason',''))) not between 3 and 500)
   or (not coalesce(amount<current_snapshot.monthly_wallet_paise,false) and p_payload->>'loweredReason' is not null)
   then raise exception 'Lowering reason must accompany only a lowered estimate' using errcode='22023';end if;
  if jsonb_array_length(p_payload->'divisions')>10 then raise exception 'Too many wallet divisions' using errcode='22023';end if;
  for item in select value from jsonb_array_elements(p_payload->'divisions') loop
   select id into division from private.stockflow_wallet_divisions where code=item->>'code' and active;
   if division is null or (item->>'code')=any(codes) or jsonb_typeof(item->'monthlyWalletPaise') is distinct from 'number'
    or (item->>'monthlyWalletPaise')::numeric<>trunc((item->>'monthlyWalletPaise')::numeric)
    or (item->>'monthlyWalletPaise')::numeric not between 0 and 9000000000000000 then raise exception 'Invalid wallet division' using errcode='22023';end if;
   codes:=array_append(codes,item->>'code'); division_sum:=division_sum+(item->>'monthlyWalletPaise')::numeric;
  end loop;
  if division_sum>amount then raise exception 'Division sum exceeds wallet' using errcode='22023';end if;
  insert into private.stockflow_wallet_snapshots(customer_id,monthly_wallet_paise,method,source,confidence,as_of,note,lowered_reason,entered_by)
  values(customer,amount::bigint,p_payload->>'method',btrim(p_payload->>'source'),p_payload->>'confidence',(p_payload->>'asOf')::date,
   btrim(p_payload->>'note'),p_payload->>'loweredReason',actor) returning id into entity;
  insert into private.stockflow_wallet_snapshot_divisions(snapshot_id,division_id,monthly_wallet_paise)
  select entity,d.id,(e->>'monthlyWalletPaise')::bigint from jsonb_array_elements(p_payload->'divisions') e
  join private.stockflow_wallet_divisions d on d.code=e->>'code';
  result:=jsonb_build_object('ok',true,'snapshotId',entity);
 else
  perform pg_advisory_xact_lock(hashtextextended('wallet-policy',0));
  select max(version) into version_now from private.stockflow_wallet_policies;
  if version_now is distinct from (p_payload->>'expectedVersion')::integer then raise exception 'Wallet policy changed; refresh before retrying' using errcode='PT409';end if;
  if coalesce((p_payload->>'walletShareTargetBps')::numeric between 1000 and 10000,false) is not true
   or coalesce((p_payload->>'focusBandBps')::numeric between 1000 and 10000,false) is not true
   or coalesce((p_payload->>'staleAfterMonths')::numeric between 1 and 24,false) is not true
   or exists(select 1 from jsonb_each(p_payload) e where e.key in ('walletShareTargetBps','focusBandBps','staleAfterMonths')
    and (jsonb_typeof(e.value)<>'number' or (e.value#>>'{}')::numeric<>trunc((e.value#>>'{}')::numeric)))
   then raise exception 'Invalid wallet policy' using errcode='22023';end if;
  begin
   insert into private.stockflow_wallet_policies(version,wallet_share_target_bps,focus_band_bps,stale_after_months,note,entered_by)
   values(version_now+1,(p_payload->>'walletShareTargetBps')::integer,(p_payload->>'focusBandBps')::integer,
    (p_payload->>'staleAfterMonths')::integer,btrim(p_payload->>'note'),actor);
  exception when unique_violation then raise exception 'Wallet policy changed; refresh before retrying' using errcode='PT409';end;
  entity:=extensions.gen_random_uuid();result:=jsonb_build_object('ok',true,'version',version_now+1);
 end if;
 insert into private.stockflow_economic_audit(action,entity_id,actor,payload) values(p_action,entity,actor,p_payload);
 perform private.finish_stockflow_command(actor,p_action,key,p_payload,entity,result);
 return result;
end$$;

revoke all on function private.stockflow_wallet_policy_read(),private.stockflow_wallet_monthly(numeric),
 private.stockflow_wallet_read(date),private.stockflow_wallet_workspace_read(date,text,integer,text),
 private.stockflow_wallet_account_read(date,uuid) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_wallet_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_wallet_gateway(text,text,text,jsonb) to service_role;
commit;
