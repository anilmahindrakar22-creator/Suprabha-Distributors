begin;
insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('lab-mix-test-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status)
select 'lab-mix-'||r||'@test.local',r,'active' from unnest(array['sales','management','operations']) r;
insert into private.stockflow_customers(id,name,created_by_email) values
 ('19300000-0000-4000-8000-000000000001','Lab mix fixture','test'),
 ('19300000-0000-4000-8000-000000000002','Old lab mix fixture','test');
create function pg_temp.lm_payload(k text,content jsonb) returns jsonb language sql as $$
 select jsonb_build_object('customerId','19300000-0000-4000-8000-000000000001','idempotencyKey','lab-mix-report-'||k)||content
$$;
create function pg_temp.lm_call(payload jsonb,action_name text default 'record_lab_mix',actor text default 'sales') returns jsonb language sql as $$
 select public.stockflow_accounts_gateway('lab-mix-test-key','lab-mix-'||actor||'@test.local',action_name,payload)
$$;
create function pg_temp.lm_sheet(actor text default 'sales') returns jsonb language sql as $$
 select public.stockflow_customer_map_gateway('lab-mix-test-key','lab-mix-'||actor||'@test.local','get_customer_sheet',
 jsonb_build_object('customerId','19300000-0000-4000-8000-000000000001'))
$$;
create function pg_temp.lm_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL %',label;end if;end$$;
create function pg_temp.lm_error(payload jsonb,expected text,action_name text default 'record_lab_mix',actor text default 'sales') returns void language plpgsql as $$
begin
 begin perform pg_temp.lm_call(payload,action_name,actor);
 exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected %',expected;
end$$;
create function pg_temp.lm_immuno(volume jsonb) returns jsonb language sql as $$
 select jsonb_build_object('areas',jsonb_build_array(jsonb_build_object('area','IMMUNO','status','in_house')||volume))
$$;
do $checks$
declare v_saved jsonb; v_copy jsonb; v_before bigint; v_bad jsonb; v_n integer; v_report uuid; v_policy jsonb; v_content jsonb; v_table text;
begin
 perform pg_temp.lm_error(pg_temp.lm_payload('operations-record',pg_temp.lm_immuno(jsonb_build_object('exact',15))),'PT403','record_lab_mix','operations');
 perform pg_temp.lm_error(pg_temp.lm_payload('operations-confirm',jsonb_build_object('previousReportId','19300000-0000-4000-8000-000000000099')),'PT403','confirm_lab_mix','operations');
 v_policy:=jsonb_build_object('expectedVersion',1,'cliaCutoffPerDay',20,'packWastePerDay',4,'staleAfterDays',90);
 perform pg_temp.lm_error(v_policy||jsonb_build_object('idempotencyKey','lab-mix-policy-sales'),'PT403','set_lab_mix_policy');
 perform pg_temp.lm_assert(not (pg_temp.lm_sheet('operations') ?| array['labMix','labMixOptions']),'LM1 operations sheet');
 perform pg_temp.lm_assert(pg_temp.lm_sheet() ? 'labMixOptions' and not (pg_temp.lm_sheet() ? 'labMix'),'LM1 options without report');
 raise notice 'PASS LM1 role boundaries';

 for v_bad in select value from jsonb_array_elements(jsonb_build_array(
  jsonb_build_object('areas',jsonb_build_array(jsonb_build_object('area','BOGUS','status','not_done'))),
  jsonb_build_object('areas',jsonb_build_array(jsonb_build_object('area','IMMUNO','status','not_done'),jsonb_build_object('area','IMMUNO','status','sends_out'))),
  pg_temp.lm_immuno(jsonb_build_object('min',10,'max',20)),
  jsonb_build_object('areas',jsonb_build_array(jsonb_build_object('area','IMMUNO','status','sends_out','min',1))),
  jsonb_build_object('busiest',jsonb_build_object('test','TSH','exact',3)),
  jsonb_build_object('panels',jsonb_build_array(jsonb_build_object('panel','BOGUS','status','in_house'))),
  pg_temp.lm_immuno(jsonb_build_object('exact',15))||jsonb_build_object('extra',true),
  jsonb_build_object(),
  jsonb_build_object('labSize',jsonb_build_object('testsPerDay',80,'basis','lab_said')),
  pg_temp.lm_immuno(jsonb_build_object('exact',15))||jsonb_build_object('busiest',jsonb_build_object('test','BOGUS','exact',3)),
  pg_temp.lm_immuno(jsonb_build_object('exact',1.5)),
  pg_temp.lm_immuno(jsonb_build_object('exact','15')),
  pg_temp.lm_immuno(jsonb_build_object('exact',15,'min',15,'max',30)),
  pg_temp.lm_immuno(jsonb_build_object('min',61)),
  pg_temp.lm_immuno(jsonb_build_object('exact',0)),
  pg_temp.lm_immuno(jsonb_build_object('exact',100001)),
  pg_temp.lm_immuno(jsonb_build_object('min',1,'max',null)),
  jsonb_build_object('areas',jsonb_build_array(null)),
  jsonb_build_object('panels',jsonb_build_array(1)),
  jsonb_build_object('areas',true),
  jsonb_build_object('panels',jsonb_build_array(jsonb_build_object('panel','FERTILITY','status','sent_out'),jsonb_build_object('panel','FERTILITY','status','in_house')))
 )) loop
  perform pg_temp.lm_error(pg_temp.lm_payload('invalid-content',v_bad),'22023');
 end loop;
 perform pg_temp.lm_error(pg_temp.lm_payload('missing-customer',pg_temp.lm_immuno(jsonb_build_object('exact',15)))||jsonb_build_object('customerId','19300000-0000-4000-8000-000000000099'),'22023');
 update private.stockflow_customers set active=false where id='19300000-0000-4000-8000-000000000001';
 perform pg_temp.lm_error(pg_temp.lm_payload('inactive-customer',pg_temp.lm_immuno(jsonb_build_object('exact',15))),'22023');
 update private.stockflow_customers set active=true where id='19300000-0000-4000-8000-000000000001';
 update private.stockflow_lab_tests set active=false where code='PCT';
 perform pg_temp.lm_error(pg_temp.lm_payload('inactive-test',pg_temp.lm_immuno(jsonb_build_object('exact',15))||jsonb_build_object('busiest',jsonb_build_object('test','PCT','exact',3))),'22023');
 perform pg_temp.lm_assert(not (private.stockflow_lab_mix_options()->'tests' @> jsonb_build_array(jsonb_build_object('code','PCT'))),'inactive test options');
 update private.stockflow_lab_tests set active=true where code='PCT';
 raise notice 'PASS LM2 invalid content rejected';

 perform pg_temp.lm_call(pg_temp.lm_payload('not-done',jsonb_build_object('areas',jsonb_build_array(jsonb_build_object('area','IMMUNO','status','not_done')))));
 perform pg_temp.lm_assert(pg_temp.lm_sheet()#>>'{labMix,fit}'='none','LM3 none');
 perform pg_temp.lm_call(pg_temp.lm_payload('sends-out',jsonb_build_object('areas',jsonb_build_array(jsonb_build_object('area','IMMUNO','status','sends_out')))));
 perform pg_temp.lm_assert(pg_temp.lm_sheet()#>>'{labMix,fit}'='none','LM3 sends out');
 for v_n in 14..15 loop
  perform pg_temp.lm_call(pg_temp.lm_payload('exact-'||v_n,pg_temp.lm_immuno(jsonb_build_object('exact',v_n))));
  perform pg_temp.lm_assert(pg_temp.lm_sheet()#>>'{labMix,fit}'=(case when v_n=14 then 'vidas' else 'clia' end),'LM3 exact boundary');
 end loop;
 perform pg_temp.lm_call(pg_temp.lm_payload('band',pg_temp.lm_immuno(jsonb_build_object('min',15,'max',30))));
 perform pg_temp.lm_assert(pg_temp.lm_sheet()#>>'{labMix,fit}'='clia','LM3 band');
 raise notice 'PASS LM3 fit boundaries';

 perform pg_temp.lm_call(v_policy||jsonb_build_object('idempotencyKey','lab-mix-policy-change'),'set_lab_mix_policy','management');
 perform pg_temp.lm_assert(pg_temp.lm_sheet()#>>'{labMix,fit}'='check','LM4 straddle');
 perform pg_temp.lm_call(pg_temp.lm_payload('exact-25',pg_temp.lm_immuno(jsonb_build_object('exact',25))));
 perform pg_temp.lm_assert(pg_temp.lm_sheet()#>>'{labMix,fit}'='clia','LM4 new cutoff');
 perform pg_temp.lm_error(v_policy||jsonb_build_object('idempotencyKey','lab-mix-policy-stale'),'PT409','set_lab_mix_policy','management');
 perform pg_temp.lm_call(v_policy||jsonb_build_object('idempotencyKey','lab-mix-policy-restore','expectedVersion',2,'cliaCutoffPerDay',15),'set_lab_mix_policy','management');
 for v_bad in select value from jsonb_array_elements(jsonb_build_array(
  jsonb_build_object('cliaCutoffPerDay',0),jsonb_build_object('packWastePerDay',1001),
  jsonb_build_object('staleAfterDays',6),jsonb_build_object('staleAfterDays',731),
  jsonb_build_object('expectedVersion','3'),jsonb_build_object('cliaCutoffPerDay',1.5),jsonb_build_object('extra',true))) loop
  perform pg_temp.lm_error(v_policy||jsonb_build_object('expectedVersion',3,'idempotencyKey','lab-mix-policy-invalid')||v_bad,'22023','set_lab_mix_policy','management');
 end loop;
 raise notice 'PASS LM4 versioned policy and restore';

 for v_n in 3..4 loop
  perform pg_temp.lm_call(pg_temp.lm_payload('busiest-'||v_n,pg_temp.lm_immuno(jsonb_build_object('exact',15))||jsonb_build_object('busiest',jsonb_build_object('test','TSH','exact',v_n))));
  perform pg_temp.lm_assert(pg_temp.lm_sheet()#>'{labMix,packWasteRisk}'=to_jsonb(v_n=3),'LM5 waste boundary');
 end loop;
 perform pg_temp.lm_call(pg_temp.lm_payload('no-busiest',pg_temp.lm_immuno(jsonb_build_object('exact',15))));
 perform pg_temp.lm_assert(pg_temp.lm_sheet()#>'{labMix,packWasteRisk}'='null'::jsonb,'LM5 no busiest');
 perform pg_temp.lm_call(pg_temp.lm_payload('vidas-waste',pg_temp.lm_immuno(jsonb_build_object('exact',14))||jsonb_build_object('busiest',jsonb_build_object('test','TSH','exact',3))));
 perform pg_temp.lm_assert(pg_temp.lm_sheet()#>'{labMix,packWasteRisk}'='null'::jsonb,'LM5 vidas');
 raise notice 'PASS LM5 pack waste';

 v_content:=pg_temp.lm_immuno(jsonb_build_object('min',61,'max',null))||jsonb_build_object('busiest',jsonb_build_object('test','TSH','min',1,'max',3),
  'panels',jsonb_build_array(jsonb_build_object('panel','FERTILITY','status','sent_out')));
 v_saved:=pg_temp.lm_call(pg_temp.lm_payload('copy-source',v_content));
 v_report:=(v_saved->>'reportId')::uuid;
 v_saved:=pg_temp.lm_sheet()->'labMix';
 v_copy:=pg_temp.lm_call(pg_temp.lm_payload('copy-confirm',jsonb_build_object('previousReportId',v_report)),'confirm_lab_mix','management');
 perform pg_temp.lm_assert((select copied_from=v_report and reported_by='lab-mix-management@test.local' from private.stockflow_lab_mix_reports where id=(v_copy->>'reportId')::uuid)
  and pg_temp.lm_sheet()#>'{labMix,areas}'=v_saved->'areas' and pg_temp.lm_sheet()#>'{labMix,panels}'=v_saved->'panels'
  and pg_temp.lm_sheet()#>'{labMix,busiest}'=v_saved->'busiest','LM6 copied report');
 perform pg_temp.lm_error(pg_temp.lm_payload('copy-stale',jsonb_build_object('previousReportId',v_report)),'PT409','confirm_lab_mix');
 raise notice 'PASS LM6 confirm and stale conflict';

 select count(*) into v_before from private.stockflow_lab_mix_reports;
 perform pg_temp.lm_error(pg_temp.lm_payload('invalid-lab-size',v_content||jsonb_build_object('labSize',jsonb_build_object('testsPerDay',0,'basis','lab_said'))),'22023');
 perform pg_temp.lm_assert((select count(*)=v_before from private.stockflow_lab_mix_reports),'LM7 rollback');
 v_saved:=pg_temp.lm_call(pg_temp.lm_payload('valid-lab-size',v_content||jsonb_build_object('labSize',jsonb_build_object('testsPerDay',80,'basis','lab_said'))));
 perform pg_temp.lm_assert((select tests_per_day=80 from private.stockflow_lab_size_reports where id=(v_saved->>'labSizeReportId')::uuid)
  and (select count(*)=v_before+1 from private.stockflow_lab_mix_reports),'LM7 pair');
 raise notice 'PASS LM7 atomic lab size';

 begin update private.stockflow_lab_mix_reports set reported_by='changed' where id=v_report; raise exception 'LM8 update allowed'; exception when sqlstate '55000' then null;end;
 begin delete from private.stockflow_lab_mix_reports where id=v_report; raise exception 'LM8 delete allowed'; exception when sqlstate '42501' then null;end;
 begin update private.stockflow_lab_mix_report_areas set min_per_day=62 where report_id=v_report; raise exception 'LM8 area update allowed'; exception when sqlstate '55000' then null;end;
 begin delete from private.stockflow_lab_mix_report_areas where report_id=v_report; raise exception 'LM8 area delete allowed'; exception when sqlstate '42501' then null;end;
 begin update private.stockflow_lab_mix_report_panels set status='in_house' where report_id=v_report; raise exception 'LM8 panel update allowed'; exception when sqlstate '55000' then null;end;
 begin delete from private.stockflow_lab_mix_report_panels where report_id=v_report; raise exception 'LM8 panel delete allowed'; exception when sqlstate '42501' then null;end;
 begin update private.stockflow_lab_mix_policies set stale_after_days=100 where version=1; raise exception 'LM8 policy update allowed'; exception when sqlstate '55000' then null;end;
 begin delete from private.stockflow_lab_mix_policies where version=1; raise exception 'LM8 policy delete allowed'; exception when sqlstate '42501' then null;end;
 raise notice 'PASS LM8 immutable reports and policy';

 select count(*) into v_before from private.stockflow_lab_mix_reports;
 perform pg_temp.lm_assert(v_saved=pg_temp.lm_call(pg_temp.lm_payload('valid-lab-size',v_content||jsonb_build_object('labSize',jsonb_build_object('testsPerDay',80,'basis','lab_said'))))
  and (select count(*)=v_before from private.stockflow_lab_mix_reports),'LM9 replay');
 raise notice 'PASS LM9 idempotent replay';

 insert into private.stockflow_lab_mix_reports(customer_id,reported_by,reported_at)
 values('19300000-0000-4000-8000-000000000002','test',clock_timestamp()-interval '91 days') returning id into v_report;
 insert into private.stockflow_lab_mix_report_areas(report_id,area_code,status) values(v_report,'HAEM','not_done');
 perform pg_temp.lm_assert(private.stockflow_lab_mix_read('19300000-0000-4000-8000-000000000002')->>'stale'='true','LM10 stale');
 perform pg_temp.lm_assert(private.stockflow_lab_mix_read('19300000-0000-4000-8000-000000000002')->>'fit'='unknown','LM3 no IMMUNO');
 raise notice 'PASS LM10 stale direct-insert fixture, with triggers enabled';

 -- Integer-valued JSON numbers must not fail text-to-integer casts after validation.
 perform pg_temp.lm_call(pg_temp.lm_payload('numeric-exact',pg_temp.lm_immuno(jsonb_build_object('exact',15.0::numeric))));
 perform pg_temp.lm_assert(pg_temp.lm_sheet()#>>'{labMix,areas,0,min}'='15','canonical exact integer');
 perform pg_temp.lm_call(pg_temp.lm_payload('numeric-band',pg_temp.lm_immuno(jsonb_build_object('min',15.0::numeric,'max',30.0::numeric))));
 perform pg_temp.lm_assert(pg_temp.lm_sheet()#>>'{labMix,areas,0,min}'='15','canonical band integer');
 perform pg_temp.lm_call(pg_temp.lm_payload('panel-only',jsonb_build_object('areas',null,'busiest',null,'labSize',null,
  'panels',jsonb_build_array(jsonb_build_object('panel','CARDIAC','status','not_offered')))));
 perform pg_temp.lm_assert(pg_temp.lm_sheet()#>>'{labMix,fit}'='unknown','panel-only report');
 foreach v_table in array array['stockflow_lab_areas','stockflow_lab_tests','stockflow_lab_panels','stockflow_lab_mix_reports',
  'stockflow_lab_mix_report_areas','stockflow_lab_mix_report_panels','stockflow_lab_mix_policies'] loop
  perform pg_temp.lm_assert((select relrowsecurity from pg_class where oid=('private.'||v_table)::regclass)
   and not has_table_privilege('service_role','private.'||v_table,'SELECT'),'private table '||v_table);
 end loop;
 perform pg_temp.lm_assert(not has_function_privilege('service_role','private.stockflow_lab_mix_read(uuid)','EXECUTE')
  and not has_function_privilege('authenticated','private.stockflow_lab_mix_options()','EXECUTE'),'private functions');
 raise notice 'PASS LM extra validation, active options, numeric integers and private read boundary';
end $checks$;
rollback;
