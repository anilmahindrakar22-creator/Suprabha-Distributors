begin;
create extension if not exists btree_gist with schema extensions;
set local search_path=pg_catalog,public,private,extensions;
create function private.stockflow_economic_business_date(p_at timestamptz default now()) returns date
language sql stable strict set search_path=pg_catalog as $$
 select (p_at at time zone 'Asia/Kolkata')::date
$$;
revoke all on function private.stockflow_economic_business_date(timestamptz) from public,anon,authenticated;
create table private.stockflow_economic_customer_identities (
 company_id text not null,source_id text not null,customer_id uuid not null references private.stockflow_customers(id),verified_by text not null,recorded_at timestamptz not null default now(),
 primary key(company_id,source_id),unique(company_id,customer_id),unique(company_id,source_id,customer_id)
);

create table private.stockflow_economic_targets (
 id uuid primary key default extensions.gen_random_uuid(),
 kind text not null check(kind in ('placement','group')), name text not null check(length(btrim(name)) between 2 and 200),
 company_id text not null check(length(btrim(company_id)) between 1 and 240),
 customer_id uuid not null references private.stockflow_customers(id), customer_source_id text not null check(length(btrim(customer_source_id)) between 1 and 240),
 site_id text not null check(length(btrim(site_id)) between 1 and 240), model_id text not null check(length(btrim(model_id)) between 1 and 240),
 installation_id uuid references private.stockflow_equipment_installations(id),
 effective_from date not null, effective_to date, approval text not null default 'proposed' check(approval in ('proposed','approved','rejected')),
 version integer not null default 1 check(version>0), created_by text not null, created_at timestamptz not null default now(),
 check(effective_to is null or effective_to>effective_from), check((kind='placement')=(installation_id is not null)),
 foreign key(company_id,customer_source_id,customer_id) references private.stockflow_economic_customer_identities(company_id,source_id,customer_id),
 exclude using gist(installation_id with =, daterange(effective_from,effective_to,'[)') with &&) where(kind='placement' and approval<>'rejected')
);
create table private.stockflow_economic_group_members (
 id uuid primary key default extensions.gen_random_uuid(), group_id uuid not null references private.stockflow_economic_targets(id),
 placement_id uuid not null references private.stockflow_economic_targets(id), effective_from date not null, effective_to date,
 check(group_id<>placement_id), check(effective_to is null or effective_to>effective_from),
 exclude using gist(placement_id with =,daterange(effective_from,effective_to,'[)') with &&)
);
create table private.stockflow_economic_mappings (
 id uuid primary key default extensions.gen_random_uuid(), company_id text not null, model_id text not null, product_id text not null,
 target_id uuid references private.stockflow_economic_targets(id), effect text not null check(effect in ('include','exclude')),
 effective_from date not null, effective_to date, reason text not null check(length(btrim(reason)) between 3 and 1000),
 verified_by text not null, recorded_at timestamptz not null default now(),
 check(length(btrim(product_id)) between 1 and 240), check(effective_to is null or effective_to>effective_from)
);
create unique index stockflow_economic_mapping_identity on private.stockflow_economic_mappings(company_id,model_id,product_id,coalesce(target_id,'00000000-0000-0000-0000-000000000000'::uuid),effective_from);
create table private.stockflow_economic_allocations (
 id uuid primary key default extensions.gen_random_uuid(), company_id text not null, customer_source_id text not null, site_id text not null, product_id text not null,
 effective_from date not null,effective_to date, shares jsonb not null check(jsonb_typeof(shares)='array'),
 reason text not null check(length(btrim(reason)) between 3 and 1000), verified_by text not null,recorded_at timestamptz not null default now(),
 check(effective_to is null or effective_to>effective_from),
 exclude using gist(company_id with =,customer_source_id with =,site_id with =,product_id with =,daterange(effective_from,effective_to,'[)') with &&)
);
create table private.stockflow_economic_expectations (
 id uuid primary key default extensions.gen_random_uuid(), target_id uuid not null references private.stockflow_economic_targets(id), effective_from date not null,
 monthly_revenue_paise bigint not null check(monthly_revenue_paise>=0), monthly_gp_paise bigint not null check(monthly_gp_paise<=monthly_revenue_paise),
 reason text not null check(length(btrim(reason)) between 3 and 1000),created_by text not null,recorded_at timestamptz not null default clock_timestamp(),
 unique(target_id,effective_from,recorded_at)
);
create table private.stockflow_economic_expectation_items (
 id uuid primary key default extensions.gen_random_uuid(),expectation_id uuid not null references private.stockflow_economic_expectations(id),product_id text not null,base_unit text not null,
 expected_monthly_units numeric(18,6) not null check(expected_monthly_units>=0),expected_unit_price_paise bigint check(expected_unit_price_paise>=0),expected_unit_cost_paise bigint check(expected_unit_cost_paise>=0),
 unique(expectation_id,product_id)
);
create table private.stockflow_economic_policy_versions (
 id uuid primary key default extensions.gen_random_uuid(), attractive_months integer not null default 24,review_months integer not null default 36,exception_months integer not null default 48,
 forecast_window_months integer not null default 3 check(forecast_window_months between 1 and 12), watch_revenue_percent integer not null default 80,critical_revenue_percent integer not null default 50,
 actor text not null,reason text not null check(length(btrim(reason))>=3),recorded_at timestamptz not null default clock_timestamp(),
 check(attractive_months>0 and review_months>attractive_months and exception_months>review_months),check(critical_revenue_percent between 0 and 99 and watch_revenue_percent between critical_revenue_percent+1 and 100)
);
create table private.stockflow_economic_consumption_observations (
 id uuid primary key default extensions.gen_random_uuid(),revision bigint generated always as identity unique,
 target_id uuid not null references private.stockflow_economic_targets(id),product_id text not null,base_unit text not null,window_from date not null,window_to date not null,
 test_count numeric(18,6) not null check(test_count>=0),tests_per_unit numeric(18,6) not null check(tests_per_unit>0),qc_units numeric(18,6) not null default 0 check(qc_units>=0),
 opening_stock numeric(18,6) check(opening_stock>=0),closing_stock numeric(18,6) check(closing_stock>=0),net_transfers numeric(18,6) not null default 0,external_supply numeric(18,6) not null default 0 check(external_supply>=0),
 evidence_reference text not null check(length(btrim(evidence_reference)) between 3 and 1000),actor text not null,recorded_at timestamptz not null default now(),
 check(window_to>window_from),check((opening_stock is null)=(closing_stock is null))
);
insert into private.stockflow_economic_policy_versions(actor,reason) values('system','Initial configurable policy; management may replace with an audited version');
create table private.stockflow_economic_audit (
 id uuid primary key default extensions.gen_random_uuid(),action text not null,entity_id uuid,actor text not null,payload jsonb not null,recorded_at timestamptz not null default now()
);
create table private.stockflow_economic_source_vouchers (
 id uuid primary key default extensions.gen_random_uuid(),company_id text not null,source_id text not null,source_revision bigint not null check(source_revision>=0),
 business_date date not null,customer_source_id text,site_id text,kind text not null check(kind in ('sale','return','credit','purchase','non_economic')),
 cancelled boolean not null default false,currency text not null default 'INR' check(currency='INR'),evidence jsonb not null,
 imported_at timestamptz not null default now(),unique(company_id,source_id,source_revision)
);
create table private.stockflow_economic_source_lines (
 id uuid primary key default extensions.gen_random_uuid(),voucher_id uuid not null references private.stockflow_economic_source_vouchers(id),line_key text not null,
 product_id text not null,quantity numeric(18,6) not null,unit text not null,net_sales_paise bigint not null,
 gst_paise bigint not null default 0,discount_paise bigint not null default 0,batch_id text,foc_reason text,
 original_company_id text,original_voucher_id text,original_line_key text,
 evidence jsonb not null,unique(voucher_id,line_key),check(length(btrim(product_id)) between 1 and 240),check(length(btrim(unit)) between 1 and 80)
);
create table private.stockflow_economic_cost_verifications (
 id uuid primary key default extensions.gen_random_uuid(),revision bigint generated always as identity unique,sale_line_id uuid not null references private.stockflow_economic_source_lines(id),
 evidence_reference text not null,policy_version text not null default 'verified-purchase-link-v1',actor text not null,recorded_at timestamptz not null default now()
);
create table private.stockflow_economic_cost_links (
 id uuid primary key default extensions.gen_random_uuid(),sale_line_id uuid not null references private.stockflow_economic_source_lines(id),purchase_line_id uuid not null references private.stockflow_economic_source_lines(id),
 verification_id uuid not null references private.stockflow_economic_cost_verifications(id),
 quantity numeric(18,6) not null check(quantity>0),cost_paise bigint not null check(cost_paise>=0),evidence_reference text not null,verified_by text not null,
 recorded_at timestamptz not null default now(),unique(verification_id,purchase_line_id)
);
create table private.stockflow_economic_line_reviews (
 id uuid primary key default extensions.gen_random_uuid(),source_line_id uuid not null references private.stockflow_economic_source_lines(id),
 original_sale_line_id uuid references private.stockflow_economic_source_lines(id),foc_reason text check(foc_reason in ('installation','training','quality_control','replacement','commercial_support','other')),
 reason text not null check(length(btrim(reason)) between 3 and 1000),actor text not null,recorded_at timestamptz not null default clock_timestamp(),
 check(original_sale_line_id is not null or foc_reason is not null)
);
create table private.stockflow_economic_runs (
 id uuid primary key default extensions.gen_random_uuid(),active boolean not null default false,actor text not null,created_at timestamptz not null default now(),engine_version text not null default 'economics-v1'
);
create unique index stockflow_one_active_economic_run on private.stockflow_economic_runs(active) where active;
create table private.stockflow_economic_results (
 id uuid primary key default extensions.gen_random_uuid(),run_id uuid not null references private.stockflow_economic_runs(id),source_line_id uuid not null references private.stockflow_economic_source_lines(id),
 target_id uuid references private.stockflow_economic_targets(id),status text not null,reason text not null,share_bps integer not null check(share_bps between 1 and 10000),
 quantity numeric(18,6) not null,revenue_paise bigint not null,cost_paise bigint,gp_paise bigint,recovery_origin_date date,
 check((cost_paise is null)=(gp_paise is null))
);
create index stockflow_economic_results_run on private.stockflow_economic_results(run_id,target_id);
create table private.stockflow_economic_events (
 id uuid primary key default extensions.gen_random_uuid(),target_id uuid not null references private.stockflow_economic_targets(id),
 kind text not null check(kind in ('capital','contribution','gp','reversal')),amount_paise bigint not null,effective_date date not null,
 source_result_id uuid references private.stockflow_economic_results(id),reverses_id uuid unique references private.stockflow_economic_events(id),
 request_id text not null unique,actor text not null,reason text not null,recorded_at timestamptz not null default now(),
 check((kind='reversal')=(reverses_id is not null))
);
create table private.stockflow_economic_acquisition_links (
 target_id uuid primary key references private.stockflow_economic_targets(id),
 purchase_line_id uuid not null unique references private.stockflow_economic_source_lines(id),
 company_id text not null, source_id text not null, line_key text not null,
 actor text not null, reason text not null, recorded_at timestamptz not null default now(),
 unique(company_id,source_id,line_key)
);
create table private.stockflow_economic_instrument_billings (
 target_id uuid primary key references private.stockflow_economic_acquisition_links(target_id),
 source_line_id uuid not null unique references private.stockflow_economic_source_lines(id),
 company_id text not null, source_id text not null, line_key text not null,
 actor text not null, reason text not null, recorded_at timestamptz not null default now(),
 unique(company_id,source_id,line_key)
);
create table private.stockflow_economic_acquisition_reviews (
 id uuid primary key default extensions.gen_random_uuid(),
 target_id uuid not null references private.stockflow_economic_acquisition_links(target_id),
 revision integer not null check(revision>0), voucher_id uuid not null references private.stockflow_economic_source_vouchers(id),
 purchase_line_id uuid references private.stockflow_economic_source_lines(id),
 amount_paise bigint not null check(amount_paise>=0), previous_amount_paise bigint not null check(previous_amount_paise>=0),
 capital_event_id uuid not null unique references private.stockflow_economic_events(id),
 actor text not null, reason text not null, recorded_at timestamptz not null default now(),
 unique(target_id,revision),unique(target_id,voucher_id)
);
create table private.stockflow_leakage_cases (
 id uuid primary key default extensions.gen_random_uuid(),target_id uuid not null references private.stockflow_economic_targets(id),title text not null check(length(btrim(title)) between 3 and 200),
 primary_reason text not null default 'unknown',reason_codes text[] not null default array['unknown'],
 confidence text not null default 'unknown' check(confidence in ('unknown','suspected','confirmed')),evidence_reference text not null default '',
 check(cardinality(reason_codes) between 1 and 13 and primary_reason=any(reason_codes) and reason_codes<@array['unknown','competitor_sourcing','lower_test_volume','stock_timing','downtime','service_issue','supply_shortage','pricing_pressure','contract_noncompliance','excess_foc','mapping_data_issue','product_substitution','other']),
 check(not('unknown'=any(reason_codes)) or reason_codes=array['unknown']),check(primary_reason<>'unknown' or confidence='unknown'),
 check(length(evidence_reference)<=2000 and (confidence<>'confirmed' or length(btrim(evidence_reference))>=3)),
 reason text not null,status text not null default 'detected' check(status in ('detected','qualified','in_progress','recovered','partially_recovered','no_recovery','dismissed')),
 owner text not null,due_date date,action text not null,outcome text not null default '',version integer not null default 1,
 opportunity_product_id text,window_from date,window_to date,potential_revenue_paise bigint,potential_gp_paise bigint,evaluation jsonb not null default '{}'::jsonb,
 created_by text not null,created_at timestamptz not null default now(),check(window_to is null or window_to>window_from),
 check(opportunity_product_id is null or (window_from is not null and window_to is not null)),
 exclude using gist(target_id with =,opportunity_product_id with =,daterange(window_from,window_to,'[)') with &&) where(opportunity_product_id is not null and status not in ('dismissed','no_recovery'))
);
create table private.stockflow_leakage_recovery_claims (
 id uuid primary key default extensions.gen_random_uuid(),case_id uuid not null references private.stockflow_leakage_cases(id),
 source_line_id uuid not null references private.stockflow_economic_source_lines(id),share_bps integer not null check(share_bps between 1 and 10000),reason text not null,actor text not null,recorded_at timestamptz not null default now(),unique(case_id,source_line_id)
);
create table private.stockflow_economic_import_exceptions (
 id bigint generated always as identity primary key,company_id text,source_id text,reason text not null,evidence jsonb not null,recorded_at timestamptz not null default now()
);
create table private.stockflow_economic_source_coverage (
 id uuid primary key default extensions.gen_random_uuid(),company_id text not null,window_from date not null,window_to date not null,
 source_version text not null,imported_at timestamptz not null default now(),check(window_to>window_from),unique(company_id,source_version)
);

