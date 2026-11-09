begin;

-- Fail closed if another migration has changed the approved origin list.
do $$
declare definition text;
begin
 select pg_get_constraintdef(oid) into definition from pg_constraint
 where conrelid='private.stockflow_commercial_opportunities'::regclass
 and conname='stockflow_commercial_opportunities_origin_rule';
 if definition is distinct from $expected$CHECK ((origin = ANY (ARRAY['manual'::text, 'wallet_gap'::text, 'defend_signal'::text])))$expected$ then
  raise exception 'Unexpected commercial opportunity origin constraint';
 end if;
end$$;
alter table private.stockflow_commercial_opportunities drop constraint stockflow_commercial_opportunities_origin_rule;
alter table private.stockflow_commercial_opportunities add constraint stockflow_commercial_opportunities_origin_rule
 check(origin in ('manual','wallet_gap','defend_signal','growth_rule'));

create table private.stockflow_growth_decisions (
 id uuid primary key default extensions.gen_random_uuid(),
 company_id text not null,
 customer_source_id text not null,
 rule_key text not null check(rule_key in ('R1','R2','R3','R4')),
 rule_version int not null,
 period date not null check(period=date_trunc('month',period)::date),
 decision text not null check(decision in ('accepted','snoozed','rejected','reopened')),
 category text check(category in ('price','portfolio','instrument','service','relationship','credit','availability','clinical','contract_tender','competitor_lock_in','unknown')),
 note text check(note is null or length(btrim(note)) between 1 and 500),
 snooze_until date,
 inputs jsonb not null,
 stake_paise bigint not null,
 customer_id uuid references private.stockflow_customers(id),
 opportunity_id uuid references private.stockflow_commercial_opportunities(id),
 action_id uuid references private.stockflow_commercial_actions(id),
 decided_by text not null,
 decided_at timestamptz not null default clock_timestamp(),
 check((decision='accepted' and action_id is not null and opportunity_id is not null and customer_id is not null)
  or (decision<>'accepted' and action_id is null and opportunity_id is null)),
 check((decision='snoozed')=(snooze_until is not null)),
 check(decision<>'rejected' or category is not null)
);
create index stockflow_growth_decisions_lab on private.stockflow_growth_decisions(company_id,customer_source_id,decided_at desc,id desc);
alter table private.stockflow_growth_decisions enable row level security;
revoke all on private.stockflow_growth_decisions from public,anon,authenticated,service_role;
create trigger stockflow_growth_decisions_no_delete before delete on private.stockflow_growth_decisions
 for each row execute function private.prevent_business_delete();
create trigger stockflow_growth_decisions_immutable before update on private.stockflow_growth_decisions
 for each row execute function private.prevent_immutable_pricing_update();

