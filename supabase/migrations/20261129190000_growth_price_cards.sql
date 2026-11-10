begin;

-- Fail closed against the installed decision vocabulary. Append-only triggers stay in force.
do $$
declare definition text; change record;
begin
 for change in select * from (values
  ('rule_key', $expected$CHECK ((rule_key = ANY (ARRAY['R1'::text, 'R2'::text, 'R3'::text, 'R4'::text])))$expected$,
   $new$check(rule_key in ('R1','R2','R3','R4','R5'))$new$),
  ('decision', $expected$CHECK ((decision = ANY (ARRAY['accepted'::text, 'snoozed'::text, 'rejected'::text, 'reopened'::text])))$expected$,
   $new$check(decision in ('accepted','snoozed','rejected','reopened','reviewed'))$new$),
  ('category', $expected$CHECK ((category = ANY (ARRAY['price'::text, 'portfolio'::text, 'instrument'::text, 'service'::text, 'relationship'::text, 'credit'::text, 'availability'::text, 'clinical'::text, 'contract_tender'::text, 'competitor_lock_in'::text, 'unknown'::text])))$expected$,
   $new$check(category in ('price','portfolio','instrument','service','relationship','credit','availability','clinical','contract_tender','competitor_lock_in','unknown','agreed_volume_rate'))$new$)
 ) changes(column_name,expected,replacement) loop
  select pg_get_constraintdef(oid) into definition from pg_constraint
  where conrelid='private.stockflow_growth_decisions'::regclass
   and conname='stockflow_growth_decisions_'||change.column_name||'_check';
  if definition is distinct from change.expected then
   raise exception 'Unexpected growth decision % constraint',change.column_name;end if;
  execute format('alter table private.stockflow_growth_decisions drop constraint %I',
   'stockflow_growth_decisions_'||change.column_name||'_check');
  execute format('alter table private.stockflow_growth_decisions add constraint %I %s',
   'stockflow_growth_decisions_'||change.column_name||'_check',change.replacement);
 end loop;
end$$;

create function private.stockflow_growth_price_cards(p_today date)
returns table(company_id text,customer_source_id text,lab_key text,customer_id uuid,name text,town text,
 stake_paise bigint,inputs jsonb,underpaid_lines jsonb)
language sql stable security definer set search_path=pg_catalog,private,public,extensions as $$
 with model as materialized (select private.stockflow_growth_margin_model(p_today) data),
 pairs as materialized (
  select p."labKey" lab_key,p."itemKey" item_key,p."unitPricePaise" price,
   p."typicalPricePaise" typical,p.quantity
  from model cross join lateral jsonb_to_recordset(data->'pairs')
   as p("labKey" text,"itemKey" text,"unitPricePaise" numeric,"typicalPricePaise" numeric,quantity numeric,"belowTypical" boolean)
  where p."belowTypical"
 ), items as materialized (
  select i."itemKey" item_key,i.name,i."tallyItemKey" tally_item_key
  from model cross join lateral jsonb_to_recordset(data->'items') as i("itemKey" text,name text,"tallyItemKey" text)
 ), lab_rows as materialized (
  select l."labKey" lab_key,l."customerId" customer_id,l.name,l.town
  from model cross join lateral jsonb_to_recordset(data->'labs') as l("labKey" text,"customerId" uuid,name text,town text)
 ),
 underpaid as materialized (
  select l.lab_key,l.customer_id,l.name,l.town,p.item_key,i.name item_name,i.tally_item_key,
   p.price,p.typical,p.quantity,round((p.typical-p.price)*p.quantity) gap
  from pairs p join items i on i.item_key=p.item_key join lab_rows l on l.lab_key=p.lab_key
  where l.customer_id is null or i.tally_item_key is null or not exists(
    select 1 from private.stockflow_customer_product_prices approved
    where approved.customer_id=l.customer_id and approved.tally_item_key=i.tally_item_key
     and approved.status='approved' and approved.valid_from<=p_today
     and (approved.valid_to is null or approved.valid_to>=p_today))
 ), ranked as (
  select *,row_number() over(partition by lab_key order by gap desc,item_key) ordinal,
   jsonb_build_object('itemKey',item_key,'name',item_name,'tallyItemKey',tally_item_key,
    'unitPricePaise',round(price),'typicalPricePaise',round(typical),'quantity',quantity,'gapPaise',gap) line
  from underpaid
 ), labs as (
  select lab_key,customer_id,name,town,sum(gap) annual_gap,count(*) items,
   jsonb_agg(line order by gap desc,item_key) filter(where ordinal<=50) lines,
   -- Carry-over checks the full set, even when the displayed snapshot is capped.
   -- More than 50 underpaid items always return next period because the stored lines are capped at 50.
   jsonb_agg(jsonb_build_object('itemKey',item_key,'unitPricePaise',round(price)) order by item_key) all_lines
  from ranked group by lab_key,customer_id,name,town having sum(gap)>=500000
 ), identified as materialized (
  select *,regexp_match(lab_key,'^(.+)\|([^|]+)$') parts from labs
 ), sales as materialized (
  select company_id,customer_source_id,max(business_date) last_bought
  from private.stockflow_growth_inbox_sales()
  where kind='sale' and net>0 and business_date<date_trunc('month',p_today)
  group by company_id,customer_source_id
 )
 select parts[1],parts[2],lab_key,customer_id,name,town,round(annual_gap/12)::bigint,
  jsonb_build_object('items',items,'annualGapPaise',annual_gap,'lastBoughtOn',s.last_bought,'lines',lines),all_lines
 from identified l left join sales s on s.company_id=l.parts[1] and s.customer_source_id=l.parts[2]
