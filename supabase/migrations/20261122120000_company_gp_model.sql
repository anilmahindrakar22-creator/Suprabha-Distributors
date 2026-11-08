begin;

create table private.stockflow_company_gp_runs (
 id uuid primary key default gen_random_uuid(),
 company_id text not null,
 source_watermark timestamptz not null,
 policy_version text not null default 'company_gp_v1',
 started_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,
 status text not null check(status in ('running','complete','failed')),
 line_count integer,
 duration_ms integer,
 error text
);
create index stockflow_company_gp_runs_latest on private.stockflow_company_gp_runs(company_id,completed_at desc,id desc) where status='complete';
create table private.stockflow_company_gp_lines (
 run_id uuid not null references private.stockflow_company_gp_runs(id) on delete cascade,
 source_line_id uuid not null,
 business_date date not null,
 customer_source_id text,
 product_id text,
 kind text not null,
 quantity numeric not null,
 revenue_paise bigint not null,
 cost_paise bigint,
 gp_paise bigint,
 status text not null check(status in ('costed','cost_unavailable','instrument_billing')),
 primary key(run_id,source_line_id),
 check((status='costed' and cost_paise is not null and gp_paise is not null and gp_paise=revenue_paise-cost_paise)
  or (status in ('cost_unavailable','instrument_billing') and cost_paise is null and gp_paise is null))
);
create index stockflow_company_gp_lines_date on private.stockflow_company_gp_lines(run_id,business_date);
alter table private.stockflow_company_gp_runs enable row level security;
alter table private.stockflow_company_gp_lines enable row level security;
revoke all on private.stockflow_company_gp_runs,private.stockflow_company_gp_lines from public,anon,authenticated;

create function private.stockflow_company_gp_refresh(p_company text) returns uuid
language plpgsql security definer set search_path=pg_catalog,private,public,extensions as $$
declare
 v_run uuid; previous_run private.stockflow_company_gp_runs%rowtype;
 v_watermark timestamptz; v_started timestamptz:=clock_timestamp(); v_line_count integer;
 product record; sale record;
 layer_dates date[]; layer_qty numeric[]; remaining_qty numeric[]; layer_net bigint[];
 taken_cost bigint[]; layer_batches integer[]; next_in_batch integer[];
 batch_heads integer[]; batch_qty numeric[]; output_costs bigint[];
 layer_count integer; active_end integer; expired_end integer; fifo_head integer;
 layer_index integer; batch_index integer; selected_batch integer;
 available numeric; needed numeric; taken numeric; piece bigint; total bigint;