-- Canonical Tally master evidence, rather than a second editable product master.
create table private.stockflow_economic_item_catalogs (
 id uuid primary key default extensions.gen_random_uuid(), company_id text not null,
 source_version text not null, observed_at timestamptz not null, content jsonb not null,
 imported_at timestamptz not null default clock_timestamp(), unique(company_id,source_version),
 check(jsonb_typeof(content->'groups')='array' and jsonb_typeof(content->'products')='array')
);
create index stockflow_economic_catalog_by_date on private.stockflow_economic_item_catalogs(company_id,observed_at desc);
create table private.stockflow_economic_item_group_mappings (
 id uuid primary key default extensions.gen_random_uuid(), company_id text not null,model_id text not null,group_id text not null,
 target_id uuid references private.stockflow_economic_targets(id),catalog_id uuid not null references private.stockflow_economic_item_catalogs(id),
 effect text not null check(effect in ('include','exclude')),effective_from date not null,effective_to date,
 reason text not null check(length(btrim(reason)) between 3 and 1000),verified_by text not null,recorded_at timestamptz not null default now(),
 check(effective_to is null or effective_to>effective_from)
);
create unique index stockflow_economic_group_mapping_identity on private.stockflow_economic_item_group_mappings(company_id,model_id,group_id,coalesce(target_id,'00000000-0000-0000-0000-000000000000'::uuid),effective_from);

