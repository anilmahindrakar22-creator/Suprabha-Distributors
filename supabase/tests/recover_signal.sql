-- Disposable fully migrated replay database only. All fixtures roll back.
begin;
insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('recover-signal-test-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status) values
 ('recover-manager@test.local','management','active'),('recover-admin@test.local','administrator','active'),
 ('recover-sales@test.local','sales','active'),('recover-operations@test.local','operations','active');
insert into private.stockflow_customers(id,name,tally_key,created_by_email)
select ('b2d20000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'Recover Lab '||n,'RECOVER-LAB-'||n,'recover-manager@test.local' from generate_series(1,8) n;

create function pg_temp.recover_id(n integer) returns uuid language sql immutable as $$
 select ('b2d20000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
select 'recover-company','RECOVER-LAB-'||n,pg_temp.recover_id(n),'recover-manager@test.local' from generate_series(1,8) n;

create function pg_temp.recover_sale(n integer,m date,net bigint,p_source text default null,
 p_revision bigint default 1,p_kind text default 'sale',p_cancelled boolean default false,
 p_company text default 'recover-company') returns void language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,
  customer_source_id,kind,cancelled,evidence)
 values(p_company,coalesce(p_source,'recover-'||n||'-'||m),p_revision,m,'RECOVER-LAB-'||n,p_kind,p_cancelled,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(voucher,'1','RECOVER-REAGENT',1,'Nos',net,'{}');
end$$;
create function pg_temp.recover_certify(p_company text,p_version text) returns void language plpgsql as $$
declare start_date date:=(date_trunc('month',current_date)-interval '9 months')::date;
 end_date date:=date_trunc('month',current_date)::date; months date[]; m date; net bigint;
begin
 -- Same real coverage + independent matching control setup as today_decisions.sql.
 select array_agg((start_date+n*interval '1 month')::date order by n) into months from generate_series(0,8) n;
 insert into private.stockflow_economic_source_coverage(company_id,window_from,window_to,source_version,imported_at)
 values(p_company,start_date,end_date,p_version,clock_timestamp()+interval '1 day');
 insert into private.stockflow_sales_control_imports(company_id,source_version,valid_months,imported_at)
 values(p_company,p_version,months,clock_timestamp()+interval '1 day');
 foreach m in array months loop
  net:=(private.stockflow_sales_reconciliation(p_company,m)->>'appNetPaise')::bigint;
  insert into private.stockflow_sales_control_totals(company_id,month,kind,source_key,net_paise,source_version,imported_at)
  values(p_company,m,'sales_ledger','sales',net,p_version,clock_timestamp()+interval '1 day');
 end loop;
end$$;
create function pg_temp.recover_row(n integer) returns jsonb language sql as $$
 select value from jsonb_array_elements(private.stockflow_recover_read(current_date)->'rows')
 where value->>'customerId'=pg_temp.recover_id(n)::text;
$$;
create function pg_temp.recover_command(action text,payload jsonb) returns jsonb language sql as $$
 select public.stockflow_opportunity_gateway('recover-signal-test-key','recover-manager@test.local',action,payload);
$$;
create function pg_temp.recover_error(payload jsonb,state text) returns void language plpgsql as $$
begin
 begin
  perform pg_temp.recover_command('open_opportunity',payload);
 exception when others then
  if sqlstate=state then return;end if;
  raise;
 end;
 raise exception 'Expected SQLSTATE %',state;
end$$;

do $checks$
declare
 window_end date:=date_trunc('month',current_date)::date;
 start_date date:=(window_end-interval '9 months')::date;
 m date; i integer; n integer; net bigint; data jsonb; row_data jsonb; policy jsonb;
 payload jsonb; opened jsonb; repeated jsonb; opportunity uuid; role_name text;
 expected jsonb; actual jsonb; definition text; suffix text;
begin
 policy:=private.stockflow_recover_policy_read();
 if policy->>'policyVersion' is distinct from 'recover-v1'
  or (policy-'note'-'enteredBy'-'enteredAt') is distinct from
   '{"version":1,"policyVersion":"recover-v1","baselineMonths":6,"recentMonths":3,"minBaselinePaise":2000000,"minDropBps":3000,"minDropPaise":1000000}'::jsonb
  then raise exception 'Recover policy differs: %',policy;end if;
 for i in 0..8 loop
  m:=(start_date+i*interval '1 month')::date;
  for n in 1..8 loop
   net:=case n
    when 1 then case when i<6 then 6000000 else 3900000 end
    when 2 then case when i<6 then 6000000 else 4500000 end
    when 3 then case when i<6 then 2000000 else 1200000 end
    when 4 then case when i=0 then 40000000 when i<6 then 4000000 else 2000000 end
    when 5 then case when i<6 then 4000000 else 0 end
    when 6 then case when i<2 then 0 when i<6 then (i-1)*2000000 else 1000000 end
    when 7 then case when i<6 then 4000000 else 2000000 end
    when 8 then case when i<6 then 2000000 else 1000000 end end;
   if net=0 then continue;end if; -- Intentionally NO voucher/line in these months.
   if n=1 then
    -- Signed wallet definition: latest revision, sales, returns and credits.
    perform pg_temp.recover_sale(n,m,90000000,'recover-revised-'||m,1);
    perform pg_temp.recover_sale(n,m,net+1000000,'recover-revised-'||m,2);
    perform pg_temp.recover_sale(n,m,-600000,'recover-return-'||m,1,'return');
    perform pg_temp.recover_sale(n,m,-400000,'recover-credit-'||m,1,'credit');
    perform pg_temp.recover_sale(n,m,90000000,'recover-cancelled-'||m,1);
    perform pg_temp.recover_sale(n,m,90000000,'recover-cancelled-'||m,2,'sale',true);
    perform pg_temp.recover_sale(n,m,90000000,'recover-purchase-'||m,1,'purchase');
    perform pg_temp.recover_sale(n,m,90000000,'recover-other-'||m,1,'non_economic');
    perform pg_temp.recover_sale(99,m,90000000,'recover-unlinked-'||m);
   else
    perform pg_temp.recover_sale(n,m,net);
   end if;
  end loop;
 end loop;
 perform pg_temp.recover_sale(1,start_date-1,90000000);
 perform pg_temp.recover_sale(1,window_end,90000000);
 perform pg_temp.recover_certify('recover-company','recover-certified');
 data:=private.stockflow_recover_read(current_date);
 if data->>'certified' is distinct from 'true' or data->'reason' is distinct from 'null'::jsonb
  or data->'months' is distinct from jsonb_build_object('from',start_date,'to',window_end-1)
  then raise exception 'Recover certification/window failed: %',data;end if;

 -- R1: ₹60k → ₹39k is a 35% fall and ₹21k/month (above ₹15k).
 row_data:=pg_temp.recover_row(1);
 if (row_data->>'baselinePaise')::bigint is distinct from 6000000::bigint
  or (row_data->>'recentPaise')::bigint is distinct from 3900000::bigint
  or (row_data->>'dropPaise')::bigint is distinct from 2100000::bigint then raise exception 'R1 drop: %',row_data;end if;
 raise notice 'PASS Recover R1: 35 percent drop, exact value and wallet sales definition';

 if pg_temp.recover_row(2) is not null or pg_temp.recover_row(3) is not null then raise exception 'R2 sub-threshold lab signalled';end if;
 if pg_temp.recover_row(8)->>'dropPaise' is distinct from '1000000' then raise exception 'R2 inclusive absolute thresholds failed';end if;
 raise notice 'PASS Recover R2: percentage and rupee gates, inclusive thresholds';

 -- R3: One dated coverage exception invalidates just one month for all companies.
 begin
  insert into private.stockflow_economic_import_exceptions(reason,evidence,recorded_at)
  values('Recover missing month',jsonb_build_object('date',start_date+1),clock_timestamp()+interval '2 days');
  data:=private.stockflow_recover_read(current_date);
  if data->>'certified' is distinct from 'false' or data->'rows' is distinct from '[]'::jsonb
   or data->>'reason' is distinct from 'Recover signals need 9 certified months' then raise exception 'R3 failed closed: %',data;end if;
  data:=public.stockflow_today_gateway('recover-signal-test-key','recover-manager@test.local','get_today','{}');
  if data->'recover' is distinct from '{"certified":false,"reason":"Recover signals need 9 certified months"}'::jsonb
   or exists(select 1 from jsonb_array_elements(data#>'{grow,rows}') where value->>'type'='recover') then raise exception 'R3 Today uncertified';end if;
  raise exception 'Undo coverage exception' using errcode='PT001';
 exception when sqlstate 'PT001' then null;
 end;
 -- Coverage alone cannot certify mismatching sales controls.
 begin
  insert into private.stockflow_sales_control_imports(company_id,source_version,valid_months,imported_at)
  values('recover-company','recover-mismatch',array[start_date],clock_timestamp()+interval '2 days');
  insert into private.stockflow_sales_control_totals(company_id,month,kind,source_key,net_paise,source_version)
  values('recover-company',start_date,'sales_ledger','sales',1,'recover-mismatch');
  if pg_temp.recover_row(1) is not null then raise exception 'R3 reconciliation mismatch admitted';end if;
  raise exception 'Undo mismatching control' using errcode='PT001';
 exception when sqlstate 'PT001' then null;
 end;
 -- A different company's failure excludes only its linked lab, not healthy labs.
 begin
  insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
  values('recover-second-company','RECOVER-LAB-7',pg_temp.recover_id(7),'recover-manager@test.local');
  data:=private.stockflow_recover_read(current_date);
  if data->>'certified' is distinct from 'true' or pg_temp.recover_row(7) is not null or pg_temp.recover_row(1) is null
   then raise exception 'R3 every-linked-company eligibility';end if;
  for i in 0..8 loop
   perform pg_temp.recover_sale(7,(start_date+i*interval '1 month')::date,case when i<6 then 1000000 else 500000 end,
    'recover-second-'||i,1,'sale',false,'recover-second-company');
  end loop;
  perform pg_temp.recover_certify('recover-second-company','recover-second-certified');
  if pg_temp.recover_row(7)->>'baselinePaise' is distinct from '5000000'
   or pg_temp.recover_row(7)->>'dropPaise' is distinct from '2500000' then raise exception 'R3 company totals not combined';end if;
  raise exception 'Undo second company' using errcode='PT001';
 exception when sqlstate 'PT001' then null;
 end;
 raise notice 'PASS Recover R3: coverage, reconciliation and every linked company fail closed';

 payload:=jsonb_build_object('requestId','recover-manual-open-0001','customerId',pg_temp.recover_id(1),'kind','recover','reason','Recover test follow-up');
 opened:=pg_temp.recover_command('open_opportunity',payload);
 opportunity:=(opened->>'id')::uuid;
 if pg_temp.recover_row(1) is not null then raise exception 'R4 open recover did not suppress';end if;
 perform pg_temp.recover_error(payload||'{"requestId":"recover-conflict-0001"}','PT409');
 perform pg_temp.recover_command('close_opportunity',jsonb_build_object('requestId','recover-manual-close-0001','opportunityId',opportunity,'outcome','dropped','reason','Reassess current signal'));
 if pg_temp.recover_row(1) is null then raise exception 'R4 closure did not restore';end if;
 begin
  perform pg_temp.recover_command('open_opportunity',payload||'{"requestId":"recover-defend-open-0001","kind":"defend"}');
  if pg_temp.recover_row(1) is not null then raise exception 'R4 open defend did not suppress';end if;
  raise exception 'Undo defend opportunity' using errcode='PT001';
 exception when sqlstate 'PT001' then null;
 end;
 raise notice 'PASS Recover R4: open recover/defend suppression, PT409 and closure restoration';

 row_data:=pg_temp.recover_row(4);
 if row_data->>'baselinePaise' is distinct from '4000000' or row_data->>'dropPaise' is distinct from '2000000'
  then raise exception 'R5 median baseline: %',row_data;end if;
 raise notice 'PASS Recover R5: median resists one huge baseline month';

 payload:=jsonb_build_object('requestId','recover-signal-open-0001','customerId',pg_temp.recover_id(1),'kind','recover',
  'divisionCode',null,'origin','defend_signal','reason','Visit the lab about falling sales');
 opened:=pg_temp.recover_command('open_opportunity',payload);
 repeated:=pg_temp.recover_command('open_opportunity',payload);
 if opened is distinct from repeated or opened->>'origin' is distinct from 'defend_signal'
  or strpos(opened->>'openedReason','policyVersion=recover-v1')=0
  or (select count(*) from private.stockflow_commercial_opportunities where customer_id=pg_temp.recover_id(1) and origin='defend_signal')<>1
  or (select count(*) from private.stockflow_economic_audit where action='open_opportunity' and entity_id=(opened->>'id')::uuid)<>1
  then raise exception 'R6 creation/replay/policy/audit: %',opened;end if;
 if not exists(select 1 from private.stockflow_commercial_opportunities where id=(opened->>'id')::uuid and opened_reason=opened->>'openedReason')
  then raise exception 'R6 stored opening reason';end if;
 perform pg_temp.recover_error(payload||jsonb_build_object('requestId','recover-no-signal-0002','customerId',pg_temp.recover_id(2)),'22023');
 perform pg_temp.recover_error(payload||jsonb_build_object('requestId','recover-wrong-kind-0004','customerId',pg_temp.recover_id(4),'kind','capture'),'22023');
 perform pg_temp.recover_command('close_opportunity',jsonb_build_object('requestId','recover-signal-close-0001','opportunityId',opened->>'id','outcome','dropped','reason','Restore test signal'));
 raise notice 'PASS Recover R6: defend_signal creation, policy, idempotency, audit and invalid signal rejection';

 foreach role_name in array array['sales','operations'] loop
  begin
   perform public.stockflow_today_gateway('recover-signal-test-key','recover-'||role_name||'@test.local','get_today','{}');
   raise exception 'R7 unauthorized Today: %',role_name;
  exception when sqlstate 'PT403' then null;
  end;
 end loop;
 foreach role_name in array array['manager','admin'] loop
  data:=public.stockflow_today_gateway('recover-signal-test-key','recover-'||role_name||'@test.local','get_today','{}');
  if data->'recover' is distinct from '{"certified":true,"reason":null}'::jsonb then raise exception 'R7 Today status';end if;
  select value into row_data from jsonb_array_elements(data#>'{grow,rows}') where value->>'type'='recover' and value#>>'{target,customerId}'=pg_temp.recover_id(1)::text;
  if row_data is distinct from jsonb_build_object('type','recover','title','Recover Lab 1','subtitle',null,
   'baselinePaisePerMonth',6000000,'recentPaisePerMonth',3900000,'valuePaisePerMonth',2100000,'valueKind','lost',
   'due',null,'target',jsonb_build_object('kind','lab','customerId',pg_temp.recover_id(1)),'rankReason','value_known')
   then raise exception 'R7 Today recover payload: %',row_data;end if;
  if exists(select 1 from jsonb_array_elements(data#>'{grow,rows}') where value->>'type'='recover' and value::text ~* '"[^"]*(cost|margin)[^"]*"\s*:')
   then raise exception 'R7 private money keys';end if;
 end loop;
 definition:=replace(pg_get_functiondef('public.stockflow_today_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
 suffix:='private.stockflow_recover_read(v_today)';
 if (length(definition)-length(replace(definition,suffix,'')))/length(suffix)<>1
  or strpos(definition,suffix)<strpos(definition,'Wallet management access required') then raise exception 'R7 read count or role gate';end if;
 raise notice 'PASS Recover R7: management/admin payloads, sales/operations denied, one read and no cost/margin keys';

 row_data:=pg_temp.recover_row(5);
 if row_data->>'baselinePaise' is distinct from '4000000' or row_data->>'recentPaise' is distinct from '0'
  or row_data->>'dropPaise' is distinct from '4000000' then raise exception 'R8 no recent lines: %',row_data;end if;
 row_data:=pg_temp.recover_row(6);
 -- Sorted baseline [0,0,₹20k,₹40k,₹60k,₹80k], median exactly ₹30k.
 if row_data->>'baselinePaise' is distinct from '3000000' or row_data->>'dropPaise' is distinct from '2000000'
  then raise exception 'R8 zero baseline months: %',row_data;end if;
 data:=private.stockflow_recover_read(current_date);
 select jsonb_agg(value->>'customerId' order by ordinality),
  jsonb_agg(value->>'customerId' order by (value->>'dropPaise')::numeric desc,value->>'customerId')
 into actual,expected from jsonb_array_elements(data->'rows') with ordinality;
 if actual is distinct from expected then raise exception 'R8 deterministic ordering';end if;
 raise notice 'PASS Recover R8: zero recent lines, zero baseline months and deterministic order';

 foreach role_name in array array['anon','authenticated','service_role'] loop
  if has_table_privilege(role_name,'private.stockflow_recover_policies','SELECT')
   or has_function_privilege(role_name,'private.stockflow_recover_policy_read()','EXECUTE')
   or has_function_privilege(role_name,'private.stockflow_recover_read(date)','EXECUTE') then raise exception 'Recover private grant: %',role_name;end if;
 end loop;
 if not (select relrowsecurity from pg_class where oid='private.stockflow_recover_policies'::regclass) then raise exception 'Recover missing RLS';end if;
 begin
  update private.stockflow_recover_policies set min_drop_bps=1;
  raise exception 'Recover policy update allowed';
 exception when sqlstate '55000' then null;
 end;
 begin
  delete from private.stockflow_recover_policies;
  raise exception 'Recover policy delete allowed';
 exception when sqlstate '42501' then null;
 end;
 raise notice 'PASS Recover policy: append-only, RLS and private grants';
end$checks$;
rollback;
