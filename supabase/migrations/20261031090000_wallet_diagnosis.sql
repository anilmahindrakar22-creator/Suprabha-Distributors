begin;

create table private.stockflow_commercial_opportunities (
 id uuid primary key default extensions.gen_random_uuid(),
 customer_id uuid not null references private.stockflow_customers(id),
 kind text not null check(kind in ('capture','defend','recover')),
 opened_reason text not null check(length(btrim(opened_reason)) between 3 and 500),
 opened_by text not null, opened_at timestamptz not null default clock_timestamp()
);
create index stockflow_commercial_opportunity_customer on private.stockflow_commercial_opportunities(customer_id,opened_at desc,id desc);
create table private.stockflow_commercial_opportunity_closures (
 opportunity_id uuid primary key references private.stockflow_commercial_opportunities(id),
 outcome text not null check(outcome in ('won','lost','dropped')),
 reason text not null check(length(btrim(reason)) between 3 and 500),
 closed_by text not null, closed_at timestamptz not null default clock_timestamp()
);
create table private.stockflow_commercial_constraints (
 id uuid primary key default extensions.gen_random_uuid(),
 opportunity_id uuid not null references private.stockflow_commercial_opportunities(id),
 category text not null check(category in ('price','portfolio','instrument','service','relationship','credit','availability','clinical','contract_tender','competitor_lock_in','unknown')),
 evidence text not null check(length(btrim(evidence)) between 3 and 1000),
 source text not null check(source in ('document','customer_stated','our_view')),
 source_person text check(source_person is null or length(btrim(source_person)) between 2 and 120),
 observed_on date not null check(observed_on<=(now() at time zone 'Asia/Kolkata')::date and observed_on>=((now() at time zone 'Asia/Kolkata')::date-interval '2 years')::date),
 facts jsonb not null check(jsonb_typeof(facts)='object'),
 confidence text not null check(confidence in ('high','medium','low')),
 recorded_by text not null, recorded_at timestamptz not null default clock_timestamp()
);
alter table private.stockflow_commercial_constraints add constraint stockflow_commercial_constraints_source_person_rule
 check ((source='customer_stated' and source_person is not null) or (source<>'customer_stated' and source_person is null));
create index stockflow_commercial_constraints_current on private.stockflow_commercial_constraints(opportunity_id,recorded_at desc,id desc);

create function private.stockflow_constraint_facts_valid(p_category text,p_facts jsonb,p_today date) returns boolean
language plpgsql stable set search_path=pg_catalog,private as $$
declare expected text[]; key_name text; value_text text; amount numeric; date_value date; division_code text;
begin
 if p_facts is null or jsonb_typeof(p_facts)<>'object' or p_today is null then return false;end if;
 expected:=case p_category
  when 'price' then array['competitor','product','competitorPricePaise','ourPricePaise']
  when 'portfolio' then array['product','division']
  when 'instrument' then array['analyser','owner','closedSystem','division']
  when 'service' then array['issue','since']
  when 'availability' then array['product','issue']
  when 'credit' then array['issue']
  when 'relationship' then array['decisionMaker','issue']
  when 'clinical' then array['issue']
  when 'contract_tender' then array['holder','endsOn']
  when 'competitor_lock_in' then array['competitor','endsOn']
  when 'unknown' then array['nextQuestion','askBy']
  else null end;
 if expected is null or (select count(*) from jsonb_object_keys(p_facts))<>cardinality(expected)
  or exists(select 1 from jsonb_object_keys(p_facts) as actual(key_name) where not actual.key_name=any(expected)) then return false;end if;
 foreach key_name in array expected loop
  if key_name in ('competitor','product','analyser','issue','decisionMaker','holder','nextQuestion') then
   if jsonb_typeof(p_facts->key_name)<>'string' then return false;end if;
   value_text:=btrim(p_facts->>key_name);if length(value_text) not between 2 and 200 then return false;end if;
  elsif key_name in ('competitorPricePaise','ourPricePaise') then
   if jsonb_typeof(p_facts->key_name)<>'number' then return false;end if;
   amount:=(p_facts->>key_name)::numeric;if amount<>trunc(amount) or amount not between 1 and 90000000000000 then return false;end if;
  elsif key_name='division' then
   if jsonb_typeof(p_facts->key_name)<>'string' then return false;end if;
   if length(btrim(p_facts->>key_name)) not between 2 and 200 then return false;end if;
   division_code:=p_facts->>key_name;
   if not exists(select 1 from private.stockflow_wallet_divisions where code=division_code and active) then return false;end if;
  elsif key_name='owner' then
   if jsonb_typeof(p_facts->key_name)<>'string' or p_facts->>key_name not in ('customer','competitor_placed','rental','unknown') then return false;end if;
  elsif key_name='closedSystem' then
   if jsonb_typeof(p_facts->key_name)<>'string' or p_facts->>key_name not in ('yes','no','unknown') then return false;end if;
  elsif key_name in ('since','endsOn','askBy') then
   if jsonb_typeof(p_facts->key_name)<>'string' or (p_facts->>key_name) !~ '^\d{4}-\d{2}-\d{2}$' then return false;end if;
   begin date_value:=(p_facts->>key_name)::date;exception when others then return false;end;
   if to_char(date_value,'YYYY-MM-DD')<>p_facts->>key_name then return false;end if;
   if key_name='askBy' and date_value<p_today then return false;end if;
  end if;
 end loop;
 return true;