create function private.stockflow_economic_group_products(p_catalog jsonb,p_group text) returns table(product_id text)
language sql stable set search_path=pg_catalog as $$
 with recursive descendants(id) as (
  select g->>'id' from jsonb_array_elements(p_catalog->'groups') g where g->>'id'=p_group
  union
  select g->>'id' from jsonb_array_elements(p_catalog->'groups') g join descendants d on g->>'parentId'=d.id
 ) select p->>'id' from jsonb_array_elements(p_catalog->'products') p where p->>'groupId' in(select id from descendants)
$$;
create function private.stockflow_economic_item_catalog_current(p_company text) returns boolean
language sql stable set search_path=pg_catalog,private as $$
 select exists(select 1 from private.stockflow_economic_item_catalogs c where c.company_id=p_company
  and not exists(select 1 from private.stockflow_economic_item_catalogs n where n.company_id=c.company_id and n.observed_at>c.observed_at)
  and not exists(select 1 from private.stockflow_economic_import_exceptions e where (e.company_id=p_company or e.company_id is null)
   and e.recorded_at>=c.imported_at and ((e.evidence->>'kind'='item_group_catalog' and coalesce((e.evidence->>'observedAt')::timestamptz>=c.observed_at,true)) or e.evidence->>'source'='connector_sync')))