begin
 if not pg_try_advisory_xact_lock(hashtext('company_gp:'||p_company)) then return null;end if;

 -- Capture the voucher revision set and watermark together before reading immutable lines.
 create temporary table company_gp_vouchers on commit drop as
 select v.id,v.source_id,v.business_date,v.customer_source_id,v.kind,v.cancelled,v.imported_at,
  not exists(select 1 from private.stockflow_economic_source_vouchers nv
   where nv.company_id=v.company_id and nv.source_id=v.source_id and nv.source_revision>v.source_revision) is_latest
 from private.stockflow_economic_source_vouchers v where v.company_id=p_company;
 select max(imported_at) into v_watermark from pg_temp.company_gp_vouchers;
 select * into previous_run from private.stockflow_company_gp_runs
 where company_id=p_company and status='complete' order by completed_at desc,id desc limit 1;
 if v_watermark is null or previous_run.source_watermark>=v_watermark then
  drop table pg_temp.company_gp_vouchers;
  return previous_run.id;
 end if;
 insert into private.stockflow_company_gp_runs(company_id,source_watermark,status,started_at)
 values(p_company,v_watermark,'running',v_started) returning id into v_run;

 -- non_economic, purchase_return and native_debit_note are ignored in v1.
 -- Instrument Economics remains authoritative for instrument verified/manual cost.
 -- Its attributed lines may receive a different FIFO cost in this company model.
 create temporary table company_gp_source on commit drop as
 with instrument_products as (
  select distinct pl.product_id
  from private.stockflow_economic_acquisition_links a
  join private.stockflow_economic_source_vouchers pv on pv.company_id=a.company_id and pv.source_id=a.source_id
  join private.stockflow_economic_source_lines pl on pl.voucher_id=pv.id and pl.line_key=a.line_key
  where a.company_id=p_company and pv.kind='purchase'
 )
 select l.id,l.line_key,l.product_id,l.unit,l.quantity,l.net_sales_paise,l.batch_id,
  l.original_company_id,l.original_voucher_id,l.original_line_key,
  v.source_id,v.business_date,v.customer_source_id,v.kind,
  ip.product_id is not null instrument_product,
  dense_rank() over(order by l.product_id,l.unit)::integer product_number,
  dense_rank() over(partition by l.product_id,l.unit order by l.batch_id)::integer batch_number,
  row_number() over(partition by l.product_id,l.unit order by v.business_date,v.source_id,l.line_key,l.id)::integer ordinal
 from pg_temp.company_gp_vouchers v
 join private.stockflow_economic_source_lines l on l.voucher_id=v.id
 left join instrument_products ip on ip.product_id=l.product_id
 where v.is_latest and not v.cancelled and
  ((v.kind='sale' and l.quantity>0) or v.kind='return' or
   (v.kind='purchase' and l.quantity>0 and l.net_sales_paise>=0
    and not exists(select 1 from private.stockflow_economic_acquisition_links a
     where a.company_id=p_company and a.source_id=v.source_id and a.line_key=l.line_key)));
 create index on pg_temp.company_gp_source(product_number,kind,ordinal);
 create index on pg_temp.company_gp_source(source_id,line_key);
 analyze pg_temp.company_gp_source;

 for product in
  select product_number,max(batch_number) batch_count,count(*)::integer row_count
  from pg_temp.company_gp_source group by product_number order by product_number
 loop
  -- Load this product/unit's layers once. Batch links and both FIFO heads only move forward.
  with layers as (
   select *,row_number() over(order by ordinal)::integer layer_number
   from pg_temp.company_gp_source where product_number=product.product_number and kind='purchase'
  ), linked as (
   select *,lead(layer_number,1,0) over(partition by batch_number order by layer_number) next_layer from layers
  )
  select array_agg(business_date order by layer_number),array_agg(quantity order by layer_number),
   array_agg(net_sales_paise order by layer_number),array_agg(batch_number order by layer_number),
   array_agg(next_layer order by layer_number)
  into layer_dates,layer_qty,layer_net,layer_batches,next_in_batch from linked;
  layer_count:=coalesce(cardinality(layer_qty),0);
  remaining_qty:=layer_qty;
  taken_cost:=array_fill(0::bigint,array[layer_count]);
  batch_heads:=array_fill(0,array[product.batch_count]);
  batch_qty:=array_fill(0::numeric,array[product.batch_count]);
  output_costs:=array_fill(null::bigint,array[product.row_count]);
  active_end:=0;expired_end:=0;fifo_head:=1;available:=0;

  for sale in select * from pg_temp.company_gp_source
   where product_number=product.product_number and kind in ('sale','return') order by ordinal
  loop
   -- Returns are resolved set-wise after all sales and never restore layer quantity.
   if sale.kind='return' or sale.instrument_product then continue;end if;
   while active_end<layer_count loop
    exit when layer_dates[active_end+1]>sale.business_date;
    active_end:=active_end+1;
    batch_index:=layer_batches[active_end];
    available:=available+remaining_qty[active_end];
    batch_qty[batch_index]:=batch_qty[batch_index]+remaining_qty[active_end];
    if batch_heads[batch_index]=0 then batch_heads[batch_index]:=active_end;end if;
   end loop;
   -- First-year sales may lack older imported purchases and correctly remain unavailable.
   while expired_end<active_end loop
    exit when layer_dates[expired_end+1]>=(sale.business_date-interval '1 year')::date;
    expired_end:=expired_end+1;
    batch_index:=layer_batches[expired_end];
    available:=available-remaining_qty[expired_end];
    batch_qty[batch_index]:=batch_qty[batch_index]-remaining_qty[expired_end];
    remaining_qty[expired_end]:=0;
   end loop;
   if available<sale.quantity then continue;end if;
   selected_batch:=0;
   if sale.batch_id is not null and batch_qty[sale.batch_number]>=sale.quantity then
    selected_batch:=sale.batch_number;
   end if;
   needed:=sale.quantity;total:=0;
   while needed>0 loop
    if selected_batch>0 then
     layer_index:=batch_heads[selected_batch];
     while remaining_qty[layer_index]=0 loop layer_index:=next_in_batch[layer_index];end loop;
     batch_heads[selected_batch]:=layer_index;
    else
     while remaining_qty[fifo_head]=0 loop fifo_head:=fifo_head+1;end loop;
     layer_index:=fifo_head;
    end if;
    taken:=least(needed,remaining_qty[layer_index]);
    piece:=round(layer_net[layer_index]::numeric*(layer_qty[layer_index]-remaining_qty[layer_index]+taken)/layer_qty[layer_index])::bigint-taken_cost[layer_index];
    taken_cost[layer_index]:=taken_cost[layer_index]+piece;
    remaining_qty[layer_index]:=remaining_qty[layer_index]-taken;
    batch_index:=layer_batches[layer_index];
    batch_qty[batch_index]:=batch_qty[batch_index]-taken;
    available:=available-taken;needed:=needed-taken;total:=total+piece;
   end loop;
   output_costs[sale.ordinal]:=total;
  end loop;

  -- Acquisition-linked products are instrument billing and excluded from coverage's denominator.
  insert into private.stockflow_company_gp_lines
   (run_id,source_line_id,business_date,customer_source_id,product_id,kind,quantity,revenue_paise,cost_paise,gp_paise,status)
  select v_run,id,business_date,customer_source_id,product_id,kind,quantity,net_sales_paise,
   output_costs[ordinal],net_sales_paise-output_costs[ordinal],
   case when instrument_product then 'instrument_billing' when output_costs[ordinal] is null then 'cost_unavailable' else 'costed' end
  from pg_temp.company_gp_source where product_number=product.product_number and kind='sale';
 end loop;

 -- Keep stored return revenue, including its sign. Return quantity denotes the absolute units reversed.
 insert into private.stockflow_company_gp_lines
  (run_id,source_line_id,business_date,customer_source_id,product_id,kind,quantity,revenue_paise,cost_paise,gp_paise,status)
 select v_run,r.id,r.business_date,r.customer_source_id,r.product_id,r.kind,r.quantity,r.net_sales_paise,
  -round(s.cost_paise::numeric*abs(r.quantity)/s.quantity)::bigint,
  r.net_sales_paise+round(s.cost_paise::numeric*abs(r.quantity)/s.quantity)::bigint,
  case when s.cost_paise is null then 'cost_unavailable' else 'costed' end
 from pg_temp.company_gp_source r
 left join pg_temp.company_gp_source original on original.source_id=r.original_voucher_id
  and original.line_key=r.original_line_key and original.kind='sale'
  and coalesce(r.original_company_id,p_company)=p_company
 left join private.stockflow_company_gp_lines s on s.run_id=v_run and s.source_line_id=original.id and s.status='costed'
 where r.kind='return';

 select count(*)::integer into v_line_count from private.stockflow_company_gp_lines where run_id=v_run;
 update private.stockflow_company_gp_runs set status='complete',completed_at=clock_timestamp(),
  line_count=v_line_count,
  duration_ms=round(extract(epoch from clock_timestamp()-v_started)*1000)::integer where id=v_run;
 delete from private.stockflow_company_gp_runs where company_id=p_company and id not in
  (select id from private.stockflow_company_gp_runs where company_id=p_company and status='complete'
   order by completed_at desc,id desc limit 2);
 drop table pg_temp.company_gp_source,pg_temp.company_gp_vouchers;
 return v_run;
