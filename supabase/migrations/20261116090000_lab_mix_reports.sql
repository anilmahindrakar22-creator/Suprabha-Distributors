begin;

create table private.stockflow_lab_areas (
 code text primary key, name text not null, sort_order integer not null,
 band_kind text not null check (band_kind in ('immuno','generic')),
 brands_hint text, active boolean not null default true
);
insert into private.stockflow_lab_areas(code,name,sort_order,band_kind,brands_hint) values
 ('HAEM','Haematology (CBC)',1,'generic','Nihon Kohden, Sysmex'),
 ('BIOCHEM','Biochemistry',2,'generic','DiaSys, Agappe, Meril'),
 ('IMMUNO','Hormones / immunoassay',3,'immuno','bioMérieux (VIDAS), Meril, DiaSys (CLIA)'),
 ('HBA1C','HbA1c',4,'generic',null),
 ('URINE','Urine',5,'generic','Arkray, Sysmex'),
 ('COAG','Coagulation',6,'generic','Sysmex, Tulip'),
 ('RAPID','Rapid tests / serology',7,'generic','J Mitra, Tulip'),
 ('CULTURE','Culture',8,'generic','bioMérieux');
create table private.stockflow_lab_tests (
 code text primary key, name text not null, sort_order integer not null, active boolean not null default true
);
insert into private.stockflow_lab_tests(code,name,sort_order) values
 ('TSH','TSH',1),('FT4','FT4',2),('FT3_T3','FT3/T3',3),('VITD','Vitamin D',4),
 ('B12','B12',5),('FERRITIN','Ferritin',6),('PROLACTIN','Prolactin',7),
 ('BHCG','Beta-hCG',8),('PSA','PSA',9),('PCT','Procalcitonin',10),('OTHER','Other',11);
create table private.stockflow_lab_panels (
 code text primary key, name text not null, sort_order integer not null, active boolean not null default true
);
insert into private.stockflow_lab_panels(code,name,sort_order) values
 ('FERTILITY','Fertility',1),('VITD_B12','Vitamin D/B12',2),('CARDIAC','Cardiac',3),
 ('TUMOUR','Tumour markers',4),('INFECTIOUS','Infectious',5),('OTHER','Other',6);

create function private.stockflow_lab_bands(p_kind text) returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select case p_kind
  when 'immuno' then '[{"min":1,"max":14},{"min":15,"max":30},{"min":31,"max":60},{"min":61,"max":null}]'::jsonb
  when 'generic' then '[{"min":1,"max":20},{"min":21,"max":50},{"min":51,"max":100},{"min":101,"max":null}]'::jsonb
  when 'busiest' then '[{"min":1,"max":3},{"min":4,"max":8},{"min":9,"max":null}]'::jsonb end
$$;
revoke all on function private.stockflow_lab_bands(text) from public,anon,authenticated,service_role;

create table private.stockflow_lab_mix_reports (
 id uuid primary key default extensions.gen_random_uuid(),
 customer_id uuid not null references private.stockflow_customers(id),
 copied_from uuid references private.stockflow_lab_mix_reports(id),
 busiest_test_code text references private.stockflow_lab_tests(code),
 busiest_min integer, busiest_max integer, busiest_exact boolean,
 reported_by text not null, reported_at timestamptz not null default clock_timestamp(),
 constraint stockflow_lab_mix_reports_busiest_rule check (
  (busiest_test_code is null and busiest_min is null and busiest_max is null and busiest_exact is null)
  or (busiest_test_code is not null and busiest_min is not null and busiest_exact is not null
   and (busiest_max is null or busiest_max>=busiest_min)))
);
create index stockflow_lab_mix_reports_customer_idx on private.stockflow_lab_mix_reports(customer_id,reported_at desc,id desc);
create table private.stockflow_lab_mix_report_areas (
 report_id uuid references private.stockflow_lab_mix_reports(id),
 area_code text references private.stockflow_lab_areas(code),
 status text not null check (status in ('in_house','sends_out','not_done')),
 min_per_day integer, max_per_day integer, exact boolean not null default false,
 primary key(report_id,area_code),
 constraint stockflow_lab_mix_report_areas_status_rule check (
  (status='in_house' and min_per_day is not null and min_per_day>=1 and (max_per_day is null or max_per_day>=min_per_day))
  or (status in ('sends_out','not_done') and min_per_day is null and max_per_day is null and not exact))
);
create table private.stockflow_lab_mix_report_panels (
 report_id uuid references private.stockflow_lab_mix_reports(id),
 panel_code text references private.stockflow_lab_panels(code),
 status text not null check (status in ('in_house','sent_out','not_offered')),
 primary key(report_id,panel_code)
);
create table private.stockflow_lab_mix_policies (
 version integer primary key,
 clia_cutoff_per_day integer not null check (clia_cutoff_per_day between 1 and 1000),
 pack_waste_per_day integer not null check (pack_waste_per_day between 1 and 1000),
 stale_after_days integer not null check (stale_after_days between 7 and 730),
 recorded_by text not null, recorded_at timestamptz not null default clock_timestamp()
);
insert into private.stockflow_lab_mix_policies(version,clia_cutoff_per_day,pack_waste_per_day,stale_after_days,recorded_by)
 values(1,15,4,90,'system');