$$;
create function private.stockflow_economic_validate_item_catalog(p_catalog jsonb) returns void
language plpgsql set search_path=pg_catalog as $$
declare node jsonb;cursor_id text;seen text[];
begin
 if jsonb_typeof(p_catalog->'groups') is distinct from 'array' or jsonb_typeof(p_catalog->'products') is distinct from 'array'
  or jsonb_array_length(p_catalog->'groups')>2000 or jsonb_array_length(p_catalog->'products')>10000 then raise exception 'Invalid or oversized canonical item-group catalog';end if;
 if exists(select 1 from jsonb_array_elements(p_catalog->'groups') g where length(btrim(coalesce(g->>'id',''))) not between 1 and 240 or length(btrim(coalesce(g->>'name',''))) not between 1 and 500)
  or exists(select 1 from jsonb_array_elements(p_catalog->'products') p where length(btrim(coalesce(p->>'id',''))) not between 1 and 240 or length(btrim(coalesce(p->>'name',''))) not between 1 and 500 or length(btrim(coalesce(p->>'unit',''))) not between 1 and 240)
  or exists(select 1 from jsonb_array_elements(p_catalog->'groups') g group by g->>'id' having count(*)>1)
  or exists(select 1 from jsonb_array_elements(p_catalog->'products') p group by p->>'id' having count(*)>1)
  or exists(select 1 from jsonb_array_elements(p_catalog->'products') p where p->>'groupId' is not null and not exists(select 1 from jsonb_array_elements(p_catalog->'groups') g where g->>'id'=p->>'groupId')) then raise exception 'Canonical item-group identity or membership is incomplete';end if;
 for node in select value from jsonb_array_elements(p_catalog->'groups') loop
  cursor_id:=node->>'id';seen:=array[]::text[];
  while cursor_id is not null loop
   if cursor_id=any(seen) or cardinality(seen)>=64 then raise exception 'Item-group hierarchy is cyclic or exceeds 64 levels';end if;
   seen:=array_append(seen,cursor_id);
   select g->>'parentId' into cursor_id from jsonb_array_elements(p_catalog->'groups') g where g->>'id'=cursor_id;
   if not found then raise exception 'Canonical parent item-group is missing';end if;
  end loop;
 end loop;