end$$;
revoke all on function private.stockflow_company_gp_refresh(text) from public,anon,authenticated;

create function private.stockflow_company_gp_summary(p_roles text[],p_company text,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,private,public,extensions as $$
declare latest private.stockflow_company_gp_runs%rowtype; result jsonb;
begin
 if not coalesce(p_roles&&array['administrator','management'],false) then
  raise exception 'Management access required' using errcode='42501';
 end if;
 select * into latest from private.stockflow_company_gp_runs
 where company_id=p_company and status='complete' order by completed_at desc,id desc limit 1;
 -- Date windows are half-open. Missing bounds include all dates.
 with recursive catalog as (
  select content from private.stockflow_economic_item_catalogs where company_id=p_company order by observed_at desc,id desc limit 1
 ), catalog_groups as (
  select g->>'id' as id,g->>'name' as name,nullif(g->>'parentId','') as parent_id
  from catalog,jsonb_array_elements(content->'groups') g
 ), roots as (
  select g.id,g.id as root_id,g.name as root_name,array[g.id] as path from catalog_groups g
  where g.parent_id is null or not exists(select 1 from catalog_groups parent where parent.id=g.parent_id)
  union all
  select g.id,r.root_id,r.root_name,r.path||g.id from catalog_groups g join roots r on g.parent_id=r.id where not g.id=any(r.path)
 ), products as (
  select p->>'id' as id,p->>'groupId' as group_id from catalog,jsonb_array_elements(content->'products') p
 ), lines as materialized (
  select * from private.stockflow_company_gp_lines where run_id=latest.id
   and (p_from is null or business_date>=p_from) and (p_to is null or business_date<p_to)
 ), coverage as (
  select coalesce(sum(revenue_paise),0) as revenue,
   coalesce(sum(revenue_paise) filter(where status='costed'),0) as costed_revenue,
   coalesce(sum(revenue_paise) filter(where status='instrument_billing'),0) as instrument_revenue
  from lines
 ), months as (
  select to_char(business_date,'YYYY-MM') as month,sum(revenue_paise) as revenue,
   coalesce(sum(revenue_paise) filter(where status='costed'),0) as costed_revenue,
   coalesce(sum(cost_paise) filter(where status='costed'),0) as cost,
   coalesce(sum(gp_paise) filter(where status='costed'),0) as gp from lines group by 1
 ), customers as (
  select customer_source_id,sum(revenue_paise) as revenue,
   coalesce(sum(revenue_paise) filter(where status='costed'),0) as costed_revenue,
   coalesce(sum(gp_paise) filter(where status='costed'),0) as gp from lines group by customer_source_id
  order by revenue desc,customer_source_id nulls last limit 50
 ), grouped_lines as (
  select l.*,r.root_id as group_id,
   case when p.id is null then '(not in catalog)' else coalesce(r.root_name,'(no group)') end as group_name
  from lines l left join products p on p.id=l.product_id left join roots r on r.id=p.group_id
 ), groups as (
  select group_id,group_name,sum(revenue_paise) as revenue,
   coalesce(sum(revenue_paise) filter(where status='costed'),0) as costed_revenue,
   coalesce(sum(gp_paise) filter(where status='costed'),0) as gp from grouped_lines group by group_id,group_name
 )
 select jsonb_build_object('runId',latest.id,'computedAt',latest.completed_at,'sourceWatermark',latest.source_watermark,'policyVersion',latest.policy_version,
  'coverage',jsonb_build_object('revenuePaise',revenue,'costedRevenuePaise',costed_revenue,
   'costedPct',coalesce(100.0*costed_revenue/nullif(revenue-instrument_revenue,0),0),'instrumentBillingRevenuePaise',instrument_revenue),
  'months',(select coalesce(jsonb_agg(jsonb_build_object('month',month,'revenuePaise',revenue,'costedRevenuePaise',costed_revenue,'costPaise',cost,'gpPaise',gp) order by month),'[]'::jsonb) from months),
  'customers',(select coalesce(jsonb_agg(jsonb_build_object('customerSourceId',customer_source_id,'revenuePaise',revenue,'costedRevenuePaise',costed_revenue,'gpPaise',gp) order by revenue desc,customer_source_id nulls last),'[]'::jsonb) from customers),
  'groups',(select coalesce(jsonb_agg(jsonb_build_object('groupId',group_id,'groupName',group_name,'revenuePaise',revenue,'costedRevenuePaise',costed_revenue,'gpPaise',gp) order by revenue desc,group_name,group_id),'[]'::jsonb) from groups))
 into result from coverage;
 return result;
end$$;
revoke all on function private.stockflow_company_gp_summary(text[],text,date,date) from public,anon,authenticated;

do $patch$
declare definition text; occurrences integer;
 anchor constant text:=$anchor$if p_action='get_instrument_economics' then$anchor$;
 addition constant text:=$addition$if p_action='get_company_gp' then return private.stockflow_company_gp_summary(roles,p_payload->>'companyId',(p_payload->>'from')::date,(p_payload->>'to')::date); end if;$addition$;
begin
 definition:=pg_get_functiondef('public.stockflow_economics_gateway(text,text,text,jsonb)'::regprocedure);
 occurrences:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
 if occurrences<>1 then raise exception 'Expected one company GP gateway anchor, found %',occurrences;end if;
 execute replace(definition,anchor,addition||chr(10)||anchor);
end $patch$;
revoke all on function public.stockflow_economics_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_economics_gateway(text,text,text,jsonb) to service_role;

do $cron$
declare job record;
begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  for job in select jobid from cron.job where jobname='stockflow-company-gp-refresh' loop
   perform cron.unschedule(job.jobid);
  end loop;
  perform cron.schedule('stockflow-company-gp-refresh','*/30 * * * *',
   $job$select private.stockflow_company_gp_refresh(c) from (select distinct company_id c from private.stockflow_economic_source_vouchers) s$job$);
 end if;
end $cron$;

commit;