$$;

-- Each installed-function seam must occur exactly once. R5 is a separate UNION stream.
do $patch$
declare f text; anchor text; replacement text; change record;
begin
 select replace(pg_get_functiondef('private.stockflow_growth_inbox_model(date)'::regprocedure),chr(13),'') into f;
 for change in select * from (values
  ($old$and r.decision='reopened'
   and (r.decided_at,r.id)>$old$,
   $new$and r.decision='reopened' and r.rule_key<>'R5'
   and (r.decided_at,r.id)>$new$),
  ($old$and s.decision='snoozed'
  order by s.decided_at$old$,
   $new$and s.decision='snoozed' and s.rule_key<>'R5'
  order by s.decided_at$new$),
  ($old$where w.stake>=case when w.rule='R4' then 500000 else 200000 end$old$,
   $new$where w.stake>=case when w.rule='R4' then 500000 else 200000 end
 union all
 select p.company_id,p.customer_source_id,p.lab_key||'|R5|'||to_char(b.m,'YYYY-MM'),
  p.lab_key,p.customer_id,p.name,p.town,'R5',1,b.m,p.stake_paise,p.inputs,'[]'::jsonb,null::jsonb,
  case when d.decision in ('rejected','reviewed') or snoozed.active
   or ((latest.decision='reviewed' or (latest.decision='rejected' and latest.category='agreed_volume_rate'))
    and not exists(
     select 1 from jsonb_array_elements(p.underpaid_lines) current_line
     where not exists(select 1 from jsonb_array_elements(latest.inputs->'lines') stored_line
      where stored_line->>'itemKey'=current_line->>'itemKey'
       and (current_line->>'unitPricePaise')::numeric>=0.99*(stored_line->>'unitPricePaise')::numeric)))
   then 'hidden' else 'review' end,null::jsonb,d.decision
 from private.stockflow_growth_price_cards(p_today) p cross join bounds b
 left join lateral (
  select x.decision from private.stockflow_growth_decisions x
  where x.company_id=p.company_id and x.customer_source_id=p.customer_source_id and x.rule_key='R5' and x.period=b.m
  order by x.decided_at desc,x.id desc limit 1
 ) d on true
 left join lateral (
  select x.decision,x.category,x.inputs from private.stockflow_growth_decisions x
  where x.company_id=p.company_id and x.customer_source_id=p.customer_source_id and x.rule_key='R5'
  order by x.decided_at desc,x.id desc limit 1
 ) latest on true
 left join lateral (
  select s.snooze_until>p_today and not exists(select 1 from private.stockflow_growth_decisions r
   where r.company_id=s.company_id and r.customer_source_id=s.customer_source_id and r.rule_key='R5'
    and r.decision='reopened' and (r.decided_at,r.id)>(s.decided_at,s.id)) active
  from private.stockflow_growth_decisions s
  where s.company_id=p.company_id and s.customer_source_id=p.customer_source_id and s.rule_key='R5' and s.decision='snoozed'
  order by s.decided_at desc,s.id desc limit 1
 ) snoozed on true$new$)
 ) changes(old_text,new_text) loop
  anchor:=change.old_text;replacement:=change.new_text;
  if (length(f)-length(replace(f,anchor,'')))/length(anchor)<>1 then
   raise exception 'Unexpected price-card model seam: %',anchor;end if;
  f:=replace(f,anchor,replacement);
 end loop;
 execute f;
