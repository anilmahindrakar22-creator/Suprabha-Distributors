create extension if not exists btree_gist with schema extensions;

create table private.stockflow_pricing_policies (
  id uuid primary key default extensions.gen_random_uuid(),
  policy_version text not null unique check (char_length(btrim(policy_version)) between 1 and 80),
  minimum_margin_percent numeric(7,4) not null check (minimum_margin_percent >= -100 and minimum_margin_percent < 100),
  target_margin_percent numeric(7,4) check (target_margin_percent >= 0 and target_margin_percent < 100),
  override_approval_percent numeric(7,4) not null check (override_approval_percent >= 0 and override_approval_percent <= 100),
  rounding_increment numeric(14,2) not null check (rounding_increment > 0),
  rounding_rule_version text not null check (char_length(btrim(rounding_rule_version)) between 1 and 80),
  effective_from date not null,
  effective_to date,
  active boolean not null default true,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

-- Fail closed until management approves real commercial thresholds: this bootstrap
-- policy forces review, disables automatic suggestions, and approves no override.
insert into private.stockflow_pricing_policies(
  policy_version,minimum_margin_percent,target_margin_percent,override_approval_percent,
  rounding_increment,rounding_rule_version,effective_from,created_by_email
) values ('bootstrap-review-only-v1',99.99,null,0,1,'no-suggestion-v1','2026-04-01','system-migration');

alter table private.stockflow_pricing_policies add constraint stockflow_pricing_policy_no_overlap
  exclude using gist (daterange(effective_from,coalesce(effective_to,'infinity'::date),'[]') with &&)
  where (active);

create table private.stockflow_customer_product_prices (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid not null references private.stockflow_customers(id) on delete restrict,
  tally_item_key text not null check (char_length(btrim(tally_item_key)) between 1 and 240),
  price_amount numeric(18,2) not null check (price_amount > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  valid_from date not null,
  valid_to date,
  status text not null check (status in ('draft','pending_approval','approved','superseded','rejected','cancelled')),
  source_type text not null check (source_type in ('customer_contract','quotation','scheme','tender','manual_governed')),
  source_reference text,
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  approved_by_email text,
  approved_at timestamptz,
  version integer not null default 1 check (version > 0),
  supersedes_price_id uuid references private.stockflow_customer_product_prices(id) on delete restrict,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  check ((status = 'approved' and approved_by_email is not null and approved_at is not null)
    or (status <> 'approved'))
);

alter table private.stockflow_customer_product_prices add constraint stockflow_customer_price_no_approved_overlap
  exclude using gist (
    customer_id with =,
    tally_item_key with =,
    daterange(valid_from,coalesce(valid_to,'infinity'::date),'[]') with &&
  ) where (status = 'approved');

create index stockflow_customer_price_lookup_idx
  on private.stockflow_customer_product_prices(customer_id,tally_item_key,valid_from desc)
  where status='approved';

create table private.stockflow_tally_sales_prices (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid not null references private.stockflow_customers(id) on delete restrict,
  tally_item_key text not null check (char_length(btrim(tally_item_key)) between 1 and 240),
  invoice_rate numeric(18,2) not null check (invoice_rate >= 0),
  invoice_date date not null,
  invoice_reference text not null check (char_length(btrim(invoice_reference)) between 1 and 160),
  source_id text not null check (char_length(btrim(source_id)) between 1 and 240),
  source_version text not null check (char_length(btrim(source_version)) between 1 and 160),
  exceptional boolean not null default false,
  exception_type text check (exception_type in ('foc','scheme','tender','correction','unusual_discount','special_quotation')),
  imported_at timestamptz not null default now(),
  unique(source_id,source_version),
  check (not exceptional or exception_type is not null),
  check (invoice_rate > 0 or exceptional)
);

create index stockflow_tally_sales_price_lookup_idx
  on private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_date desc,imported_at desc)
  where not exceptional and invoice_rate > 0;

create table private.stockflow_tally_purchase_costs (
  id uuid primary key default extensions.gen_random_uuid(),
  tally_item_key text not null check (char_length(btrim(tally_item_key)) between 1 and 240),
  cost_amount numeric(18,2) not null check (cost_amount >= 0),
  cost_kind text not null check (cost_kind in ('purchase_price','landed_cost')),
  effective_at date not null,
  source_reference text not null check (char_length(btrim(source_reference)) between 1 and 160),
  source_id text not null check (char_length(btrim(source_id)) between 1 and 240),
  source_version text not null check (char_length(btrim(source_version)) between 1 and 160),
  imported_at timestamptz not null default now(),
  unique(source_id,source_version)
);

create index stockflow_tally_purchase_cost_lookup_idx
  on private.stockflow_tally_purchase_costs(tally_item_key,effective_at desc,imported_at desc);

create table private.stockflow_order_pricing_decisions (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references private.stockflow_orders(id) on delete restrict,
  order_line_id uuid not null references private.stockflow_order_lines(id) on delete restrict,
  decision_version integer not null check (decision_version > 0),
  order_version integer not null check (order_version > 0),
  state text not null check (state in ('pending_approval','approved','rejected','invalidated')),
  resolution_type text not null check (resolution_type in ('approved_contract_price','last_tally_invoice_price','price_review_required','price_exception')),
  proposed_rate numeric(18,2),
  approved_rate numeric(18,2),
  source_type text not null check (source_type in ('approved_contract','last_tally_invoice','manual_review')),
  source_reference text,
  source_date date,
  source_version text,
  contract_price_id uuid references private.stockflow_customer_product_prices(id) on delete restrict,
  cost_id uuid references private.stockflow_tally_purchase_costs(id) on delete restrict,
  cost_amount numeric(18,2),
  cost_source_version text,
  gross_profit_amount numeric(18,2),
  gross_margin_percent numeric(7,4),
  previous_gross_margin_percent numeric(7,4),
  margin_erosion_points numeric(7,4),
  guardrail_state text not null check (guardrail_state in ('price_ok','cost_increase','price_review_required')),
  suggestion_amount numeric(18,2),
  suggestion_unrounded numeric(18,6),
  pricing_policy_id uuid not null references private.stockflow_pricing_policies(id) on delete restrict,
  pricing_policy_version text not null,
  rounding_rule_version text not null,
  exception_reason text,
  requested_by_email text not null,
  requested_at timestamptz not null default now(),
  approved_by_email text,
  approved_at timestamptz,
  invalidated_at timestamptz,
  invalidation_reason text,
  request_id text not null check (char_length(request_id) >= 16),
  created_at timestamptz not null default now(),
  unique(order_line_id,decision_version),
  check ((state='approved' and approved_rate is not null and approved_by_email is not null and approved_at is not null)
    or state<>'approved')
);

create index stockflow_order_pricing_decision_idx
  on private.stockflow_order_pricing_decisions(order_id,decision_version desc,created_at desc);

create table private.stockflow_price_exceptions (
  id uuid primary key default extensions.gen_random_uuid(),
  decision_id uuid not null unique references private.stockflow_order_pricing_decisions(id) on delete restrict,
  order_id uuid not null references private.stockflow_orders(id) on delete restrict,
  order_line_id uuid not null references private.stockflow_order_lines(id) on delete restrict,
  reference_rate numeric(18,2),
  entered_rate numeric(18,2) not null check (entered_rate > 0),
  difference_amount numeric(18,2),
  difference_percent numeric(7,4),
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  state text not null check (state in ('pending','approved','rejected')),
  requested_by_email text not null,
  requested_at timestamptz not null default now(),
  decided_by_email text,
  decided_at timestamptz,
  decision_reason text,
  version integer not null default 1 check (version > 0),
  check ((state='pending' and decided_by_email is null and decided_at is null)
    or (state in ('approved','rejected') and decided_by_email is not null and decided_at is not null))
);

create table private.stockflow_pricing_events (
  id bigint generated always as identity primary key,
  entity_type text not null check (entity_type in ('customer_price','order_pricing','price_exception','billing_snapshot')),
  entity_id uuid not null,
  event_type text not null check (char_length(btrim(event_type)) between 3 and 120),
  actor_email text not null,
  actor_role text not null,
  request_id text not null check (char_length(request_id)>=16),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index stockflow_pricing_events_entity_idx on private.stockflow_pricing_events(entity_type,entity_id,created_at);

create table private.stockflow_billing_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references private.stockflow_orders(id) on delete restrict,
  snapshot_version integer not null check (snapshot_version > 0),
  order_version integer not null check (order_version > 0),
  pricing_payload jsonb not null,
  snapshot_hash text not null check (char_length(snapshot_hash)=64),
  created_by_email text not null,
  created_at timestamptz not null default now(),
  invalidated_at timestamptz,
  invalidation_reason text,
  unique(order_id,snapshot_version)
);

alter table private.stockflow_orders
  add column pricing_state text not null default 'review_required'
    check (pricing_state in ('review_required','approval_required','approved','invalidated')),
  add column pricing_snapshot_id uuid references private.stockflow_billing_snapshots(id) on delete restrict;

alter table private.stockflow_order_lines
  add column pricing_state text not null default 'review_required'
    check (pricing_state in ('review_required','approval_required','approved','invalidated')),
  add column approved_pricing_decision_id uuid references private.stockflow_order_pricing_decisions(id) on delete restrict;

alter table private.stockflow_pricing_policies enable row level security;
alter table private.stockflow_customer_product_prices enable row level security;
alter table private.stockflow_tally_sales_prices enable row level security;
alter table private.stockflow_tally_purchase_costs enable row level security;
alter table private.stockflow_order_pricing_decisions enable row level security;
alter table private.stockflow_price_exceptions enable row level security;
alter table private.stockflow_pricing_events enable row level security;
alter table private.stockflow_billing_snapshots enable row level security;

create or replace function private.prevent_immutable_pricing_update() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin raise exception 'Immutable pricing history cannot be changed' using errcode='55000'; end $$;
revoke all on function private.prevent_immutable_pricing_update() from public,anon,authenticated;

create trigger stockflow_pricing_policy_no_delete before delete on private.stockflow_pricing_policies for each row execute function private.prevent_business_delete();
create trigger stockflow_customer_price_no_delete before delete on private.stockflow_customer_product_prices for each row execute function private.prevent_business_delete();
create trigger stockflow_tally_sales_price_no_delete before delete on private.stockflow_tally_sales_prices for each row execute function private.prevent_business_delete();
create trigger stockflow_tally_purchase_cost_no_delete before delete on private.stockflow_tally_purchase_costs for each row execute function private.prevent_business_delete();
create trigger stockflow_pricing_decision_no_delete before delete on private.stockflow_order_pricing_decisions for each row execute function private.prevent_business_delete();
create trigger stockflow_price_exception_no_delete before delete on private.stockflow_price_exceptions for each row execute function private.prevent_business_delete();
create trigger stockflow_pricing_event_no_delete before delete on private.stockflow_pricing_events for each row execute function private.prevent_business_delete();
create trigger stockflow_pricing_event_immutable before update on private.stockflow_pricing_events for each row execute function private.prevent_immutable_pricing_update();
create trigger stockflow_billing_snapshot_no_delete before delete on private.stockflow_billing_snapshots for each row execute function private.prevent_business_delete();

create trigger stockflow_tally_sales_price_immutable before update on private.stockflow_tally_sales_prices for each row execute function private.prevent_immutable_pricing_update();
create trigger stockflow_tally_purchase_cost_immutable before update on private.stockflow_tally_purchase_costs for each row execute function private.prevent_immutable_pricing_update();
create trigger stockflow_billing_snapshot_immutable before update of order_id,snapshot_version,order_version,pricing_payload,snapshot_hash,created_by_email,created_at on private.stockflow_billing_snapshots for each row execute function private.prevent_immutable_pricing_update();

create or replace function private.stockflow_import_tally_pricing_evidence() returns trigger
language plpgsql security definer set search_path=pg_catalog,private as $$
declare entry jsonb; customer private.stockflow_customers%rowtype; imported integer:=0;
begin
  if new.id<>'suprabha' or jsonb_typeof(new.payload->'pricingHistory')<>'object' then return new; end if;
  if jsonb_typeof(new.payload->'pricingHistory'->'sales')='array' then
    if jsonb_array_length(new.payload->'pricingHistory'->'sales')>5000 then raise exception 'Pricing sales evidence exceeds the safe import limit' using errcode='54000'; end if;
    for entry in select value from jsonb_array_elements(new.payload->'pricingHistory'->'sales') loop
      select * into customer from private.stockflow_customers
        where active and tally_key=nullif(btrim(entry->>'customerTallyKey'),'') limit 1;
      if customer.id is null then continue; end if;
      begin
        insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version,exceptional,exception_type)
        values(customer.id,btrim(entry->>'tallyItemKey'),(entry->>'rate')::numeric,(entry->>'invoiceDate')::date,btrim(entry->>'invoiceReference'),btrim(entry->>'sourceId'),btrim(entry->>'sourceVersion'),coalesce((entry->>'exceptional')::boolean,false),nullif(entry->>'exceptionType',''))
        on conflict(source_id,source_version) do nothing;
        imported:=imported+1;
      exception when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then
        continue;
      end;
    end loop;
  end if;
  if jsonb_typeof(new.payload->'pricingHistory'->'purchaseCosts')='array' then
    if jsonb_array_length(new.payload->'pricingHistory'->'purchaseCosts')>5000 then raise exception 'Purchase-cost evidence exceeds the safe import limit' using errcode='54000'; end if;
    for entry in select value from jsonb_array_elements(new.payload->'pricingHistory'->'purchaseCosts') loop
      begin
        insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version)
        values(btrim(entry->>'tallyItemKey'),(entry->>'amount')::numeric,coalesce(nullif(entry->>'kind',''),'purchase_price'),(entry->>'effectiveAt')::date,btrim(entry->>'sourceReference'),btrim(entry->>'sourceId'),btrim(entry->>'sourceVersion'))
        on conflict(source_id,source_version) do nothing;
      exception when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then
        continue;
      end;
    end loop;
  end if;
  -- Pricing evidence is consumed into private append-only tables and never retained
  -- in the general stock snapshot that operational APIs can read.
  new.payload:=new.payload-'pricingHistory';
  return new;