exception when others then return false;
end$$;

create function private.stockflow_constraint_json(p_constraint_id uuid) returns jsonb
language sql stable set search_path=pg_catalog,private as $$
 select jsonb_build_object('id',c.id,'category',c.category,'evidence',c.evidence,'confidence',c.confidence,
  'recordedBy',c.recorded_by,'recordedAt',c.recorded_at,'source',c.source,'sourcePerson',c.source_person,
  'observedOn',c.observed_on,'facts',c.facts,'priceUnproven',c.category='price' and c.source='our_view',
  'gapPermille',case when c.category='price' then round(((c.facts->>'ourPricePaise')::numeric-(c.facts->>'competitorPricePaise')::numeric)*1000/(c.facts->>'ourPricePaise')::numeric) end)
 from private.stockflow_commercial_constraints c where c.id=p_constraint_id;
$$;
do $$ declare table_name text;
begin
 foreach table_name in array array['stockflow_commercial_opportunities','stockflow_commercial_opportunity_closures','stockflow_commercial_constraints'] loop
  execute format('alter table private.%I enable row level security',table_name);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',table_name);
  execute format('create trigger %I before delete on private.%I for each row execute function private.prevent_business_delete()',table_name||'_no_delete',table_name);
  execute format('create trigger %I before update on private.%I for each row execute function private.prevent_immutable_pricing_update()',table_name||'_immutable',table_name);
 end loop;
end$$;

create function public.stockflow_opportunity_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare actor text:=lower(btrim(p_actor_email)); roles text[]; secret_hash text; command_key text; replay jsonb; result jsonb;
 customer uuid; opportunity uuid; entity uuid; current_constraint uuid; today date:=(now() at time zone 'Asia/Kolkata')::date;
 wallet_data jsonb; rows_data jsonb; focus_count bigint; undiagnosed_count bigint; row_item jsonb; item jsonb;
 fact_data jsonb; source_value text; source_person_value text; observed_date date; signals jsonb;
