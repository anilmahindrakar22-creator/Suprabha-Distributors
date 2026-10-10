begin;
do $$
declare fixture record; rejection bigint; workspace jsonb; failures_before integer;
 company text:='exception-resolution-company'; original_definition text;
 fragment text:='from private.stockflow_economic_import_exceptions';
begin
 select count(*) into failures_before from private.stockflow_economic_import_exceptions;
 for fixture in select * from (values
  ('unadmitted', '7', null::bigint, 1, true, false, false),
  ('older-admission', '7', 6, 1, true, false, false),
  ('same-prior', '7', 7, 3, true, false, false),
  ('same-later', '7', 7, 1, false, false, false),
  ('newer-rejection', '8', 7, 1, true, false, false),
  ('newer-admission', '8', 9, 3, false, false, false),
  ('unknown-prior', 'invalid', 9, 3, true, false, false),
  ('unknown-later', 'invalid', 9, 1, false, false, false),
  ('global', '7', null::bigint, 1, true, false, false),
  ('other-company', '7', 9, 1, true, true, false),
  ('cancelled-later', '7', 8, 1, false, false, true)
 ) as cases(label,error_revision,admitted_revision,admitted_hours_ago,expected_open,other_company,cancelled)
 loop
  insert into private.stockflow_economic_import_exceptions(company_id,source_id,reason,evidence,recorded_at)
  values(company,case when fixture.label='global' then null else fixture.label end,
   'Exception fixture '||fixture.label,jsonb_build_object('revision',fixture.error_revision),now()-interval '2 hours') returning id into rejection;
  if fixture.admitted_revision is not null then
   insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,kind,cancelled,evidence,imported_at)
   values(case when fixture.other_company then 'different-company' else company end,fixture.label,
    fixture.admitted_revision,current_date,'purchase',fixture.cancelled,'{}',now()-make_interval(hours=>fixture.admitted_hours_ago));
  end if;
  if private.stockflow_economic_import_exception_open(rejection) is distinct from fixture.expected_open then
   raise exception 'Wrong admission-resolution state for %',fixture.label;
  end if;
  workspace:=private.stockflow_economic_workspace(array['accounts']);
  if exists(select 1 from jsonb_array_elements(workspace->'exceptions') e where e->>'reason'='Exception fixture '||fixture.label)
   is distinct from fixture.expected_open then raise exception 'Wrong current queue state for %',fixture.label;end if;
 end loop;
 if (select count(*) from private.stockflow_economic_import_exceptions)<>failures_before+11 then raise exception 'Resolution removed audit evidence';end if;
 -- Reproduce the old read-model bug without changing any immutable evidence.
 original_definition:=pg_get_functiondef('private.stockflow_economic_workspace(text[])'::regprocedure);
 execute replace(original_definition,fragment||' e where private.stockflow_economic_import_exception_open(e.id)',fragment);
 workspace:=private.stockflow_economic_workspace(array['accounts']);
 if not exists(select 1 from jsonb_array_elements(workspace->'exceptions') e where e->>'reason'='Exception fixture same-later') then raise exception 'Old queue regression was not reproduced';end if;
 execute original_definition;
 if has_function_privilege('authenticated','private.stockflow_economic_import_exception_open(bigint)','EXECUTE')
 or has_function_privilege('anon','private.stockflow_economic_import_exception_open(bigint)','EXECUTE') then raise exception 'Private exception helper exposed';end if;
end$$;
rollback;