end $$;
revoke all on function private.stockflow_import_tally_pricing_evidence() from public,anon,authenticated;
create trigger stockflow_import_tally_pricing_evidence before insert or update of payload on public.stockflow_snapshots for each row execute function private.stockflow_import_tally_pricing_evidence();

create or replace function private.stockflow_assert_pricing_role(p_role text) returns void
language plpgsql immutable set search_path=pg_catalog as $$
begin
  if p_role not in ('administrator','management','accounts') then
    raise exception 'Pricing access is restricted' using errcode='42501';
  end if;
end $$;
revoke all on function private.stockflow_assert_pricing_role(text) from public,anon,authenticated;

create or replace function private.stockflow_round_price_up(p_amount numeric,p_increment numeric) returns numeric
language sql immutable strict set search_path=pg_catalog as $$
  select round(ceil(p_amount/p_increment)*p_increment,2)
$$;
revoke all on function private.stockflow_round_price_up(numeric,numeric) from public,anon,authenticated;

create or replace function private.stockflow_resolve_pricing_line(p_order_line_id uuid,p_pricing_date date)
returns jsonb language plpgsql stable set search_path=pg_catalog,private,extensions as $$
declare
  l private.stockflow_order_lines%rowtype; o private.stockflow_orders%rowtype;
  contract private.stockflow_customer_product_prices%rowtype;
  sale private.stockflow_tally_sales_prices%rowtype;
  latest_cost private.stockflow_tally_purchase_costs%rowtype;
  previous_cost private.stockflow_tally_purchase_costs%rowtype;
  policy private.stockflow_pricing_policies%rowtype;
  proposed numeric; source_type text; source_ref text; source_date date; source_version text;
  gp numeric; gp_percent numeric; previous_gp_percent numeric; erosion numeric;
  change_amount numeric; change_percent numeric; guardrail text; resolution text;
  suggested_unrounded numeric; suggested numeric;
