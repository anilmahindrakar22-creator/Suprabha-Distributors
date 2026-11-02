begin;

alter table private.stockflow_lab_size_reports
 add column special_tests_per_month integer check (special_tests_per_month between 1 and 1000000);

-- Read the replayed definitions, preserving every other live patch and privilege.
do $patch$
declare definition text; old_text text; new_text text;
begin
 definition:=replace(pg_get_functiondef('private.stockflow_record_lab_size(text,text[],jsonb)'::regprocedure),chr(13),'');
 for old_text,new_text in select * from (values
 ($old$declare customer uuid; tests numeric; spend numeric; report uuid;$old$,
  $new$declare customer uuid; tests numeric; spend numeric; specials numeric; report uuid;$new$),
 ($old$array['customerId','testsPerDay','basis','statedMonthlySpendPaise','note']$old$,
  $new$array['customerId','testsPerDay','specialTestsPerMonth','basis','statedMonthlySpendPaise','note']$new$),
 ($old$  or jsonb_typeof(p_payload->'testsPerDay') is distinct from 'number'
  or jsonb_typeof(p_payload->'basis') is distinct from 'string'$old$,
  $new$  or jsonb_typeof(p_payload->'testsPerDay') is distinct from 'number'
  or coalesce(jsonb_typeof(p_payload->'specialTestsPerMonth'),'null') not in ('number','null')
  or jsonb_typeof(p_payload->'basis') is distinct from 'string'$new$),
 ($old$ tests:=(p_payload->>'testsPerDay')::numeric;
 spend:=(p_payload->>'statedMonthlySpendPaise')::numeric;$old$,
  $new$ tests:=(p_payload->>'testsPerDay')::numeric;
 specials:=(p_payload->>'specialTestsPerMonth')::numeric;
 spend:=(p_payload->>'statedMonthlySpendPaise')::numeric;$new$),
 ($old$ if tests<>trunc(tests) or tests not between 1 and 100000
  or (spend is not null$old$,
  $new$ if tests<>trunc(tests) or tests not between 1 and 100000
  or (specials is not null and (specials<>trunc(specials) or specials not between 1 and 1000000))
  or (spend is not null$new$),
 ($old$insert into private.stockflow_lab_size_reports(customer_id,tests_per_day,stated_monthly_spend_paise,basis,note,reported_by)$old$,
  $new$insert into private.stockflow_lab_size_reports(customer_id,tests_per_day,special_tests_per_month,stated_monthly_spend_paise,basis,note,reported_by)$new$),
 ($old$values(customer,tests::integer,spend::bigint,p_payload->>'basis',btrim(p_payload->>'note'),p_actor)$old$,
  $new$values(customer,tests::integer,specials::integer,spend::bigint,p_payload->>'basis',btrim(p_payload->>'note'),p_actor)$new$)
 ) patches(old_text,new_text) loop
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
   raise exception 'Unexpected lab size record anchor: %',old_text;
  end if;
  definition:=replace(definition,old_text,new_text);
  if position(old_text in definition)>0 then raise exception 'Legacy lab size record anchor remains';end if;
 end loop;
 execute definition;

 -- Both customer-map sheet and wallet account build labSize through this helper.
 -- Strip nulls only from the size object; keep the existing financial read intact.
 definition:=replace(pg_get_functiondef('private.stockflow_lab_size_read(uuid,boolean)'::regprocedure),chr(13),'');
 old_text:=$old$select jsonb_build_object('testsPerDay',r.tests_per_day,'basis',r.basis,'reportedBy',r.reported_by,
  'reportedOn',(r.reported_at at time zone 'Asia/Kolkata')::date)$old$;
 new_text:=$new$select jsonb_strip_nulls(jsonb_build_object('testsPerDay',r.tests_per_day,'basis',r.basis,'reportedBy',r.reported_by,
  'reportedOn',(r.reported_at at time zone 'Asia/Kolkata')::date,'specialTestsPerMonth',r.special_tests_per_month))$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected lab size read anchor';end if;
 definition:=replace(definition,old_text,new_text);
 if position(old_text in definition)>0 then raise exception 'Legacy lab size read anchor remains';end if;
 execute definition;
end $patch$;

commit;