begin
 select secret_sha256 into secret_hash from private.stockflow_gateway_config where name='orders';
 if secret_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>secret_hash then raise exception 'Unauthorized gateway' using errcode='42501';end if;
 roles:=private.stockflow_active_member_roles(actor);
 if not coalesce(roles&&array['administrator','management'],false) then raise exception 'Wallet management access required' using errcode='PT403';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid wallet diagnosis request' using errcode='22023';end if;
 if p_action='get_wallet_diagnoses' then
  if jsonb_typeof(p_payload->'customerIds') is distinct from 'array' or jsonb_array_length(p_payload->'customerIds')>50
   or exists(select 1 from jsonb_array_elements_text(p_payload->'customerIds') as ids(value) where ids.value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
   or (select count(*) from jsonb_array_elements_text(p_payload->'customerIds'))<>(select count(distinct value) from jsonb_array_elements_text(p_payload->'customerIds'))
   then raise exception 'Invalid wallet diagnosis request' using errcode='22023';end if;
  select coalesce(jsonb_agg(jsonb_build_object('customerId',customer_id,'kind',kind,'category',category,'confidence',confidence,'priceUnproven',coalesce(price_unproven,false)) order by opened_at desc), '[]'::jsonb)
   into rows_data from (
    select distinct on(o.customer_id) o.customer_id,o.kind,c.category,c.confidence,c.price_unproven,o.opened_at
    from private.stockflow_commercial_opportunities o left join private.stockflow_commercial_opportunity_closures cl on cl.opportunity_id=o.id
    left join lateral (select category,confidence,(category='price' and source='our_view') price_unproven from private.stockflow_commercial_constraints where opportunity_id=o.id order by recorded_at desc,id desc limit 1) c on true
    where cl.opportunity_id is null and o.customer_id in (select value::uuid from jsonb_array_elements_text(p_payload->'customerIds'))
    order by o.customer_id,(c.category is not null and c.category<>'unknown') desc,o.opened_at desc,o.id desc
   ) latest;
  wallet_data:=private.stockflow_wallet_read(today);
  if wallet_data#>>'{coverage,certified}'='true' then
   select count(*) filter(where (value->>'inFocusBand')::boolean),count(*) filter(where (value->>'inFocusBand')::boolean and not exists(
    select 1 from private.stockflow_commercial_opportunities o left join private.stockflow_commercial_opportunity_closures cl on cl.opportunity_id=o.id
    left join lateral(select category from private.stockflow_commercial_constraints where opportunity_id=o.id order by recorded_at desc,id desc limit 1) cc on true
    where o.customer_id=(value->>'customerId')::uuid and cl.opportunity_id is null and cc.category is not null and cc.category<>'unknown'))
   into focus_count,undiagnosed_count from jsonb_array_elements(wallet_data->'rows');
  end if;
  return jsonb_build_object('rows',rows_data,'focusCount',case when wallet_data#>>'{coverage,certified}'='true' then focus_count end,
   'undiagnosedFocusCount',case when wallet_data#>>'{coverage,certified}'='true' then undiagnosed_count end);
 elsif p_action='get_account_opportunities' then
  customer:=(p_payload->>'customerId')::uuid;
  if not exists(select 1 from private.stockflow_customers where id=customer) then raise exception 'Customer not found' using errcode='22023';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'customerId',o.customer_id,'kind',o.kind,'openedReason',o.opened_reason,'openedBy',o.opened_by,'openedAt',o.opened_at,
   'closure',case when cl.opportunity_id is null then null else jsonb_build_object('outcome',cl.outcome,'reason',cl.reason,'closedBy',cl.closed_by,'closedAt',cl.closed_at) end,
   'constraint',cur.item,'history',hist.items) order by (cl.opportunity_id is null) desc,o.opened_at desc,o.id desc),'[]'::jsonb)
  into result from private.stockflow_commercial_opportunities o left join private.stockflow_commercial_opportunity_closures cl on cl.opportunity_id=o.id
  left join lateral(select private.stockflow_constraint_json(c.id) item
   from private.stockflow_commercial_constraints c where c.opportunity_id=o.id order by c.recorded_at desc,c.id desc limit 1) cur on true
  left join lateral(select coalesce(jsonb_agg(private.stockflow_constraint_json(c.id) order by c.recorded_at desc,c.id desc),'[]'::jsonb) items
   from private.stockflow_commercial_constraints c where c.opportunity_id=o.id) hist on true where o.customer_id=customer;
  return result;
 elsif p_action='get_account_signals' then
  if coalesce(p_payload->>'customerId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid customer id' using errcode='22023';end if;
  customer:=(p_payload->>'customerId')::uuid;
  if not exists(select 1 from private.stockflow_customers where id=customer) then raise exception 'Customer not found' using errcode='22023';end if;
  select jsonb_build_object(
   'priceExceptions90d',(select count(*) from private.stockflow_price_exceptions pe join private.stockflow_orders ord on ord.id=pe.order_id where ord.customer_id=customer and pe.requested_at>=((today-90)::timestamp at time zone 'Asia/Kolkata') and pe.requested_at<((today+1)::timestamp at time zone 'Asia/Kolkata')),
   'deliveryProblems90d',(select count(*) from private.stockflow_delivery_exceptions de join private.stockflow_orders ord on ord.id=de.order_id where ord.customer_id=customer and de.created_at>=((today-90)::timestamp at time zone 'Asia/Kolkata') and de.created_at<((today+1)::timestamp at time zone 'Asia/Kolkata')),
   'deliveryProblemsOpen',(select count(*) from private.stockflow_delivery_exceptions de join private.stockflow_orders ord on ord.id=de.order_id where ord.customer_id=customer and de.status='open'),
   'serviceTicketsOpen',(select count(*) from private.stockflow_service_tickets st join private.stockflow_orders ord on ord.id=st.order_id where ord.customer_id=customer and st.status='open'),
   'serviceTickets90d',(select count(*) from private.stockflow_service_tickets st join private.stockflow_orders ord on ord.id=st.order_id where ord.customer_id=customer and st.created_at>=((today-90)::timestamp at time zone 'Asia/Kolkata') and st.created_at<((today+1)::timestamp at time zone 'Asia/Kolkata')),
   'ourInstallations',(select count(*) from private.stockflow_equipment_installations ei join private.stockflow_orders ord on ord.id=ei.order_id where ord.customer_id=customer),
   'lastVisitOn',(select max(visited_on) from private.stockflow_customer_visits where customer_id=customer)) into signals;
  return signals;
 end if;
 if p_action is null or p_action not in ('open_opportunity','record_constraint','close_opportunity') then raise exception 'Unsupported wallet diagnosis action' using errcode='22023';end if;
 command_key:=p_payload->>'requestId';
 replay:=private.begin_stockflow_command(actor,p_action,command_key,p_payload);if replay is not null then return replay;end if;
 if p_action='open_opportunity' then
  customer:=(p_payload->>'customerId')::uuid;
  perform pg_advisory_xact_lock(hashtextextended('opportunity:'||customer||':'||coalesce(p_payload->>'kind',''),0));
  if coalesce(p_payload->>'kind','') not in ('capture','defend','recover') or length(btrim(coalesce(p_payload->>'reason',''))) not between 3 and 500 then raise exception 'Invalid opportunity' using errcode='22023';end if;
  if exists(select 1 from private.stockflow_commercial_opportunities o left join private.stockflow_commercial_opportunity_closures cl on cl.opportunity_id=o.id where o.customer_id=customer and o.kind=p_payload->>'kind' and cl.opportunity_id is null) then raise exception 'Open opportunity already exists' using errcode='PT409';end if;
  if not exists(select 1 from private.stockflow_customers where id=customer) then raise exception 'Customer not found' using errcode='22023';end if;
  insert into private.stockflow_commercial_opportunities(customer_id,kind,opened_reason,opened_by) values(customer,p_payload->>'kind',btrim(p_payload->>'reason'),actor)
   returning id into entity;
  result:=jsonb_build_object('id',entity,'customerId',customer,'kind',p_payload->>'kind','openedReason',btrim(p_payload->>'reason'),'openedBy',actor,'openedAt',clock_timestamp(),'closure',null,'constraint',null,'history','[]'::jsonb);
 elsif p_action='record_constraint' then
  opportunity:=(p_payload->>'opportunityId')::uuid;
  perform pg_advisory_xact_lock(hashtextextended('opportunity-constraint:'||opportunity,0));
  select c.id into current_constraint from private.stockflow_commercial_constraints c where c.opportunity_id=opportunity order by c.recorded_at desc,c.id desc limit 1;
  if not exists(select 1 from private.stockflow_commercial_opportunities o left join private.stockflow_commercial_opportunity_closures cl on cl.opportunity_id=o.id where o.id=opportunity and cl.opportunity_id is null) then raise exception 'Open opportunity not found' using errcode='22023';end if;
  if current_constraint is distinct from nullif(p_payload->>'expectedCurrentConstraintId','')::uuid then raise exception 'Constraint changed; refresh before retrying' using errcode='PT409';end if;
  if p_payload ? 'confidence' then raise exception 'Confidence is derived from source' using errcode='22023';end if;
  fact_data:=p_payload->'facts';source_value:=p_payload->>'source';source_person_value:=p_payload->>'sourcePerson';
  if coalesce(p_payload->>'category','') not in ('price','portfolio','instrument','service','relationship','credit','availability','clinical','contract_tender','competitor_lock_in','unknown')
   or length(btrim(coalesce(p_payload->>'evidence',''))) not between 3 and 1000
   or source_value not in ('document','customer_stated','our_view')
   or (source_value='customer_stated' and length(btrim(coalesce(source_person_value,''))) not between 2 and 120)
   or (source_value<>'customer_stated' and source_person_value is not null)
   or jsonb_typeof(p_payload->'observedOn') is distinct from 'string' or coalesce(p_payload->>'observedOn','') !~ '^\d{4}-\d{2}-\d{2}$'
   or jsonb_typeof(fact_data) is distinct from 'object' then raise exception 'Invalid constraint' using errcode='22023';end if;
  begin observed_date:=(p_payload->>'observedOn')::date;exception when others then raise exception 'Invalid constraint date' using errcode='22023';end;
  if to_char(observed_date,'YYYY-MM-DD')<>p_payload->>'observedOn' or observed_date>today or observed_date<(today-interval '2 years')::date
   or not private.stockflow_constraint_facts_valid(p_payload->>'category',fact_data,today) then raise exception 'Invalid constraint facts or date' using errcode='22023';end if;
  insert into private.stockflow_commercial_constraints(opportunity_id,category,evidence,source,source_person,observed_on,facts,confidence,recorded_by)
  values(opportunity,p_payload->>'category',btrim(p_payload->>'evidence'),source_value,source_person_value,observed_date,fact_data,
   case source_value when 'document' then 'high' when 'customer_stated' then 'medium' else 'low' end,actor) returning id into entity;
  result:=private.stockflow_constraint_json(entity)||jsonb_build_object('opportunityId',opportunity);
 else
  opportunity:=(p_payload->>'opportunityId')::uuid;
  if not exists(select 1 from private.stockflow_commercial_opportunities o where o.id=opportunity) then raise exception 'Opportunity not found' using errcode='22023';end if;
  if coalesce(p_payload->>'outcome','') not in ('won','lost','dropped') or length(btrim(coalesce(p_payload->>'reason',''))) not between 3 and 500 then raise exception 'Invalid closure' using errcode='22023';end if;
  begin
   insert into private.stockflow_commercial_opportunity_closures(opportunity_id,outcome,reason,closed_by) values(opportunity,p_payload->>'outcome',btrim(p_payload->>'reason'),actor);
  exception when unique_violation then raise exception 'Opportunity already closed' using errcode='PT409';end;
  entity:=opportunity;result:=jsonb_build_object('ok',true,'opportunityId',opportunity,'outcome',p_payload->>'outcome');
 end if;
 insert into private.stockflow_economic_audit(action,entity_id,actor,payload) values(p_action,entity,actor,p_payload);
 perform private.finish_stockflow_command(actor,p_action,command_key,p_payload,entity,result);
 return result;
end$$;

revoke all on function public.stockflow_opportunity_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.stockflow_constraint_facts_valid(text,jsonb,date),private.stockflow_constraint_json(uuid) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_opportunity_gateway(text,text,text,jsonb) to service_role;
commit;