begin
  select * into l from private.stockflow_order_lines where id=p_order_line_id;
  if not found then raise exception 'Order line was not found' using errcode='22023'; end if;
  select * into o from private.stockflow_orders where id=l.order_id;
  if o.customer_id is null then
    return jsonb_build_object('lineId',l.id,'tallyKey',l.tally_item_key,'itemName',l.item_name,'resolution','PRICE_REVIEW_REQUIRED','guardrail','PRICE_REVIEW_REQUIRED','proposedRate',null,'warnings',jsonb_build_array('CUSTOMER_LEDGER_REQUIRED'));
  end if;
  select * into policy from private.stockflow_pricing_policies
    where active and effective_from<=p_pricing_date and (effective_to is null or effective_to>=p_pricing_date)
    order by effective_from desc limit 1;
  if not found then raise exception 'Pricing policy is not configured' using errcode='55000'; end if;
  select * into contract from private.stockflow_customer_product_prices
    where customer_id=o.customer_id and tally_item_key=l.tally_item_key and status in ('approved','superseded')
      and valid_from<=p_pricing_date and (valid_to is null or valid_to>=p_pricing_date)
    order by valid_from desc limit 1;
  select * into sale from private.stockflow_tally_sales_prices
    where customer_id=o.customer_id and tally_item_key=l.tally_item_key and invoice_date<=p_pricing_date
      and not exceptional and invoice_rate>0
    order by invoice_date desc,imported_at desc limit 1;
  if contract.id is not null then
    proposed:=contract.price_amount; source_type:='APPROVED_CONTRACT'; source_ref:=contract.id::text;
    source_date:=contract.valid_from; source_version:=contract.version::text; resolution:='APPROVED_CONTRACT_PRICE';
  elsif sale.id is not null then
    proposed:=sale.invoice_rate; source_type:='LAST_TALLY_INVOICE'; source_ref:=sale.invoice_reference;
    source_date:=sale.invoice_date; source_version:=sale.source_version; resolution:='LAST_TALLY_INVOICE_PRICE';
  else
    proposed:=null; source_type:='NONE'; resolution:='NO_PRICE_HISTORY';
  end if;
  select * into latest_cost from private.stockflow_tally_purchase_costs
    where tally_item_key=l.tally_item_key and effective_at<=p_pricing_date
    order by effective_at desc,imported_at desc limit 1;
  if sale.id is not null then
    select * into previous_cost from private.stockflow_tally_purchase_costs
      where tally_item_key=l.tally_item_key and effective_at<=sale.invoice_date
      order by effective_at desc,imported_at desc limit 1;
  end if;
  if latest_cost.id is not null and previous_cost.id is not null then
    change_amount:=latest_cost.cost_amount-previous_cost.cost_amount;
    change_percent:=case when previous_cost.cost_amount>0 then change_amount/previous_cost.cost_amount*100 end;
  end if;
  if proposed is not null and latest_cost.id is not null then
    gp:=proposed-latest_cost.cost_amount; gp_percent:=case when proposed>0 then gp/proposed*100 end;
  end if;
  if proposed is not null and previous_cost.id is not null then previous_gp_percent:=(proposed-previous_cost.cost_amount)/proposed*100; end if;
  if gp_percent is not null and previous_gp_percent is not null then erosion:=gp_percent-previous_gp_percent; end if;
  guardrail:=case when proposed is null or latest_cost.id is null or proposed<latest_cost.cost_amount or gp_percent<policy.minimum_margin_percent then 'PRICE_REVIEW_REQUIRED'
    when coalesce(change_amount,0)>0 then 'COST_INCREASE' else 'PRICE_OK' end;
  if guardrail='PRICE_REVIEW_REQUIRED' then resolution:='PRICE_REVIEW_REQUIRED'; end if;
  if coalesce(change_amount,0)>0 and policy.target_margin_percent is not null then
    suggested_unrounded:=latest_cost.cost_amount/(1-policy.target_margin_percent/100);
    suggested:=private.stockflow_round_price_up(suggested_unrounded,policy.rounding_increment);
  end if;
  return jsonb_build_object(
    'lineId',l.id,'tallyKey',l.tally_item_key,'itemName',l.item_name,'quantity',l.quantity,
    'resolution',resolution,'guardrail',guardrail,'proposedRate',proposed,
    'source',jsonb_build_object('type',source_type,'reference',source_ref,'date',source_date,'version',source_version,'contractId',contract.id,'saleId',sale.id),
    'recentRates',coalesce((select jsonb_agg(to_jsonb(recent)) from (select invoice_rate as "rate",invoice_date as "invoiceDate",invoice_reference as "invoiceReference",source_version as "sourceVersion" from private.stockflow_tally_sales_prices where customer_id=o.customer_id and tally_item_key=l.tally_item_key and invoice_date<=p_pricing_date and not exceptional and invoice_rate>0 order by invoice_date desc,imported_at desc limit 5) recent),'[]'::jsonb),
    'cost',case when latest_cost.id is null then null else jsonb_build_object('id',latest_cost.id,'amount',latest_cost.cost_amount,'kind',latest_cost.cost_kind,'effectiveAt',latest_cost.effective_at,'sourceReference',latest_cost.source_reference,'sourceVersion',latest_cost.source_version,'previousAmount',previous_cost.cost_amount,'changeAmount',change_amount,'changePercent',round(change_percent,2)) end,
    'margin',jsonb_build_object('grossProfitAmount',gp,'grossMarginPercent',round(gp_percent,2),'previousGrossMarginPercent',round(previous_gp_percent,2),'erosionPercentagePoints',round(erosion,2)),
    'suggestion',case when suggested is null then null else jsonb_build_object('amount',suggested,'unroundedAmount',round(suggested_unrounded,6),'targetMarginPercent',policy.target_margin_percent,'policyVersion',policy.policy_version,'roundingRuleVersion',policy.rounding_rule_version,'costSourceVersion',latest_cost.source_version) end,
    'policy',jsonb_build_object('id',policy.id,'version',policy.policy_version,'minimumMarginPercent',policy.minimum_margin_percent,'overrideApprovalPercent',policy.override_approval_percent,'roundingRuleVersion',policy.rounding_rule_version),
    'warnings',(case when proposed is null then jsonb_build_array('NO_ELIGIBLE_PRICE_HISTORY') else '[]'::jsonb end)
      || (case when latest_cost.id is null then jsonb_build_array('MISSING_PURCHASE_COST') else '[]'::jsonb end)
      || (case when coalesce(change_amount,0)>0 then jsonb_build_array('PURCHASE_PRICE_INCREASED') else '[]'::jsonb end)
      || (case when proposed is not null and latest_cost.id is not null and proposed<latest_cost.cost_amount then jsonb_build_array('LOSS_MAKING') else '[]'::jsonb end)
      || (case when gp_percent is not null and gp_percent<policy.minimum_margin_percent then jsonb_build_array('BELOW_MINIMUM_MARGIN') else '[]'::jsonb end)
  );