end$$;
create function private.stockflow_economic_mapping_effect(p_company text,p_model text,p_target uuid,p_product text,p_date date) returns text
language plpgsql stable set search_path=pg_catalog,private as $$
declare scope_id uuid;effect text;rule record;catalog jsonb;included boolean;excluded boolean;
begin
 foreach scope_id in array array[p_target,null::uuid] loop
  select case when m.effective_to is null or m.effective_to>p_date then m.effect else null end into effect
   from private.stockflow_economic_mappings m where m.company_id=p_company and m.model_id=p_model and m.product_id=p_product and m.target_id is not distinct from scope_id and m.effective_from<=p_date
   order by m.effective_from desc,m.recorded_at desc,m.id desc limit 1;
  if effect is not null then return effect;end if;
  included:=false;excluded:=false;
  if private.stockflow_economic_item_catalog_current(p_company) then
   for rule in select distinct on (m.group_id) m.* from private.stockflow_economic_item_group_mappings m
    where m.company_id=p_company and m.model_id=p_model and m.target_id is not distinct from scope_id and m.effective_from<=p_date
    order by m.group_id,m.effective_from desc,m.recorded_at desc,m.id desc loop
    if rule.effective_to is not null and rule.effective_to<=p_date then continue;end if;
    select c.content into catalog from private.stockflow_economic_item_catalogs c where c.company_id=p_company and private.stockflow_economic_business_date(c.observed_at)<=p_date order by c.observed_at desc,c.id desc limit 1;
    -- The initial reviewed catalog covers an explicitly backdated mapping start.
    -- Later observations change membership from their Indian business date only.
    if catalog is null then select c.content into catalog from private.stockflow_economic_item_catalogs c where c.id=rule.catalog_id;end if;
    if exists(select 1 from private.stockflow_economic_group_products(catalog,rule.group_id) p where p.product_id=p_product) then
     included:=included or rule.effect='include';excluded:=excluded or rule.effect='exclude';
    end if;
   end loop;
  end if;
  if excluded then return 'exclude';elsif included then return 'include';end if;
 end loop;
 return null;