-- Sales-only source shared by rules, confirmation membership and closed outcomes.
create function private.stockflow_growth_inbox_sales()
returns table(id uuid,company_id text,customer_source_id text,business_date date,kind text,net numeric)
language sql stable security definer set search_path=pg_catalog,private as $$
 select v.id,v.company_id,v.customer_source_id,v.business_date,v.kind,sum(l.net_sales_paise::numeric)
 from private.stockflow_economic_source_vouchers v
 join private.stockflow_economic_source_lines l on l.voucher_id=v.id
 where not v.cancelled and v.kind in ('sale','return','credit')
 and not exists(select 1 from private.stockflow_economic_source_vouchers n
  where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
 group by v.id
$$;

create function private.stockflow_growth_inbox_model(p_today date)
returns table(company_id text,customer_source_id text,card_key text,lab_key text,customer_id uuid,
 name text,town text,rule_key text,rule_version int,period date,stake_paise bigint,inputs jsonb,
 also_matches jsonb,last_reason jsonb,state text,action jsonb,latest_decision text)
language sql stable security definer set search_path=pg_catalog,private,public,extensions as $$
 with bounds as (
  select (date_trunc('month',p_today)-interval '1 month')::date m,
   (date_trunc('month',p_today)-interval '12 months')::date s,
   (date_trunc('month',p_today)-interval '6 months')::date h,
   date_trunc('month',p_today)::date e
 ), sales as materialized (select * from private.stockflow_growth_inbox_sales()),
 history as (select date_trunc('month',min(business_date))::date first_month from sales),
 months as materialized (
  select company_id,customer_source_id,date_trunc('month',business_date)::date m,
   coalesce(sum(net) filter(where not (kind='sale' and net>=20000000)),0) repeat_net,
   max(business_date) filter(where net>0) last_positive
  from sales where customer_source_id is not null group by 1,2,3
 ), labs as (
  select l.company_id,l.customer_source_id,
   count(*) filter(where l.m>=b.s and l.m<b.m and repeat_net>0) prev11,
   count(*) filter(where l.m=b.m and repeat_net>0) run_bought,
   count(*) filter(where l.m>=b.s and l.m<b.h and repeat_net>0) h1_months,
   count(*) filter(where l.m>=b.h and l.m<b.e and repeat_net>0) h2_months,
   coalesce(sum(repeat_net) filter(where l.m>=b.s and l.m<b.h),0) h1,
   coalesce(sum(repeat_net) filter(where l.m>=b.h and l.m<b.e),0) h2,
   round(sum(repeat_net) filter(where l.m>=b.s and l.m<b.e and repeat_net>0)
    /nullif(count(*) filter(where l.m>=b.s and l.m<b.e and repeat_net>0),0))::bigint typical,
   count(*) filter(where repeat_net>0) history_months,
   min(l.m) filter(where repeat_net>0) first_month,
   max(repeat_net) filter(where repeat_net>0) first_paise,
   max(last_positive) filter(where l.m<b.e and repeat_net>0) last_bought
  from months l cross join bounds b group by l.company_id,l.customer_source_id
 ), matches as (
  select l.*,b.m,array_remove(array[
   case when prev11>=6 and run_bought=0 then 'R1' end,
   case when h1_months>=3 and h2_months=0 then 'R2' end,
   case when h1_months>=3 and h2_months>=1 and h1-h2>=2500000 and h2<=0.7*h1 then 'R3' end,
   case when history_months=1 and l.first_month between (b.m-interval '3 months')::date and (b.m-interval '1 month')::date
    and l.first_month>history.first_month then 'R4' end],null) rules
  from labs l cross join bounds b cross join history
 ), winners as (
  select *,rules[1] rule,
   case rules[1] when 'R3' then round((h1-h2)/6)::bigint when 'R4' then first_paise::bigint else typical end stake,
   case rules[1]
    when 'R1' then jsonb_build_object('monthsBoughtPrev11',prev11,'lastBoughtOn',last_bought,'typicalPaise',typical)
    when 'R2' then jsonb_build_object('monthsBoughtH1',h1_months,'lastBoughtOn',last_bought,'typicalPaise',typical)
    when 'R3' then jsonb_build_object('h1Paise',h1,'h2Paise',h2,'dropPct',round(100*(h1-h2)/nullif(h1,0),1))
    when 'R4' then jsonb_build_object('firstMonth',to_char(first_month,'YYYY-MM'),'firstPaise',first_paise) end snapshot
  from matches where cardinality(rules)>0
 )
 select w.company_id,w.customer_source_id,w.company_id||'|'||w.customer_source_id||'|'||w.rule||'|'||to_char(w.m,'YYYY-MM'),
  w.company_id||'|'||w.customer_source_id,c.id,
  coalesce(c.name,private.stockflow_growth_ledger_name(w.company_id,w.customer_source_id)),c.city,
  w.rule,1,w.m,w.stake,w.snapshot,to_jsonb(array_remove(w.rules,w.rule)),reason.item,
  case when d.decision='rejected' or snoozed.active or (d.decision='accepted' and closed.action_id is not null) then 'hidden'
   when a.id is not null then 'in_progress' else 'review' end,
  case when a.id is not null then jsonb_build_object('id',a.id,'actionType',a.action_type,'ownerEmail',a.owner_email,'dueOn',a.due_on) end,
  d.decision
 from winners w
 left join private.stockflow_economic_customer_identities i on i.company_id=w.company_id and i.source_id=w.customer_source_id
 left join private.stockflow_customers c on c.id=i.customer_id
 left join lateral (
  select x.* from private.stockflow_growth_decisions x
  where x.company_id=w.company_id and x.customer_source_id=w.customer_source_id and x.rule_key=w.rule and x.period=w.m
  order by x.decided_at desc,x.id desc limit 1
 ) d on true
 left join private.stockflow_commercial_action_results closed on closed.action_id=d.action_id
 left join lateral (
  select s.snooze_until>p_today and not exists(select 1 from private.stockflow_growth_decisions r
   where r.company_id=s.company_id and r.customer_source_id=s.customer_source_id and r.decision='reopened'
   and (r.decided_at,r.id)>(s.decided_at,s.id)) active
  from private.stockflow_growth_decisions s
  where s.company_id=w.company_id and s.customer_source_id=w.customer_source_id and s.decision='snoozed'
  order by s.decided_at desc,s.id desc limit 1
 ) snoozed on true
 left join lateral (
  select a.* from private.stockflow_commercial_actions a
  join private.stockflow_commercial_opportunities o on o.id=a.opportunity_id
  where o.customer_id=c.id and not exists(select 1 from private.stockflow_commercial_action_results r where r.action_id=a.id)
  order by a.due_on,a.id limit 1
 ) a on true
 left join lateral (
  select jsonb_build_object('category',r.category,'source',r.source,'on',(r.recorded_at at time zone 'Asia/Kolkata')::date) item
  from (
   select v.category,v.source,v.recorded_at,v.visit_id id from private.stockflow_visit_reasons v
   where v.customer_id=c.id and v.category<>'none'
   union all
   select x.category,x.source,x.recorded_at,x.id from private.stockflow_commercial_constraints x
   join private.stockflow_commercial_opportunities o on o.id=x.opportunity_id where o.customer_id=c.id
  ) r where (r.recorded_at at time zone 'Asia/Kolkata')::date between p_today-180 and p_today
  order by r.recorded_at desc,r.id desc limit 1
 ) reason on true
 where w.stake>=case when w.rule='R4' then 500000 else 200000 end
$$;

create function private.stockflow_growth_inbox_read(p_today date,p_payload jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,private,public,extensions as $$
declare filter_name text:=p_payload->>'filter'; page_number int; result jsonb;
 window_end date:=date_trunc('month',p_today)::date;
 window_start date:=(window_end-interval '12 months')::date;
 companies text[]; company text; status jsonb; month_index int;
 confirmed boolean:=true; reason text;
begin
 if p_today is null or jsonb_typeof(p_payload) is distinct from 'object' then
  raise exception 'Invalid growth inbox request' using errcode='22023';end if;
 if p_payload-array['filter','page']<>'{}'::jsonb
  or jsonb_typeof(p_payload->'filter') is distinct from 'string' or filter_name not in ('all','R1','R2','R3','R4','done')
  or jsonb_typeof(p_payload->'page') is distinct from 'number' or (p_payload->>'page') !~ '^[1-9][0-9]*$' then
  raise exception 'Invalid growth inbox request' using errcode='22023';end if;
 begin page_number:=(p_payload->>'page')::int;
 exception when numeric_value_out_of_range then raise exception 'Invalid page' using errcode='22023';end;

 -- Same company membership, coverage and twelve reconciliation checks as Growth.
 select coalesce(array_agg(distinct company_id order by company_id),'{}'::text[]) into companies
 from private.stockflow_growth_inbox_sales() where business_date>=window_start and business_date<window_end;
 if cardinality(companies)=0 then confirmed:=false;reason:='No sales in window';end if;
 foreach company in array companies loop
  status:=private.stockflow_sales_coverage_status(company,window_start,window_end-1);
  if (status->>'complete')::boolean is distinct from true then
   confirmed:=false;reason:=coalesce(reason,'Sales coverage incomplete: '||company);end if;
  for month_index in 0..11 loop
   status:=private.stockflow_sales_reconciliation(company,(window_start+month_index*interval '1 month')::date);
   if status->>'state' is distinct from 'matches' then
    confirmed:=false;reason:=coalesce(reason,'Sales reconciliation '||(status->>'state')||': '||company||' '||(status->>'month'));end if;
  end loop;
 end loop;

 with cards as materialized (select * from private.stockflow_growth_inbox_model(p_today)),
 done as materialized (
  select d.*,a.action_type,a.owner_email,r.result,r.note result_note,r.closed_at,
   (r.closed_at at time zone 'Asia/Kolkata')::date closed_on
  from private.stockflow_growth_decisions d
  join private.stockflow_commercial_actions a on a.id=d.action_id
  join private.stockflow_commercial_action_results r on r.action_id=a.id where d.decision='accepted'
 ), outcome_sales as materialized (
  select s.* from private.stockflow_growth_inbox_sales() s
  where filter_name='done' and s.kind='sale' and s.net>0
   and exists(select 1 from done d where d.company_id=s.company_id and d.customer_source_id=s.customer_source_id)
 ), selected as (
  select card_key,0 group_order,stake_paise,null::date due_on,null::timestamptz closed_at,
   jsonb_build_object('cardKey',card_key,'labKey',lab_key,'customerId',customer_id,'name',name,'town',town,
    'rule',rule_key,'ruleVersion',rule_version,'period',to_char(period,'YYYY-MM'),'stakePaise',stake_paise,
    'inputs',inputs,'alsoMatches',also_matches,'lastReason',last_reason,'state',state,'action',action) item
  from cards where state='review' and (filter_name='all' or rule_key=filter_name)
  union all
  select card_key,1,null,(action->>'dueOn')::date,null,
   jsonb_build_object('cardKey',card_key,'labKey',lab_key,'customerId',customer_id,'name',name,'town',town,
    'rule',rule_key,'ruleVersion',rule_version,'period',to_char(period,'YYYY-MM'),'stakePaise',stake_paise,
    'inputs',inputs,'alsoMatches',also_matches,'lastReason',last_reason,'state',state,'action',action)
  from cards where state='in_progress' and (filter_name='all' or rule_key=filter_name)
  union all
  select d.company_id||'|'||d.customer_source_id||'|'||d.rule_key||'|'||to_char(d.period,'YYYY-MM'),2,null,null,d.closed_at,
   jsonb_build_object('cardKey',d.company_id||'|'||d.customer_source_id||'|'||d.rule_key||'|'||to_char(d.period,'YYYY-MM'),
    'labKey',d.company_id||'|'||d.customer_source_id,'customerId',d.customer_id,
    'name',coalesce(c.name,private.stockflow_growth_ledger_name(d.company_id,d.customer_source_id)),'town',c.city,
    'rule',d.rule_key,'period',to_char(d.period,'YYYY-MM'),
    'action',jsonb_build_object('actionType',d.action_type,'ownerEmail',d.owner_email,'result',d.result,'note',d.result_note,'closedOn',d.closed_on),
    'outcome',jsonb_build_object('status',case when sale.id is not null then 'bought' when d.closed_on+30<=p_today then 'not_bought' else 'waiting' end,
     'on',sale.business_date,'valuePaise',sale.net::bigint,'daysLeft',case when sale.id is null and d.closed_on+30>p_today then d.closed_on+30-p_today end))
  from done d left join private.stockflow_customers c on c.id=d.customer_id
  left join lateral (
   select s.* from outcome_sales s
   where s.company_id=d.company_id and s.customer_source_id=d.customer_source_id
    and s.business_date>d.closed_on and s.business_date<=least(d.closed_on+30,p_today)
   order by s.business_date,s.id limit 1
  ) sale on true where filter_name='done'
 ), page as (
  select * from selected order by group_order,stake_paise desc,due_on,closed_at desc,card_key
  limit 10 offset (page_number::bigint-1)*10
 ) select jsonb_build_object('runMonth',to_char(window_end-interval '1 month','YYYY-MM'),'salesTo',window_end-1,
  'confirmed',confirmed,'confirmedReason',reason,
  'counts',jsonb_build_object('all',(select count(*) from cards where state<>'hidden'),
   'R1',(select count(*) from cards where state<>'hidden' and rule_key='R1'),
   'R2',(select count(*) from cards where state<>'hidden' and rule_key='R2'),
   'R3',(select count(*) from cards where state<>'hidden' and rule_key='R3'),
   'R4',(select count(*) from cards where state<>'hidden' and rule_key='R4'),
   'toReview',(select count(*) from cards where state='review'),'inProgress',(select count(*) from cards where state='in_progress'),
   'done',(select count(*) from done)),
  'stakeToReviewPaise',(select coalesce(sum(stake_paise),0) from cards where state='review'),
  'filter',filter_name,'page',page_number,'pageSize',10,'total',(select count(*) from selected),
  'owners',(select coalesce(jsonb_agg(jsonb_build_object('email',m.email) order by m.email),'[]')
   from public.stockflow_members m where m.status='active' and m.role in ('administrator','management','sales')),
  'rows',coalesce(jsonb_agg(item order by group_order,stake_paise desc,due_on,closed_at desc,card_key),'[]')) into result from page;
 return result;
end$$;

create function private.stockflow_decide_growth_card(p_today date,p_actor text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,private,public,extensions as $$
declare decision_name text:=p_payload->>'decision'; allowed text[]; required text[]; key_name text;
 parts text[]; replay jsonb; result jsonb; card record; owner_value text; due_value date; until_value date;
 opportunity uuid; action_entity uuid; entity uuid; kind_value text; suffix text;
begin
 if p_today is null or jsonb_typeof(p_payload) is distinct from 'object'
  or jsonb_typeof(p_payload->'decision') is distinct from 'string' or decision_name not in ('accept','snooze','reject','undo') then
  raise exception 'Invalid growth decision' using errcode='22023';end if;
 required:=array['requestId','cardKey','decision']||case decision_name
  when 'accept' then array['actionType','ownerEmail','dueOn','detail'] when 'snooze' then array['until']
  when 'reject' then array['category'] else '{}'::text[] end;
 allowed:=required||case when decision_name in ('snooze','reject') then array['category','note'] else '{}'::text[] end;
 if not p_payload ?& required or p_payload-allowed<>'{}'::jsonb then
  raise exception 'Invalid growth decision fields' using errcode='22023';end if;
 for key_name in select jsonb_object_keys(p_payload) loop
  if jsonb_typeof(p_payload->key_name) is distinct from 'string' then
   raise exception 'Invalid growth decision field' using errcode='22023';end if;
 end loop;
 if p_payload ? 'category' and p_payload->>'category' not in ('price','portfolio','instrument','service','relationship','credit','availability','clinical','contract_tender','competitor_lock_in','unknown')
  or p_payload ? 'note' and length(btrim(p_payload->>'note')) not between 1 and 500
  or decision_name='snooze' and p_payload->>'until' not in ('2w','1m','next_run')
  or decision_name='accept' and (p_payload->>'actionType' not in ('visit','demo','add_product','fix_service','fix_supply','no_action')
   or length(btrim(p_payload->>'detail')) not between 3 and 500 or p_payload->>'dueOn' !~ '^\d{4}-\d{2}-\d{2}$') then
  raise exception 'Invalid growth decision values' using errcode='22023';end if;

 -- Receipts precede all time-sensitive validation and recomputation.
 replay:=private.begin_stockflow_command(p_actor,'decide_growth_card',p_payload->>'requestId',p_payload);
 if replay is not null then return replay;end if;
 parts:=regexp_match(p_payload->>'cardKey','^(.+)\|([^|]+)\|(R[1-4])\|([0-9]{4}-[0-9]{2})$');
 if parts is null then raise exception 'Card is no longer current' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('growth-card:'||parts[1]||'|'||parts[2],0));
 select * into card from private.stockflow_growth_inbox_model(p_today) m where m.card_key=p_payload->>'cardKey';
 if not found then raise exception 'Card is no longer current' using errcode='22023';end if;
 if decision_name='undo' then
  if card.latest_decision is null or card.latest_decision not in ('snoozed','rejected') then
   raise exception 'Card cannot be reopened' using errcode='22023';end if;
 elsif card.state<>'review' then
  raise exception '%',case when card.state='in_progress' then 'Already in progress' else 'Card already decided' end using errcode='PT409';
 end if;

 if decision_name='accept' then
  if card.customer_id is null then raise exception 'Link the ledger first' using errcode='22023';end if;
  owner_value:=lower(btrim(p_payload->>'ownerEmail'));
  if not exists(select 1 from public.stockflow_members m where m.email=owner_value and m.status='active') then
   raise exception 'Action owner must be active' using errcode='22023';end if;
  begin due_value:=(p_payload->>'dueOn')::date;
  exception when others then raise exception 'Invalid due date' using errcode='22023';end;
  if to_char(due_value,'YYYY-MM-DD')<>p_payload->>'dueOn' or due_value<p_today or due_value>p_today+180 then
   raise exception 'Invalid due date' using errcode='22023';end if;
  kind_value:=case when card.rule_key='R4' then 'capture' else 'recover' end;
  -- Serialize inbox accepts for linked aliases, including different winning kinds.
  perform pg_advisory_xact_lock(hashtextextended('growth-customer:'||card.customer_id,0));
  perform pg_advisory_xact_lock(hashtextextended('opportunity:'||card.customer_id||':'||kind_value||':all',0));
  if not exists(select 1 from private.stockflow_customers where id=card.customer_id) then
   raise exception 'Customer not found' using errcode='22023';end if;
  if exists(select 1 from private.stockflow_commercial_actions a
   join private.stockflow_commercial_opportunities o on o.id=a.opportunity_id where o.customer_id=card.customer_id
   and not exists(select 1 from private.stockflow_commercial_action_results r where r.action_id=a.id)) then
   raise exception 'Already in progress' using errcode='PT409';end if;
  select o.id into opportunity from private.stockflow_commercial_opportunities o
  where o.customer_id=card.customer_id and o.kind=kind_value and o.division_id is null
   and not exists(select 1 from private.stockflow_commercial_opportunity_closures c where c.opportunity_id=o.id)
  order by o.opened_at,o.id limit 1;
  if opportunity is null then
   suffix:=' [rule='||card.rule_key||' v1 period='||to_char(card.period,'YYYY-MM')||']';
   insert into private.stockflow_commercial_opportunities(customer_id,division_id,origin,kind,opened_reason,opened_by)
   values(card.customer_id,null,'growth_rule',kind_value,left(btrim(p_payload->>'detail'),500-length(suffix))||suffix,p_actor)
   returning id into opportunity;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('opportunity-action:'||opportunity,0));
  if exists(select 1 from private.stockflow_commercial_opportunity_closures c where c.opportunity_id=opportunity) then
   raise exception 'Open opportunity not found' using errcode='PT409';end if;
  if exists(select 1 from private.stockflow_commercial_actions a
   join private.stockflow_commercial_opportunities o on o.id=a.opportunity_id where o.customer_id=card.customer_id
   and not exists(select 1 from private.stockflow_commercial_action_results r where r.action_id=a.id)) then
   raise exception 'Already in progress' using errcode='PT409';end if;
  insert into private.stockflow_commercial_actions(opportunity_id,action_type,detail,owner_email,due_on,expected_monthly_gain_paise,created_by)
  values(opportunity,p_payload->>'actionType',btrim(p_payload->>'detail'),owner_value,due_value,
   case when card.rule_key<>'R4' then card.stake_paise end,p_actor) returning id into action_entity;
 elsif decision_name='snooze' then
  until_value:=case p_payload->>'until' when '2w' then p_today+14 when '1m' then p_today+30
   else (date_trunc('month',p_today)+interval '2 months')::date end;
 end if;
 insert into private.stockflow_growth_decisions(company_id,customer_source_id,rule_key,rule_version,period,decision,
  category,note,snooze_until,inputs,stake_paise,customer_id,opportunity_id,action_id,decided_by)
 values(card.company_id,card.customer_source_id,card.rule_key,card.rule_version,card.period,
  case decision_name when 'accept' then 'accepted' when 'snooze' then 'snoozed' when 'reject' then 'rejected' else 'reopened' end,
  p_payload->>'category',btrim(p_payload->>'note'),until_value,card.inputs,card.stake_paise,card.customer_id,opportunity,action_entity,p_actor)
 returning id,snooze_until into entity,until_value;
 result:=jsonb_build_object('cardKey',card.card_key,'decision',decision_name,'state',
  (select m.state from private.stockflow_growth_inbox_model(p_today) m where m.card_key=card.card_key));
 if decision_name='accept' then result:=result||jsonb_build_object('opportunityId',opportunity,'actionId',action_entity);end if;
 if decision_name='snooze' then result:=result||jsonb_build_object('snoozeUntil',until_value);end if;
 insert into private.stockflow_economic_audit(action,entity_id,actor,payload) values('decide_growth_card',entity,p_actor,p_payload);
 perform private.finish_stockflow_command(p_actor,'decide_growth_card',p_payload->>'requestId',p_payload,entity,result);
 return result;
end$$;

do $patch$
declare f text; anchor text:='if p_action is distinct from ''get_growth'' or p_payload is distinct from ''{}''::jsonb then';
begin
 select replace(pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'') into f;
 if (length(f)-length(replace(f,anchor,'')))/length(anchor)<>1 then raise exception 'Unexpected Growth gateway seam';end if;
 execute replace(f,anchor,$new$if p_action='get_growth_inbox' then
  return private.stockflow_growth_inbox_read((now() at time zone 'Asia/Kolkata')::date,p_payload);
 end if;
 if p_action='decide_growth_card' then
  return private.stockflow_decide_growth_card((now() at time zone 'Asia/Kolkata')::date,actor,p_payload);
 end if;
 if p_action is distinct from 'get_growth' or p_payload is distinct from '{}'::jsonb then$new$);
end$patch$;

revoke all on function private.stockflow_growth_inbox_sales(),private.stockflow_growth_inbox_model(date),
 private.stockflow_growth_inbox_read(date,jsonb),private.stockflow_decide_growth_card(date,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_growth_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_growth_gateway(text,text,text,jsonb) to service_role;

commit;
notify pgrst,'reload schema';