do $protect$
declare v_table text;
begin
 foreach v_table in array array['stockflow_lab_areas','stockflow_lab_tests','stockflow_lab_panels',
  'stockflow_lab_mix_reports','stockflow_lab_mix_report_areas','stockflow_lab_mix_report_panels','stockflow_lab_mix_policies'] loop
  execute format('alter table private.%I enable row level security',v_table);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',v_table);
 end loop;
 foreach v_table in array array['stockflow_lab_mix_reports','stockflow_lab_mix_report_areas','stockflow_lab_mix_report_panels','stockflow_lab_mix_policies'] loop
  execute format('create trigger %I before delete on private.%I for each row execute function private.prevent_business_delete()',v_table||'_no_delete',v_table);
  execute format('create trigger %I before update on private.%I for each row execute function private.prevent_immutable_pricing_update()',v_table||'_immutable',v_table);
 end loop;
end $protect$;

create function private.stockflow_lab_mix_policy_read() returns jsonb
language sql stable security definer set search_path=pg_catalog,private,extensions as $$
 select jsonb_build_object('version',version,'cliaCutoffPerDay',clia_cutoff_per_day,
  'packWastePerDay',pack_waste_per_day,'staleAfterDays',stale_after_days)
 from private.stockflow_lab_mix_policies order by version desc limit 1
$$;
revoke all on function private.stockflow_lab_mix_policy_read() from public,anon,authenticated,service_role;

-- A single validator for area and busiest counts, including exact JSON types.
create function private.stockflow_lab_mix_volume(p_value jsonb,p_kind text) returns jsonb
language plpgsql immutable set search_path=pg_catalog,private,extensions as $$
declare v_exact numeric; v_band jsonb;
begin
 if jsonb_typeof(p_value) is distinct from 'object' then
  raise exception 'Invalid lab mix report' using errcode='22023';
 end if;
 if p_value ? 'exact' then
  if p_value-'exact'<>'{}'::jsonb or jsonb_typeof(p_value->'exact') is distinct from 'number' then
   raise exception 'Invalid lab mix report' using errcode='22023';
  end if;
  v_exact:=(p_value->>'exact')::numeric;
  if v_exact<>trunc(v_exact) or v_exact not between 1 and 100000 then
   raise exception 'Invalid lab mix report' using errcode='22023';
  end if;
  return jsonb_build_object('min',v_exact::integer,'max',v_exact::integer,'exact',true);
 end if;
 select b.value into v_band from jsonb_array_elements(private.stockflow_lab_bands(p_kind)) b where b.value=p_value;
 if not found then
  raise exception 'Invalid lab mix report' using errcode='22023';
 end if;
 return v_band||jsonb_build_object('exact',false);
end$$;
revoke all on function private.stockflow_lab_mix_volume(jsonb,text) from public,anon,authenticated,service_role;