end$$;
revoke all on function private.stockflow_economic_group_products(jsonb,text),private.stockflow_economic_item_catalog_current(text),private.stockflow_economic_validate_item_catalog(jsonb),private.stockflow_economic_mapping_effect(text,text,uuid,text,date) from public,anon,authenticated;

do $$declare t text;begin
 foreach t in array array['customer_identities','targets','group_members','mappings','item_catalogs','item_group_mappings','allocations','expectations','expectation_items','consumption_observations','policy_versions','audit','source_vouchers','source_lines','cost_verifications','cost_links','acquisition_links','instrument_billings','acquisition_reviews','line_reviews','runs','results','events','import_exceptions','source_coverage'] loop
  execute format('alter table private.stockflow_economic_%I enable row level security',t);
  execute format('revoke all on private.stockflow_economic_%I from public,anon,authenticated',t);
  execute format('create trigger no_delete before delete on private.stockflow_economic_%I for each row execute function private.prevent_business_delete()',t);
  if t not in ('targets','runs','group_members','allocations') then execute format('create trigger immutable before update on private.stockflow_economic_%I for each row execute function private.prevent_immutable_pricing_update()',t);end if;
 end loop;
 foreach t in array array['cases','recovery_claims'] loop
  execute format('alter table private.stockflow_leakage_%I enable row level security',t);
  execute format('revoke all on private.stockflow_leakage_%I from public,anon,authenticated',t);
  execute format('create trigger no_delete before delete on private.stockflow_leakage_%I for each row execute function private.prevent_business_delete()',t);
 end loop;
end$$;
create function private.stockflow_economic_membership_close_only() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if (to_jsonb(new)-'effective_to')<>(to_jsonb(old)-'effective_to') or old.effective_to is not null or new.effective_to is null then raise exception 'Membership history is immutable; only open membership closure is allowed' using errcode='55000';end if;
 return new;
end$$;
create trigger immutable before update on private.stockflow_economic_group_members for each row execute function private.stockflow_economic_membership_close_only();
create trigger immutable before update on private.stockflow_economic_allocations for each row execute function private.stockflow_economic_membership_close_only();
revoke all on function private.stockflow_economic_membership_close_only() from public,anon,authenticated;
create trigger evaluation_immutable before update of target_id,opportunity_product_id,window_from,window_to,potential_revenue_paise,potential_gp_paise,evaluation,created_by,created_at on private.stockflow_leakage_cases for each row execute function private.prevent_immutable_pricing_update();
create trigger immutable before update on private.stockflow_leakage_recovery_claims for each row execute function private.prevent_immutable_pricing_update();
commit;
