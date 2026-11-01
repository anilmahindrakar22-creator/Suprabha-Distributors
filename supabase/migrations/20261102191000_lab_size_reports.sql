begin;

create table private.stockflow_lab_size_reports (
 id uuid primary key default extensions.gen_random_uuid(),
 customer_id uuid not null references private.stockflow_customers(id),
 tests_per_day integer not null check (tests_per_day between 1 and 100000),
 stated_monthly_spend_paise bigint check (stated_monthly_spend_paise between 0 and 9000000000000000),
 basis text not null check (basis in ('lab_said','observed')),
 note text check (char_length(btrim(note)) between 3 and 500),
 reported_by text not null,
 reported_at timestamptz not null default clock_timestamp()
);
alter table private.stockflow_lab_size_reports enable row level security;
revoke all on private.stockflow_lab_size_reports from public,anon,authenticated,service_role;
create index stockflow_lab_size_reports_customer_idx on private.stockflow_lab_size_reports(customer_id,reported_at desc,id desc);
create trigger stockflow_lab_size_reports_no_delete before delete on private.stockflow_lab_size_reports
 for each row execute function private.prevent_business_delete();
create trigger stockflow_lab_size_reports_immutable before update on private.stockflow_lab_size_reports
 for each row execute function private.prevent_immutable_pricing_update();

create function private.stockflow_record_lab_size(p_actor text,p_roles text[],p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,private,extensions as $$
declare customer uuid; tests numeric; spend numeric; report uuid;
begin
 if not coalesce(p_roles && array['administrator','management','sales']::text[],false) then
  raise exception 'Lab size access required' using errcode='PT403';
 end if;
 if jsonb_typeof(p_payload) is distinct from 'object'
  or p_payload-array['customerId','testsPerDay','basis','statedMonthlySpendPaise','note']<>'{}'::jsonb
  or jsonb_typeof(p_payload->'customerId') is distinct from 'string'
  or (p_payload->>'customerId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(p_payload->'testsPerDay') is distinct from 'number'
  or jsonb_typeof(p_payload->'basis') is distinct from 'string'
  or (p_payload->>'basis') not in ('lab_said','observed')
  or coalesce(jsonb_typeof(p_payload->'statedMonthlySpendPaise'),'null') not in ('number','null')
  or coalesce(jsonb_typeof(p_payload->'note'),'null') not in ('string','null')
  or (p_payload->>'note' is not null and char_length(btrim(p_payload->>'note')) not between 3 and 500) then
  raise exception 'Invalid lab size report' using errcode='22023';
 end if;
 tests:=(p_payload->>'testsPerDay')::numeric;
 spend:=(p_payload->>'statedMonthlySpendPaise')::numeric;
 if tests<>trunc(tests) or tests not between 1 and 100000
  or (spend is not null and (spend<>trunc(spend) or spend not between 0 and 9000000000000000)) then
  raise exception 'Invalid lab size report' using errcode='22023';
 end if;
 customer:=(p_payload->>'customerId')::uuid;
 perform 1 from private.stockflow_customers where id=customer and active for update;
 if not found then raise exception 'Active customer required' using errcode='22023';end if;
 insert into private.stockflow_lab_size_reports(customer_id,tests_per_day,stated_monthly_spend_paise,basis,note,reported_by)
 values(customer,tests::integer,spend::bigint,p_payload->>'basis',btrim(p_payload->>'note'),p_actor) returning id into report;
 return jsonb_build_object('ok',true,'reportId',report);
end$$;
revoke all on function private.stockflow_record_lab_size(text,text[],jsonb) from public,anon,authenticated,service_role;

create function private.stockflow_lab_size_read(p_customer uuid,p_financial boolean) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('testsPerDay',r.tests_per_day,'basis',r.basis,'reportedBy',r.reported_by,
  'reportedOn',(r.reported_at at time zone 'Asia/Kolkata')::date)
  ||case when p_financial then coalesce((
    select jsonb_build_object('statedMonthlySpendPaise',s.stated_monthly_spend_paise,
      'spendReportedOn',(s.reported_at at time zone 'Asia/Kolkata')::date)
    from private.stockflow_lab_size_reports s where s.customer_id=p_customer and s.stated_monthly_spend_paise is not null
    order by s.reported_at desc,s.id desc limit 1
   ),'{}'::jsonb) else '{}'::jsonb end
 from private.stockflow_lab_size_reports r where r.customer_id=p_customer
 order by r.reported_at desc,r.id desc limit 1
$$;
revoke all on function private.stockflow_lab_size_read(uuid,boolean) from public,anon,authenticated,service_role;

-- Patch only unique seams in the live definitions, preserving subsequent changes.
do $patch$
declare definition text; old_text text; new_text text;
begin
 definition:=replace(pg_get_functiondef('public.stockflow_accounts_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
 old_text:=$old$'set_location','log_visit','check_in'$old$;
 new_text:=$new$'set_location','log_visit','check_in','record_lab_size'$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected accounts action anchor';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old$    elsif p_action='set_location' then$old$;
 new_text:=$new$    elsif p_action='record_lab_size' then
      v_result:=private.stockflow_record_lab_size(v_email,v_roles,p_payload-'idempotencyKey');
      v_id:=(v_result->>'reportId')::uuid;
    elsif p_action='set_location' then$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected accounts command dispatch anchor';end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;

 definition:=replace(pg_get_functiondef('public.stockflow_customer_map_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
 old_text:=$old$ if v_count>0 then v_result:=v_result||jsonb_build_object('instruments',jsonb_build_object('rows',v_instruments,'moreCount',greatest(v_count-3,0)));end if;$old$;
 new_text:=old_text||$new$
 if v_roles && array['administrator','management','sales'] and private.stockflow_lab_size_read(v_customer,v_financial) is not null then
  v_result:=v_result||jsonb_build_object('labSize',private.stockflow_lab_size_read(v_customer,v_financial));
 end if;
 v_result:=v_result||jsonb_build_object('labAccess',coalesce(v_roles && array['administrator','management','sales'],false));$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected customer sheet instruments anchor';end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;

 definition:=replace(pg_get_functiondef('private.stockflow_wallet_account_read(date,uuid)'::regprocedure),chr(13),'');
 old_text:=$old$'current',history->0,'history',history,'divisions',divisions)$old$;
 new_text:=$new$'current',history->0,'labSize',private.stockflow_lab_size_read(p_customer,true),'history',history,'divisions',divisions)$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected wallet account current anchor';end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;
end $patch$;

commit;