end $$;
revoke all on function private.stockflow_resolve_pricing_line(uuid,date) from public,anon,authenticated;

create or replace function private.stockflow_order_pricing_payload(p_order_id uuid,p_pricing_date date)
returns jsonb language sql stable set search_path=pg_catalog,private as $$
  select jsonb_build_object(
    'orderId',o.id,'orderNumber',o.order_number,'customerId',o.customer_id,'customerName',o.customer_name,
    'orderVersion',o.version,'pricingState',o.pricing_state,
    'lines',coalesce((select jsonb_agg(private.stockflow_resolve_pricing_line(l.id,p_pricing_date) order by l.item_name) from private.stockflow_order_lines l where l.order_id=o.id),'[]'::jsonb),
    'currentSnapshotId',o.pricing_snapshot_id,
    'exceptions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'lineId',e.order_line_id,'referenceRate',e.reference_rate,'enteredRate',e.entered_rate,
      'differenceAmount',e.difference_amount,'differencePercent',e.difference_percent,'reason',e.reason,
      'state',e.state,'requestedBy',e.requested_by_email,'requestedAt',e.requested_at,'version',e.version
    ) order by e.requested_at) from private.stockflow_price_exceptions e where e.order_id=o.id and e.state='pending'),'[]'::jsonb)
  ) from private.stockflow_orders o where o.id=p_order_id and o.archived_at is null
$$;
revoke all on function private.stockflow_order_pricing_payload(uuid,date) from public,anon,authenticated;