create function private.stockflow_record_lab_mix(p_actor text,p_roles text[],p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,private,extensions as $$
declare v_customer uuid; v_report uuid; v_size uuid; v_item jsonb; v_volume jsonb; v_kind text;
 v_areas jsonb:='[]'; v_panels jsonb:='[]'; v_busiest jsonb; v_seen text[]:='{}'; v_immuno boolean:=false;
begin
 if not coalesce(p_roles && array['administrator','management','sales']::text[],false) then
  raise exception 'Lab mix access required' using errcode='PT403';
 end if;
 if jsonb_typeof(p_payload) is distinct from 'object'
  or p_payload-array['customerId','areas','busiest','panels','labSize']<>'{}'::jsonb
  or jsonb_typeof(p_payload->'customerId') is distinct from 'string'
  or (p_payload->>'customerId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or coalesce(jsonb_typeof(p_payload->'areas'),'null') not in ('array','null')
  or coalesce(jsonb_typeof(p_payload->'panels'),'null') not in ('array','null')
  or coalesce(jsonb_typeof(p_payload->'busiest'),'null') not in ('object','null') then
  raise exception 'Invalid lab mix report' using errcode='22023';
 end if;
 for v_item in select value from jsonb_array_elements(coalesce(nullif(p_payload->'areas','null'::jsonb),'[]'::jsonb)) loop
  if jsonb_typeof(v_item) is distinct from 'object' then raise exception 'Invalid lab mix report' using errcode='22023';end if;
  if v_item-array['area','status','min','max','exact']<>'{}'::jsonb
   or jsonb_typeof(v_item->'area') is distinct from 'string'
   or jsonb_typeof(v_item->'status') is distinct from 'string'
   or v_item->>'status' not in ('in_house','sends_out','not_done')
   or v_item->>'area'=any(v_seen) then raise exception 'Invalid lab mix report' using errcode='22023';end if;
  select band_kind into v_kind from private.stockflow_lab_areas where code=v_item->>'area' and active;
  if not found then raise exception 'Invalid lab mix report' using errcode='22023';end if;
  v_seen:=array_append(v_seen,v_item->>'area');
  if v_item->>'status'='in_house' then
   v_volume:=private.stockflow_lab_mix_volume(v_item-array['area','status'],v_kind);
   if v_item->>'area'='IMMUNO' then v_immuno:=true;end if;
  else
   if v_item ?| array['min','max','exact'] then raise exception 'Invalid lab mix report' using errcode='22023';end if;
   v_volume:=jsonb_build_object('min',null,'max',null,'exact',false);
  end if;
  v_areas:=v_areas||jsonb_build_array(v_item||v_volume);
 end loop;
 if coalesce(jsonb_typeof(p_payload->'busiest'),'null')<>'null' then
  v_item:=p_payload->'busiest';
  if not v_immuno or jsonb_typeof(v_item->'test') is distinct from 'string'
   or not exists(select 1 from private.stockflow_lab_tests where code=v_item->>'test' and active) then
   raise exception 'Invalid lab mix report' using errcode='22023';
  end if;
  v_busiest:=jsonb_build_object('test',v_item->>'test')||private.stockflow_lab_mix_volume(v_item-'test','busiest');
 end if;
 v_seen:='{}';
 for v_item in select value from jsonb_array_elements(coalesce(nullif(p_payload->'panels','null'::jsonb),'[]'::jsonb)) loop
  if jsonb_typeof(v_item) is distinct from 'object' then raise exception 'Invalid lab mix report' using errcode='22023';end if;
  if v_item-array['panel','status']<>'{}'::jsonb
   or jsonb_typeof(v_item->'panel') is distinct from 'string'
   or jsonb_typeof(v_item->'status') is distinct from 'string'
   or v_item->>'status' not in ('in_house','sent_out','not_offered')
   or v_item->>'panel'=any(v_seen)
   or not exists(select 1 from private.stockflow_lab_panels where code=v_item->>'panel' and active) then
   raise exception 'Invalid lab mix report' using errcode='22023';
  end if;
  v_seen:=array_append(v_seen,v_item->>'panel');v_panels:=v_panels||jsonb_build_array(v_item);
 end loop;
 if jsonb_array_length(v_areas)+jsonb_array_length(v_panels)=0 and v_busiest is null then
  raise exception 'Invalid lab mix report' using errcode='22023';
 end if;
 v_customer:=(p_payload->>'customerId')::uuid;
 perform 1 from private.stockflow_customers where id=v_customer and active for update;
 if not found then raise exception 'Invalid lab mix report' using errcode='22023';end if;
 insert into private.stockflow_lab_mix_reports(customer_id,busiest_test_code,busiest_min,busiest_max,busiest_exact,reported_by)
 values(v_customer,v_busiest->>'test',(v_busiest->>'min')::integer,(v_busiest->>'max')::integer,(v_busiest->>'exact')::boolean,p_actor)
 returning id into v_report;
 insert into private.stockflow_lab_mix_report_areas(report_id,area_code,status,min_per_day,max_per_day,exact)
 select v_report,value->>'area',value->>'status',(value->>'min')::integer,(value->>'max')::integer,(value->>'exact')::boolean from jsonb_array_elements(v_areas);
 insert into private.stockflow_lab_mix_report_panels(report_id,panel_code,status)
 select v_report,value->>'panel',value->>'status' from jsonb_array_elements(v_panels);
 if coalesce(jsonb_typeof(p_payload->'labSize'),'null')<>'null' then
  v_size:=(private.stockflow_record_lab_size(p_actor,p_roles,(p_payload->'labSize')||jsonb_build_object('customerId',v_customer))->>'reportId')::uuid;
 end if;
 return jsonb_build_object('ok',true,'reportId',v_report,'labSizeReportId',v_size);
end$$;
revoke all on function private.stockflow_record_lab_mix(text,text[],jsonb) from public,anon,authenticated,service_role;

create function private.stockflow_confirm_lab_mix(p_actor text,p_roles text[],p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,private,extensions as $$
declare v_customer uuid; v_previous uuid; v_latest private.stockflow_lab_mix_reports%rowtype; v_report uuid;
begin
 if not coalesce(p_roles && array['administrator','management','sales']::text[],false) then
  raise exception 'Lab mix access required' using errcode='PT403';
 end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or p_payload-array['customerId','previousReportId']<>'{}'::jsonb
  or jsonb_typeof(p_payload->'customerId') is distinct from 'string' or jsonb_typeof(p_payload->'previousReportId') is distinct from 'string'
  or (p_payload->>'customerId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or (p_payload->>'previousReportId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise exception 'Invalid lab mix report' using errcode='22023';
 end if;
 v_customer:=(p_payload->>'customerId')::uuid;v_previous:=(p_payload->>'previousReportId')::uuid;
 perform 1 from private.stockflow_customers where id=v_customer and active for update;
 if not found then raise exception 'Invalid lab mix report' using errcode='22023';end if;
 select * into v_latest from private.stockflow_lab_mix_reports where customer_id=v_customer order by reported_at desc,id desc limit 1;
 if v_latest.id is distinct from v_previous then raise exception 'Lab mix changed; reload' using errcode='PT409';end if;
 insert into private.stockflow_lab_mix_reports(customer_id,copied_from,busiest_test_code,busiest_min,busiest_max,busiest_exact,reported_by)
 values(v_customer,v_previous,v_latest.busiest_test_code,v_latest.busiest_min,v_latest.busiest_max,v_latest.busiest_exact,p_actor) returning id into v_report;
 insert into private.stockflow_lab_mix_report_areas(report_id,area_code,status,min_per_day,max_per_day,exact)
 select v_report,area_code,status,min_per_day,max_per_day,exact from private.stockflow_lab_mix_report_areas where report_id=v_previous;
 insert into private.stockflow_lab_mix_report_panels(report_id,panel_code,status)
 select v_report,panel_code,status from private.stockflow_lab_mix_report_panels where report_id=v_previous;
 return jsonb_build_object('ok',true,'reportId',v_report);
end$$;
revoke all on function private.stockflow_confirm_lab_mix(text,text[],jsonb) from public,anon,authenticated,service_role;

create function private.stockflow_set_lab_mix_policy(p_actor text,p_roles text[],p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,private,extensions as $$
declare v_key text; v_number numeric; v_version integer;
begin
 if not coalesce(p_roles && array['administrator','management']::text[],false) then
  raise exception 'Lab mix policy access required' using errcode='PT403';
 end if;
 if jsonb_typeof(p_payload) is distinct from 'object'
  or p_payload-array['expectedVersion','cliaCutoffPerDay','packWastePerDay','staleAfterDays']<>'{}'::jsonb then
  raise exception 'Invalid lab mix policy' using errcode='22023';
 end if;
 foreach v_key in array array['expectedVersion','cliaCutoffPerDay','packWastePerDay','staleAfterDays'] loop
  if jsonb_typeof(p_payload->v_key) is distinct from 'number' then raise exception 'Invalid lab mix policy' using errcode='22023';end if;
  v_number:=(p_payload->>v_key)::numeric;
  if v_number<>trunc(v_number) or (case v_key when 'expectedVersion' then v_number not between 1 and 2147483647
   when 'staleAfterDays' then v_number not between 7 and 730 else v_number not between 1 and 1000 end) then
   raise exception 'Invalid lab mix policy' using errcode='22023';
  end if;
 end loop;
 -- Serialize appenders before reading the latest version, including concurrent writers.
 lock table private.stockflow_lab_mix_policies in share row exclusive mode;
 select version into v_version from private.stockflow_lab_mix_policies order by version desc limit 1;
 if v_version<>(p_payload->>'expectedVersion')::numeric::integer then raise exception 'Lab mix policy changed; reload' using errcode='PT409';end if;
 insert into private.stockflow_lab_mix_policies(version,clia_cutoff_per_day,pack_waste_per_day,stale_after_days,recorded_by)
 values(v_version+1,(p_payload->>'cliaCutoffPerDay')::numeric::integer,(p_payload->>'packWastePerDay')::numeric::integer,(p_payload->>'staleAfterDays')::numeric::integer,p_actor);
 return jsonb_build_object('ok',true,'version',v_version+1);
end$$;
revoke all on function private.stockflow_set_lab_mix_policy(text,text[],jsonb) from public,anon,authenticated,service_role;

create function private.stockflow_lab_mix_read(p_customer uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,private,extensions as $$
 with latest as (select * from private.stockflow_lab_mix_reports where customer_id=p_customer order by reported_at desc,id desc limit 1),
 policy as (select * from private.stockflow_lab_mix_policies order by version desc limit 1),
 fitted as (
  select r.*,p.version,p.pack_waste_per_day,p.stale_after_days,
   case when a.status in ('not_done','sends_out') then 'none'
    when a.status='in_house' and a.max_per_day<p.clia_cutoff_per_day then 'vidas'
    when a.status='in_house' and a.min_per_day>=p.clia_cutoff_per_day then 'clia'
    when a.status='in_house' then 'check' else 'unknown' end as fit
  from latest r cross join policy p left join private.stockflow_lab_mix_report_areas a on a.report_id=r.id and a.area_code='IMMUNO'
 )
 select jsonb_build_object('reportId',r.id,'reportedBy',r.reported_by,'reportedOn',(r.reported_at at time zone 'Asia/Kolkata')::date,
  'stale',(r.reported_at at time zone 'Asia/Kolkata')::date<(current_timestamp at time zone 'Asia/Kolkata')::date-r.stale_after_days,
  'areas',coalesce((select jsonb_agg(jsonb_build_object('area',a.area_code,'name',l.name,'status',a.status,'min',a.min_per_day,'max',a.max_per_day,'exact',a.exact) order by l.sort_order,l.code)
   from private.stockflow_lab_mix_report_areas a join private.stockflow_lab_areas l on l.code=a.area_code where a.report_id=r.id),'[]'::jsonb),
  'busiest',case when r.busiest_test_code is null then null else jsonb_build_object('test',r.busiest_test_code,
   'name',(select name from private.stockflow_lab_tests where code=r.busiest_test_code),'min',r.busiest_min,'max',r.busiest_max,'exact',r.busiest_exact) end,
  'panels',coalesce((select jsonb_agg(jsonb_build_object('panel',a.panel_code,'name',l.name,'status',a.status) order by l.sort_order,l.code)
   from private.stockflow_lab_mix_report_panels a join private.stockflow_lab_panels l on l.code=a.panel_code where a.report_id=r.id),'[]'::jsonb),
  'fit',r.fit,'packWasteRisk',case when r.fit='clia' and r.busiest_test_code is not null then
   case when r.busiest_max<r.pack_waste_per_day then true when r.busiest_min>=r.pack_waste_per_day then false end end,'policyVersion',r.version)
 from fitted r
$$;
revoke all on function private.stockflow_lab_mix_read(uuid) from public,anon,authenticated,service_role;

create function private.stockflow_lab_mix_options() returns jsonb
language sql stable security definer set search_path=pg_catalog,private,extensions as $$
 select jsonb_build_object(
  'areas',coalesce((select jsonb_agg(jsonb_build_object('code',code,'name',name,'brandsHint',brands_hint,'bands',private.stockflow_lab_bands(band_kind)) order by sort_order,code) from private.stockflow_lab_areas where active),'[]'::jsonb),
  'tests',coalesce((select jsonb_agg(jsonb_build_object('code',code,'name',name) order by sort_order,code) from private.stockflow_lab_tests where active),'[]'::jsonb),
  'panels',coalesce((select jsonb_agg(jsonb_build_object('code',code,'name',name) order by sort_order,code) from private.stockflow_lab_panels where active),'[]'::jsonb),
  'busiestBands',private.stockflow_lab_bands('busiest'),'policy',private.stockflow_lab_mix_policy_read())
$$;
revoke all on function private.stockflow_lab_mix_options() from public,anon,authenticated,service_role;

-- Patch unique seams in live definitions, preserving changes from other packages.
do $patch$
declare definition text; old_text text; new_text text;
begin
 definition:=replace(pg_get_functiondef('public.stockflow_accounts_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
 old_text:=$old$'check_in','record_lab_size'$old$;
 new_text:=$new$'check_in','record_lab_size','record_lab_mix','confirm_lab_mix','set_lab_mix_policy'$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected accounts action anchor';end if;
 definition:=replace(definition,old_text,new_text);
 -- Authorize before a stored result can return, including after a role change.
 old_text:=$old$  v_key:=p_payload->>'idempotencyKey';$old$;
 new_text:=$new$  if (p_action in ('record_lab_mix','confirm_lab_mix') and not coalesce(v_roles && array['administrator','management','sales']::text[],false))
    or (p_action='set_lab_mix_policy' and not coalesce(v_roles && array['administrator','management']::text[],false)) then
    raise exception 'Lab mix access required' using errcode='PT403';
  end if;
$new$||old_text;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected accounts idempotency anchor';end if;
 definition:=replace(definition,old_text,new_text);
 -- These commands validate and lock their own customer; policy has no customer.
 old_text:=$old$    if jsonb_typeof(p_payload->'customerId') is distinct from 'string' or (p_payload->>'customerId') !~* v_uuid_pattern then
      raise exception 'Active customer required' using errcode='22023'; end if;
    v_customer:=(p_payload->>'customerId')::uuid;
    -- Also serializes first assignment/location writes, where no child row exists.
    perform 1 from private.stockflow_customers where id=v_customer and active for update;
    if not found then raise exception 'Active customer required' using errcode='22023'; end if;$old$;
 new_text:=$new$    if p_action not in ('record_lab_mix','confirm_lab_mix','set_lab_mix_policy') then
$new$||old_text||$new$
    end if;$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected accounts customer validation anchor';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old$    elsif p_action='record_lab_size' then$old$;
 new_text:=$new$    elsif p_action='record_lab_mix' then
      v_result:=private.stockflow_record_lab_mix(v_email,v_roles,p_payload-'idempotencyKey');
      v_id:=(v_result->>'reportId')::uuid;
    elsif p_action='confirm_lab_mix' then
      v_result:=private.stockflow_confirm_lab_mix(v_email,v_roles,p_payload-'idempotencyKey');
      v_id:=(v_result->>'reportId')::uuid;
    elsif p_action='set_lab_mix_policy' then
      v_result:=private.stockflow_set_lab_mix_policy(v_email,v_roles,p_payload-'idempotencyKey');
      v_id:=null;
    elsif p_action='record_lab_size' then$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected accounts command dispatch anchor';end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;

 definition:=replace(pg_get_functiondef('public.stockflow_customer_map_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
 old_text:=$old$ if v_count>0 then v_result:=v_result||jsonb_build_object('instruments',jsonb_build_object('rows',v_instruments,'moreCount',greatest(v_count-3,0)));end if;$old$;
 new_text:=old_text||$new$
 if v_roles && array['administrator','management','sales']::text[] then
  v_result:=v_result||jsonb_build_object('labMixOptions',private.stockflow_lab_mix_options());
  if private.stockflow_lab_mix_read(v_customer) is not null then
   v_result:=v_result||jsonb_build_object('labMix',private.stockflow_lab_mix_read(v_customer));
  end if;
 end if;$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected customer sheet instruments anchor';end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;
end $patch$;

commit;