end$patch$;

do $patch$
declare f text; change record;
begin
 select replace(pg_get_functiondef('private.stockflow_growth_inbox_read(date,jsonb)'::regprocedure),chr(13),'') into f;
 for change in select * from (values
  ($old$('all','R1','R2','R3','R4','done')$old$,$new$('all','R1','R2','R3','R4','R5','done')$new$),
  ($old$'R4',(select count(*) from cards where state<>'hidden' and rule_key='R4'),$old$,
   $new$'R4',(select count(*) from cards where state<>'hidden' and rule_key='R4'),
   'R5',(select count(*) from cards where state<>'hidden' and rule_key='R5'),$new$)
 ) changes(old_text,new_text) loop
  if (length(f)-length(replace(f,change.old_text,'')))/length(change.old_text)<>1 then
   raise exception 'Unexpected price-card read seam: %',change.old_text;end if;
  f:=replace(f,change.old_text,change.new_text);
 end loop;
 execute f;
end$patch$;

do $patch$
declare f text; change record;
begin
 select replace(pg_get_functiondef('private.stockflow_decide_growth_card(date,text,jsonb)'::regprocedure),chr(13),'') into f;
 for change in select * from (values
  ($old$('accept','snooze','reject','undo')$old$,$new$('accept','snooze','reject','undo','review')$new$),
  ($old$then array['category','note'] else '{}'::text[] end;$old$,
   $new$then array['category','note'] when decision_name='review' then array['note'] else '{}'::text[] end;$new$),
  ($old$'competitor_lock_in','unknown')$old$,$new$'competitor_lock_in','unknown','agreed_volume_rate')$new$),
  ($old$(R[1-4])$old$,$new$(R[1-5])$new$),
  ($old$if decision_name='undo' then$old$,
   $new$if decision_name='review' and card.rule_key<>'R5' then
  raise exception 'Review applies to price cards only' using errcode='22023';end if;
 if decision_name='accept' and card.rule_key='R5' then
  raise exception 'Price cards are reviewed, not accepted' using errcode='22023';end if;
 if p_payload->>'category'='agreed_volume_rate' and card.rule_key<>'R5' then
  raise exception 'Agreed volume rate applies to price cards only' using errcode='22023';end if;
 if decision_name='undo' then$new$),
  ($old$card.latest_decision not in ('snoozed','rejected')$old$,
   $new$card.latest_decision not in ('snoozed','rejected','reviewed')$new$),
  ($old$when 'reject' then 'rejected' else 'reopened' end,$old$,
   $new$when 'reject' then 'rejected' when 'review' then 'reviewed' else 'reopened' end,$new$)
 ) changes(old_text,new_text) loop
  if (length(f)-length(replace(f,change.old_text,'')))/length(change.old_text)<>1 then
   raise exception 'Unexpected price-card decision seam: %',change.old_text;end if;
  f:=replace(f,change.old_text,change.new_text);
 end loop;
 execute f;
end$patch$;

revoke all on function private.stockflow_growth_price_cards(date) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_growth_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_growth_gateway(text,text,text,jsonb) to service_role;
commit;
notify pgrst,'reload schema';