create or replace function public.stockflow_pricing_gateway(
  p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer
set search_path=pg_catalog as $$
declare
  v_email text:=lower(btrim(coalesce(p_actor_email,''))); v_role text; v_hash text;
  v_order private.stockflow_orders%rowtype; v_key text; v_replay jsonb; v_result jsonb;
  v_pricing_date date; v_line jsonb; v_resolved jsonb; v_entered numeric; v_difference numeric; v_difference_percent numeric;
  v_reason text; v_decision_id uuid; v_exception_id uuid; v_snapshot_id uuid; v_snapshot_version integer; v_decision_version integer;
  v_requires_approval boolean:=false; v_payload_lines jsonb:='[]'::jsonb; v_exception private.stockflow_price_exceptions%rowtype;
  contract private.stockflow_customer_product_prices%rowtype;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  select role into v_role from public.stockflow_members where email=v_email and status='active';
  perform private.stockflow_assert_pricing_role(v_role);
  begin v_pricing_date:=coalesce(nullif(p_payload->>'pricingDate','')::date,(now() at time zone 'Asia/Kolkata')::date);
  exception when invalid_datetime_format or datetime_field_overflow then raise exception 'Valid pricing date is required' using errcode='22023'; end;

  if p_action='get_order_pricing' then
    select * into v_order from private.stockflow_orders where id=(p_payload->>'orderId')::uuid and archived_at is null;
    if not found then raise exception 'Order was not found' using errcode='22023'; end if;
    perform private.assert_stockflow_order_access(v_email,v_role,v_order.id);
    return private.stockflow_order_pricing_payload(v_order.id,v_pricing_date);
  end if;

  if p_action='list_price_contracts' then
    return jsonb_build_object('contracts',coalesce((select jsonb_agg(to_jsonb(contract) order by contract."validFrom" desc,contract."createdAt" desc) from (
      select p.id,p.customer_id as "customerId",c.name as "customerName",p.tally_item_key as "tallyKey",p.price_amount as price,p.currency,p.valid_from as "validFrom",p.valid_to as "validTo",p.status,p.source_type as source,p.source_reference as "sourceReference",p.reason,p.approved_by_email as "approvedBy",p.approved_at as "approvedAt",p.version,p.supersedes_price_id as "supersedesPriceId",p.created_by_email as "createdBy",p.created_at as "createdAt"
      from private.stockflow_customer_product_prices p join private.stockflow_customers c on c.id=p.customer_id
      where (nullif(p_payload->>'customerId','') is null or p.customer_id=(p_payload->>'customerId')::uuid)
        and (nullif(btrim(p_payload->>'tallyKey'),'') is null or p.tally_item_key=btrim(p_payload->>'tallyKey'))
      order by p.valid_from desc,p.created_at desc limit 200
    ) contract),'[]'::jsonb));
  end if;

  v_key:=p_payload->>'idempotencyKey';
  v_replay:=private.begin_stockflow_command(v_email,p_action,v_key,p_payload);
  if v_replay is not null then return v_replay; end if;

  if p_action='create_price_contract' then
    if jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid customer price request' using errcode='22023'; end if;
    begin
      insert into private.stockflow_customer_product_prices(customer_id,tally_item_key,price_amount,valid_from,valid_to,status,source_type,source_reference,reason,supersedes_price_id,created_by_email)
      values((p_payload->>'customerId')::uuid,btrim(p_payload->>'tallyKey'),(p_payload->>'price')::numeric,(p_payload->>'validFrom')::date,nullif(p_payload->>'validTo','')::date,'pending_approval',p_payload->>'source',nullif(btrim(p_payload->>'sourceReference'),''),btrim(p_payload->>'reason'),nullif(p_payload->>'supersedesPriceId','')::uuid,v_email)
      returning id into v_decision_id;
    exception when foreign_key_violation then raise exception 'Customer or superseded price was not found' using errcode='22023'; end;
    insert into private.stockflow_pricing_events(entity_type,entity_id,event_type,actor_email,actor_role,request_id,metadata)
    values('customer_price',v_decision_id,'customer_price_requested',v_email,v_role,v_key,jsonb_build_object('source',p_payload->>'source','validFrom',p_payload->>'validFrom','validTo',p_payload->>'validTo'));
    v_result:=jsonb_build_object('ok',true,'contractId',v_decision_id,'status','pending_approval','version',1);
    perform private.finish_stockflow_command(v_email,p_action,v_key,p_payload,v_decision_id,v_result);
    return v_result;
  end if;

  if p_action in ('approve_price_contract','reject_price_contract') then
    if v_role not in ('administrator','management') then raise exception 'Customer price approval is restricted' using errcode='42501'; end if;
    select * into contract from private.stockflow_customer_product_prices where id=(p_payload->>'contractId')::uuid for update;
    if not found then raise exception 'Customer price was not found' using errcode='22023'; end if;
    if contract.version<>(p_payload->>'expectedVersion')::integer then raise exception 'Customer price has changed; refresh before trying again' using errcode='40001'; end if;
    if contract.status<>'pending_approval' then raise exception 'Customer price is already decided' using errcode='22023'; end if;
    v_reason:=nullif(btrim(coalesce(p_payload->>'reason','')),'');
    if v_reason is null then raise exception 'A decision reason is required' using errcode='22023'; end if;
    if p_action='approve_price_contract' and contract.supersedes_price_id is not null then
      if not exists(select 1 from private.stockflow_customer_product_prices old where old.id=contract.supersedes_price_id and old.status='approved' and old.customer_id=contract.customer_id and old.tally_item_key=contract.tally_item_key and old.valid_from<contract.valid_from) then
        raise exception 'Superseded customer price must be an earlier approved price for the same customer and item' using errcode='22023';
      end if;
      update private.stockflow_customer_product_prices set status='superseded',valid_to=contract.valid_from-1,version=version+1 where id=contract.supersedes_price_id;
    end if;
    update private.stockflow_customer_product_prices set status=case when p_action='approve_price_contract' then 'approved' else 'rejected' end,approved_by_email=case when p_action='approve_price_contract' then v_email end,approved_at=case when p_action='approve_price_contract' then now() end,version=version+1 where id=contract.id;
    insert into private.stockflow_pricing_events(entity_type,entity_id,event_type,actor_email,actor_role,request_id,metadata)
    values('customer_price',contract.id,case when p_action='approve_price_contract' then 'customer_price_approved' else 'customer_price_rejected' end,v_email,v_role,v_key,jsonb_build_object('reason',v_reason,'previousStatus',contract.status));
    v_result:=jsonb_build_object('ok',true,'contractId',contract.id,'status',case when p_action='approve_price_contract' then 'approved' else 'rejected' end,'version',contract.version+1);
    perform private.finish_stockflow_command(v_email,p_action,v_key,p_payload,contract.id,v_result);
    return v_result;
  end if;

  if p_action='submit_order_pricing' then
    select * into v_order from private.stockflow_orders where id=(p_payload->>'orderId')::uuid and archived_at is null for update;
    if not found then raise exception 'Order was not found' using errcode='22023'; end if;
    perform private.assert_stockflow_order_access(v_email,v_role,v_order.id);
    if v_order.version<>(p_payload->>'expectedVersion')::integer then raise exception 'Order has changed; refresh before trying again' using errcode='40001'; end if;
    if v_order.customer_id is null then raise exception 'A canonical Tally customer is required for pricing' using errcode='22023'; end if;
    if jsonb_typeof(p_payload->'lines')<>'array' or jsonb_array_length(p_payload->'lines')<>(select count(*) from private.stockflow_order_lines where order_id=v_order.id) then raise exception 'Every order line requires a pricing decision' using errcode='22023'; end if;
    select coalesce(max(decision_version),0)+1 into v_decision_version from private.stockflow_order_pricing_decisions where order_id=v_order.id;
    for v_line in select value from jsonb_array_elements(p_payload->'lines') loop
      v_exception_id:=null;
      v_resolved:=private.stockflow_resolve_pricing_line((v_line->>'lineId')::uuid,v_pricing_date);
      if (v_resolved->>'lineId')::uuid not in (select id from private.stockflow_order_lines where order_id=v_order.id) then raise exception 'Pricing line does not belong to order' using errcode='22023'; end if;
      begin v_entered:=(v_line->>'enteredRate')::numeric; exception when others then raise exception 'Every line requires a valid selling rate' using errcode='22023'; end;
      if v_entered<=0 then raise exception 'Every line requires a positive selling rate' using errcode='22023'; end if;
      v_reason:=nullif(btrim(coalesce(v_line->>'reason','')),'');
      v_difference:=case when (v_resolved->>'proposedRate') is null then null else v_entered-(v_resolved->>'proposedRate')::numeric end;
      v_difference_percent:=case when coalesce((v_resolved->>'proposedRate')::numeric,0)>0 then v_difference/(v_resolved->>'proposedRate')::numeric*100 end;
      v_requires_approval:=(v_resolved->>'guardrail')='PRICE_REVIEW_REQUIRED'
        or (v_difference_percent is not null and abs(v_difference_percent)>((v_resolved->'policy'->>'overrideApprovalPercent')::numeric));
      if (v_requires_approval or v_difference is distinct from 0) and v_reason is null then raise exception 'A pricing exception reason is required' using errcode='22023'; end if;
      insert into private.stockflow_order_pricing_decisions(
        order_id,order_line_id,decision_version,order_version,state,resolution_type,proposed_rate,approved_rate,source_type,source_reference,source_date,source_version,contract_price_id,cost_id,cost_amount,cost_source_version,gross_profit_amount,gross_margin_percent,previous_gross_margin_percent,margin_erosion_points,guardrail_state,suggestion_amount,suggestion_unrounded,pricing_policy_id,pricing_policy_version,rounding_rule_version,exception_reason,requested_by_email,approved_by_email,approved_at,request_id
      ) values (
        v_order.id,(v_resolved->>'lineId')::uuid,v_decision_version,v_order.version,case when v_requires_approval then 'pending_approval' else 'approved' end,
        case when v_requires_approval then 'price_exception' when v_resolved->'source'->>'type'='APPROVED_CONTRACT' then 'approved_contract_price' when v_resolved->'source'->>'type'='LAST_TALLY_INVOICE' then 'last_tally_invoice_price' else 'price_review_required' end,
        (v_resolved->>'proposedRate')::numeric,v_entered,case when v_resolved->'source'->>'type'='APPROVED_CONTRACT' then 'approved_contract' when v_resolved->'source'->>'type'='LAST_TALLY_INVOICE' then 'last_tally_invoice' else 'manual_review' end,
        v_resolved->'source'->>'reference',nullif(v_resolved->'source'->>'date','')::date,v_resolved->'source'->>'version',nullif(v_resolved->'source'->>'contractId','')::uuid,nullif(v_resolved->'cost'->>'id','')::uuid,nullif(v_resolved->'cost'->>'amount','')::numeric,v_resolved->'cost'->>'sourceVersion',
        v_entered-coalesce((v_resolved->'cost'->>'amount')::numeric,0),case when v_entered>0 and v_resolved->'cost' is not null then (v_entered-(v_resolved->'cost'->>'amount')::numeric)/v_entered*100 end,
        nullif(v_resolved->'margin'->>'previousGrossMarginPercent','')::numeric,nullif(v_resolved->'margin'->>'erosionPercentagePoints','')::numeric,lower(v_resolved->>'guardrail'),
        nullif(v_resolved->'suggestion'->>'amount','')::numeric,nullif(v_resolved->'suggestion'->>'unroundedAmount','')::numeric,(v_resolved->'policy'->>'id')::uuid,v_resolved->'policy'->>'version',v_resolved->'policy'->>'roundingRuleVersion',v_reason,v_email,case when v_requires_approval then null else v_email end,case when v_requires_approval then null else now() end,v_key
      ) returning id into v_decision_id;
      if v_requires_approval then
      insert into private.stockflow_price_exceptions(decision_id,order_id,order_line_id,reference_rate,entered_rate,difference_amount,difference_percent,reason,state,requested_by_email)
        values(v_decision_id,v_order.id,(v_resolved->>'lineId')::uuid,(v_resolved->>'proposedRate')::numeric,v_entered,v_difference,v_difference_percent,v_reason,'pending',v_email)
        returning id into v_exception_id;
      end if;
      insert into private.stockflow_pricing_events(entity_type,entity_id,event_type,actor_email,actor_role,request_id,metadata)
      values('order_pricing',v_decision_id,case when v_requires_approval then 'price_exception_requested' else 'order_line_price_approved' end,v_email,v_role,v_key,jsonb_build_object('orderId',v_order.id,'lineId',v_resolved->>'lineId','guardrail',v_resolved->>'guardrail','source',v_resolved->'source'));
      v_payload_lines:=v_payload_lines||jsonb_build_array(jsonb_build_object('decisionId',v_decision_id,'lineId',v_resolved->>'lineId','enteredRate',v_entered,'requiresApproval',v_requires_approval,'exceptionId',v_exception_id,'resolution',v_resolved));
    end loop;
    if exists(select 1 from private.stockflow_order_pricing_decisions where order_id=v_order.id and decision_version=v_decision_version and state='pending_approval') then
      update private.stockflow_orders set pricing_state='approval_required',pricing_snapshot_id=null,version=version+1,updated_by_email=v_email,updated_at=now() where id=v_order.id;
      update private.stockflow_order_lines set pricing_state='approval_required',approved_pricing_decision_id=null where order_id=v_order.id;
      v_result:=jsonb_build_object('ok',true,'orderId',v_order.id,'pricingState','approval_required','version',v_order.version+1,'lines',v_payload_lines);
    else
      select coalesce(max(snapshot_version),0)+1 into v_snapshot_version from private.stockflow_billing_snapshots where order_id=v_order.id;
      insert into private.stockflow_billing_snapshots(order_id,snapshot_version,order_version,pricing_payload,snapshot_hash,created_by_email)
      values(v_order.id,v_snapshot_version,v_order.version,v_payload_lines,encode(extensions.digest(v_payload_lines::text,'sha256'),'hex'),v_email) returning id into v_snapshot_id;
      update private.stockflow_order_lines l set pricing_state='approved',approved_pricing_decision_id=d.id from private.stockflow_order_pricing_decisions d where l.order_id=v_order.id and d.order_line_id=l.id and d.decision_version=v_decision_version;
      update private.stockflow_orders set pricing_state='approved',pricing_snapshot_id=v_snapshot_id,version=version+1,updated_by_email=v_email,updated_at=now() where id=v_order.id;
      insert into private.stockflow_order_events(order_id,event_type,from_status,to_status,actor_email,actor_role,metadata) values(v_order.id,'order_pricing_approved',v_order.status,v_order.status,v_email,v_role,jsonb_build_object('snapshotId',v_snapshot_id,'snapshotVersion',v_snapshot_version,'requestId',v_key));
      insert into private.stockflow_outbox(topic,aggregate_id,payload) values('order.pricing_approved',v_order.id,jsonb_build_object('snapshotId',v_snapshot_id,'snapshotVersion',v_snapshot_version,'requestId',v_key));
      insert into private.stockflow_pricing_events(entity_type,entity_id,event_type,actor_email,actor_role,request_id,metadata) values('billing_snapshot',v_snapshot_id,'billing_snapshot_created',v_email,v_role,v_key,jsonb_build_object('orderId',v_order.id,'snapshotVersion',v_snapshot_version));
      v_result:=jsonb_build_object('ok',true,'orderId',v_order.id,'pricingState','approved','snapshotId',v_snapshot_id,'snapshotVersion',v_snapshot_version,'version',v_order.version+1);
    end if;
    perform private.finish_stockflow_command(v_email,p_action,v_key,p_payload,v_order.id,v_result);
    return v_result;
  end if;

  if p_action in ('approve_price_exception','reject_price_exception') then
    select * into v_exception from private.stockflow_price_exceptions where id=(p_payload->>'exceptionId')::uuid for update;
    if not found then raise exception 'Pricing exception was not found' using errcode='22023'; end if;
    if v_role not in ('administrator','management') then raise exception 'Pricing exception approval is restricted' using errcode='42501'; end if;
    if v_exception.version<>(p_payload->>'expectedVersion')::integer then raise exception 'Pricing exception has changed; refresh before trying again' using errcode='40001'; end if;
    if v_exception.state<>'pending' then raise exception 'Pricing exception is already decided' using errcode='22023'; end if;
    v_reason:=nullif(btrim(coalesce(p_payload->>'reason','')),'');
    if v_reason is null then raise exception 'A decision reason is required' using errcode='22023'; end if;
    update private.stockflow_price_exceptions set state=case when p_action='approve_price_exception' then 'approved' else 'rejected' end,decided_by_email=v_email,decided_at=now(),decision_reason=v_reason,version=version+1 where id=v_exception.id;
    update private.stockflow_order_pricing_decisions set state=case when p_action='approve_price_exception' then 'approved' else 'rejected' end,approved_by_email=case when p_action='approve_price_exception' then v_email end,approved_at=case when p_action='approve_price_exception' then now() end where id=v_exception.decision_id;
    insert into private.stockflow_pricing_events(entity_type,entity_id,event_type,actor_email,actor_role,request_id,metadata) values('price_exception',v_exception.id,case when p_action='approve_price_exception' then 'price_exception_approved' else 'price_exception_rejected' end,v_email,v_role,v_key,jsonb_build_object('reason',v_reason,'orderId',v_exception.order_id));
    select * into v_order from private.stockflow_orders where id=v_exception.order_id for update;
    if p_action='reject_price_exception' then
      update private.stockflow_orders set pricing_state='review_required',version=version+1,updated_by_email=v_email,updated_at=now() where id=v_order.id;
    elsif not exists(select 1 from private.stockflow_price_exceptions where order_id=v_order.id and state='pending') then
      select max(decision_version) into v_decision_version from private.stockflow_order_pricing_decisions where order_id=v_order.id;
      select coalesce(max(snapshot_version),0)+1 into v_snapshot_version from private.stockflow_billing_snapshots where order_id=v_order.id;
      select coalesce(jsonb_agg(to_jsonb(d) order by d.order_line_id),'[]'::jsonb) into v_payload_lines from private.stockflow_order_pricing_decisions d where d.order_id=v_order.id and d.decision_version=v_decision_version and d.state='approved';
      if jsonb_array_length(v_payload_lines)<>(select count(*) from private.stockflow_order_lines where order_id=v_order.id) then raise exception 'Not every pricing decision is approved' using errcode='55000'; end if;
      insert into private.stockflow_billing_snapshots(order_id,snapshot_version,order_version,pricing_payload,snapshot_hash,created_by_email) values(v_order.id,v_snapshot_version,v_order.version,v_payload_lines,encode(extensions.digest(v_payload_lines::text,'sha256'),'hex'),v_email) returning id into v_snapshot_id;
      update private.stockflow_order_lines l set pricing_state='approved',approved_pricing_decision_id=d.id from private.stockflow_order_pricing_decisions d where l.order_id=v_order.id and d.order_line_id=l.id and d.decision_version=v_decision_version;
      update private.stockflow_orders set pricing_state='approved',pricing_snapshot_id=v_snapshot_id,version=version+1,updated_by_email=v_email,updated_at=now() where id=v_order.id;
      insert into private.stockflow_order_events(order_id,event_type,from_status,to_status,reason,actor_email,actor_role,metadata) values(v_order.id,'price_exception_approved',v_order.status,v_order.status,v_reason,v_email,v_role,jsonb_build_object('exceptionId',v_exception.id,'snapshotId',v_snapshot_id,'requestId',v_key));
      insert into private.stockflow_outbox(topic,aggregate_id,payload) values('order.pricing_approved',v_order.id,jsonb_build_object('snapshotId',v_snapshot_id,'requestId',v_key));
    end if;
    v_result:=jsonb_build_object('ok',true,'orderId',v_order.id,'exceptionId',v_exception.id,'decision',case when p_action='approve_price_exception' then 'approved' else 'rejected' end,'pricingState',(select pricing_state from private.stockflow_orders where id=v_order.id),'version',(select version from private.stockflow_orders where id=v_order.id));
    perform private.finish_stockflow_command(v_email,p_action,v_key,p_payload,v_order.id,v_result);
    return v_result;
  end if;
  raise exception 'Unsupported pricing action' using errcode='22023';
end $$;

revoke all on function public.stockflow_pricing_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_pricing_gateway(text,text,text,jsonb) to service_role;

create or replace function private.stockflow_require_current_pricing_before_billing() returns trigger
language plpgsql set search_path=pg_catalog,private as $$
declare snap private.stockflow_billing_snapshots%rowtype;
begin
  if new.status in ('awaiting_tally_billing','billed_in_tally','ready_for_dispatch','dispatched','delivered')
    and old.status not in ('awaiting_tally_billing','billed_in_tally','ready_for_dispatch','dispatched','delivered') then
    if new.pricing_state<>'approved' or new.pricing_snapshot_id is null then raise exception 'Pricing approval is required before billing' using errcode='22023'; end if;
    select * into snap from private.stockflow_billing_snapshots where id=new.pricing_snapshot_id and invalidated_at is null;
    if not found then raise exception 'Current immutable billing snapshot is required' using errcode='22023'; end if;
    if exists(
      select 1 from private.stockflow_order_pricing_decisions d
      join private.stockflow_tally_purchase_costs latest on latest.id=(select c.id from private.stockflow_tally_purchase_costs c where c.tally_item_key=(select l.tally_item_key from private.stockflow_order_lines l where l.id=d.order_line_id) order by c.effective_at desc,c.imported_at desc limit 1)
      where d.order_id=new.id and d.state='approved' and d.id in (select l.approved_pricing_decision_id from private.stockflow_order_lines l where l.order_id=new.id)
        and (d.cost_id is distinct from latest.id or d.cost_source_version is distinct from latest.source_version)
    ) then raise exception 'Authoritative purchase cost changed; pricing reapproval is required' using errcode='40001'; end if;
  end if;
  return new;
end $$;
revoke all on function private.stockflow_require_current_pricing_before_billing() from public,anon,authenticated;
create trigger stockflow_require_current_pricing_before_billing before update of status on private.stockflow_orders for each row execute function private.stockflow_require_current_pricing_before_billing();

create or replace function private.stockflow_invalidate_pricing_after_line_change() returns trigger
language plpgsql set search_path=pg_catalog,private as $$
begin
  if old.quantity is distinct from new.quantity or old.tally_item_key is distinct from new.tally_item_key then
    update private.stockflow_order_pricing_decisions set state='invalidated',invalidated_at=now(),invalidation_reason='Order line changed after pricing' where order_id=new.order_id and state in ('approved','pending_approval');
    update private.stockflow_billing_snapshots set invalidated_at=now(),invalidation_reason='Order line changed after pricing' where order_id=new.order_id and invalidated_at is null;
    update private.stockflow_order_lines set pricing_state='invalidated',approved_pricing_decision_id=null where order_id=new.order_id;
    update private.stockflow_orders set pricing_state='invalidated',pricing_snapshot_id=null where id=new.order_id;
  end if;
  return new;
end $$;
revoke all on function private.stockflow_invalidate_pricing_after_line_change() from public,anon,authenticated;
create trigger stockflow_invalidate_pricing_after_line_change after update of quantity,tally_item_key on private.stockflow_order_lines for each row execute function private.stockflow_invalidate_pricing_after_line_change();

do $migration$
declare f text; updated text;
begin
  select pg_get_functiondef('public.stockflow_order_list_gateway(text,text,text,jsonb)'::regprocedure) into f;
  updated:=replace(f,$old$'assignedToEmail', o.assigned_to_email, 'followUpDate'$old$,$new$'assignedToEmail', o.assigned_to_email, 'pricingState', o.pricing_state, 'followUpDate'$new$);
  if updated=f then updated:=replace(f,$old$'assignedToEmail',o.assigned_to_email,'followUpDate'$old$,$new$'assignedToEmail',o.assigned_to_email,'pricingState',o.pricing_state,'followUpDate'$new$); end if;
  if updated=f then raise exception 'Expected order-list pricing state projection was not found'; end if;
  execute updated;

  select pg_get_functiondef('public.stockflow_order_gateway(text,text,text,jsonb)'::regprocedure) into f;
  updated:=replace(f,$old$x.assigned_to_email as "assignedToEmail", x.follow_up_date$old$,$new$x.assigned_to_email as "assignedToEmail", x.pricing_state as "pricingState", x.follow_up_date$new$);
  if updated=f then raise exception 'Expected bootstrap pricing state projection was not found'; end if;
  execute updated;
end $migration$;

revoke all on function public.stockflow_order_list_gateway(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.stockflow_order_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_order_list_gateway(text,text,text,jsonb) to service_role;
grant execute on function public.stockflow_order_gateway(text,text,text,jsonb) to service_role;
