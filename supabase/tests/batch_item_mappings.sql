begin;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('batch-mapping-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,status) values('batch-manager@test.local','management','active'),('batch-ops@test.local','operations','active'),('batch-account@test.local','accounts','active');
insert into public.stockflow_snapshots(id,company,fetched_at,payload) values('suprabha','SUPRABHA DISTRIBUTORS',now()::text,'{"catalog":[]}'::jsonb) on conflict(id) do nothing;
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values('aaaaaaaa-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Batch fixture customer','batch-fixture-customer','test');
insert into private.stockflow_orders(id,order_number,customer_id,customer_name,source,status,created_by_email,updated_by_email,idempotency_key) values('aaaaaaaa-bbbb-4bbb-8bbb-bbbbbbbbbbb2','BATCH-TEST-ORDER','aaaaaaaa-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Batch fixture customer','phone','delivered','test','test','batch-order-fixture');
insert into private.stockflow_equipment_installations(id,order_id,tally_key,item_name,status,scheduled_date,serial_number,created_by_email,completed_at) values('aaaaaaaa-bbbb-4bbb-8bbb-bbbbbbbbbbb3','aaaaaaaa-bbbb-4bbb-8bbb-bbbbbbbbbbb2','batch-instrument','Batch instrument','completed',private.stockflow_economic_business_date()-60,'BATCH-SERIAL','test',now()-interval '60 days');

do $test$
declare period date:=(date_trunc('month',private.stockflow_economic_business_date())-interval '1 month')::date;
 catalog jsonb;doc jsonb;receipt jsonb;replay jsonb;target uuid;payload jsonb;items jsonb;
 maps_before integer;runs_before integer;audit_before integer;results_before integer;
begin
 catalog:='{"groups":[{"id":"g","name":"Group","parentId":null}],"products":[{"id":"p1","name":"Item one","groupId":"g","unit":"pack"},{"id":"p2","name":"Item two","groupId":"g","unit":"pack"},{"id":"p3","name":"Item three","groupId":"g","unit":"pack"},{"id":"p7","name":"Item seven","groupId":"g","unit":"pack"},{"id":"p9","name":"Item nine","groupId":"g","unit":"pack"}]}'::jsonb;
 doc:=jsonb_build_object('schemaVersion',1,'companyId','batch-company','sourceVersion',(period::timestamp at time zone 'Asia/Kolkata')::text,'itemCatalog',catalog,'completeWindow',true,'windowFrom',period,'windowTo',(period+interval '1 month')::date,'vouchers','[]'::jsonb);
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';
 receipt:=public.stockflow_economics_gateway('batch-mapping-key','batch-manager@test.local','create_target',jsonb_build_object('kind','placement','name','Batch mapped instrument','companyId','batch-company','customerId','aaaaaaaa-bbbb-4bbb-8bbb-bbbbbbbbbbb1','customerSourceId','batch-customer-guid','siteId','batch-site','modelId','batch-model','installationId','aaaaaaaa-bbbb-4bbb-8bbb-bbbbbbbbbbb3','effectiveFrom',period-10,'capitalPaise','0','idempotencyKey','batch-create-00000001'));
 target:=(receipt->>'entityId')::uuid;

 -- BM1: three ticks save in one command with one rebuild and one audit row carrying every item.
 items:=jsonb_build_array(
  jsonb_build_object('productId','p2','effect','exclude','effectiveFrom',period),
  jsonb_build_object('productId','p1','effect','include','effectiveFrom',period,'effectiveTo',period+20),
  jsonb_build_object('productId','p3','effect','exclude','effectiveFrom',period,'effectiveTo',''));
 payload:=jsonb_build_object('companyId','batch-company','modelId','batch-model','targetId',target,'reason','Batch reason fixture','items',items,'idempotencyKey','batch-save-0000000001');
 maps_before:=(select count(*) from private.stockflow_economic_mappings);
 runs_before:=(select count(*) from private.stockflow_economic_runs);
 audit_before:=(select count(*) from private.stockflow_economic_audit);
 results_before:=(select count(*) from private.stockflow_command_results);
 receipt:=public.stockflow_economics_gateway('batch-mapping-key','batch-manager@test.local','set_mappings',payload);
 if (select count(*) from private.stockflow_economic_mappings where reason='Batch reason fixture' and verified_by='batch-manager@test.local' and target_id=target and company_id='batch-company' and model_id='batch-model')<>3
  or (select count(*) from private.stockflow_economic_mappings)<>maps_before+3
  or not exists(select 1 from private.stockflow_economic_mappings where product_id='p1' and effect='include' and effective_to=period+20)
  or (select count(*) from private.stockflow_economic_mappings where effect='exclude' and product_id in ('p2','p3') and effective_to is null and reason='Batch reason fixture')<>2 then raise exception 'BM1 three ticks did not save as three rows with the batch reason and actor';end if;
 if (select count(*) from private.stockflow_economic_runs)<>runs_before+1 then raise exception 'BM1 batch did not run exactly one rebuild (% new runs)',(select count(*) from private.stockflow_economic_runs)-runs_before;end if;
 if (select count(*) from private.stockflow_economic_audit)<>audit_before+1
  or (select count(*) from private.stockflow_economic_audit a where a.action='set_mappings' and jsonb_array_length(a.payload->'items')=3 and a.actor='batch-manager@test.local')<>1 then raise exception 'BM1 audit must be one row whose payload keeps all 3 items';end if;
 if (select count(*) from private.stockflow_command_results)<>results_before+1 then raise exception 'BM1 command receipt count wrong';end if;
 raise notice 'PASS BM1 three items, one rebuild, one audit row';

 -- BM2: replay with the same key returns the same receipt and adds nothing.
 maps_before:=(select count(*) from private.stockflow_economic_mappings);
 runs_before:=(select count(*) from private.stockflow_economic_runs);
 audit_before:=(select count(*) from private.stockflow_economic_audit);
 replay:=public.stockflow_economics_gateway('batch-mapping-key','batch-manager@test.local','set_mappings',payload);
 if replay<>receipt or (select count(*) from private.stockflow_economic_mappings)<>maps_before or (select count(*) from private.stockflow_economic_runs)<>runs_before or (select count(*) from private.stockflow_economic_audit)<>audit_before then raise exception 'BM2 replay changed the result or added rows/runs';end if;
 raise notice 'PASS BM2 replay is stable';

 -- BM3: a repeated product is refused and nothing is saved.
 maps_before:=(select count(*) from private.stockflow_economic_mappings);
 begin
  perform public.stockflow_economics_gateway('batch-mapping-key','batch-manager@test.local','set_mappings',jsonb_build_object('companyId','batch-company','modelId','batch-model','targetId',target,'reason','Batch duplicate fixture','idempotencyKey','batch-dup-000000001','items',jsonb_build_array(
   jsonb_build_object('productId','p7','effect','include','effectiveFrom',period+1),
   jsonb_build_object('productId',' p7 ','effect','exclude','effectiveFrom',period+2))));
  raise exception 'BM3 duplicate productId accepted';
 exception when sqlstate '22023' then null;end;
 if (select count(*) from private.stockflow_economic_mappings)<>maps_before or exists(select 1 from private.stockflow_command_results where idempotency_key='batch-dup-000000001') then raise exception 'BM3 duplicate batch left data behind';end if;
 raise notice 'PASS BM3 duplicate productId refused';

 -- BM4: a clash on (product, date) names the product and saves none of the batch.
 perform public.stockflow_economics_gateway('batch-mapping-key','batch-manager@test.local','set_mapping',jsonb_build_object('companyId','batch-company','modelId','batch-model','productId','p9','targetId',target,'effect','include','effectiveFrom',period+3,'reason','Existing single tick fixture','idempotencyKey','batch-single-00000001'));
 maps_before:=(select count(*) from private.stockflow_economic_mappings);
 runs_before:=(select count(*) from private.stockflow_economic_runs);
 begin
  perform public.stockflow_economics_gateway('batch-mapping-key','batch-manager@test.local','set_mappings',jsonb_build_object('companyId','batch-company','modelId','batch-model','targetId',target,'reason','Batch clash fixture','idempotencyKey','batch-clash-00000001','items',jsonb_build_array(
   jsonb_build_object('productId','p7','effect','include','effectiveFrom',period+3),
   jsonb_build_object('productId','p9','effect','exclude','effectiveFrom',period+3))));
  raise exception 'BM4 clashing item accepted';
 exception when sqlstate 'PT409' then
  if sqlerrm not like '%p9%' then raise exception 'BM4 conflict did not name the product: %',sqlerrm;end if;
 end;
 if (select count(*) from private.stockflow_economic_mappings)<>maps_before or exists(select 1 from private.stockflow_economic_mappings where product_id='p7') or (select count(*) from private.stockflow_economic_runs)<>runs_before or exists(select 1 from private.stockflow_command_results where idempotency_key='batch-clash-00000001') then raise exception 'BM4 clashing batch saved part of its items';end if;
 raise notice 'PASS BM4 clash names the item and saves nothing';

 -- BM5: invalid effect, empty list, too many items and a missing reason are each refused.
 maps_before:=(select count(*) from private.stockflow_economic_mappings);
 begin
  perform public.stockflow_economics_gateway('batch-mapping-key','batch-manager@test.local','set_mappings',jsonb_build_object('companyId','batch-company','modelId','batch-model','reason','Batch effect fixture','idempotencyKey','batch-effect-0000001','items',jsonb_build_array(jsonb_build_object('productId','p7','effect','maybe','effectiveFrom',period+4))));
  raise exception 'BM5 effect maybe accepted';
 exception when sqlstate '22023' then null;end;
 begin
  perform public.stockflow_economics_gateway('batch-mapping-key','batch-manager@test.local','set_mappings',jsonb_build_object('companyId','batch-company','modelId','batch-model','reason','Batch empty fixture','idempotencyKey','batch-empty-00000001','items','[]'::jsonb));
  raise exception 'BM5 empty items accepted';
 exception when sqlstate '22023' then null;end;
 begin
  perform public.stockflow_economics_gateway('batch-mapping-key','batch-manager@test.local','set_mappings',jsonb_build_object('companyId','batch-company','modelId','batch-model','reason','Batch large fixture','idempotencyKey','batch-large-00000001','items',(select jsonb_agg(jsonb_build_object('productId','bulk-'||n,'effect','include','effectiveFrom',period+5)) from generate_series(1,201) n)));
  raise exception 'BM5 201 items accepted';
 exception when sqlstate '22023' then null;end;
 begin
  perform public.stockflow_economics_gateway('batch-mapping-key','batch-manager@test.local','set_mappings',jsonb_build_object('companyId','batch-company','modelId','batch-model','idempotencyKey','batch-reason-0000001','items',jsonb_build_array(jsonb_build_object('productId','p7','effect','include','effectiveFrom',period+4))));
  raise exception 'BM5 missing reason accepted';
 exception when sqlstate '22023' then null;end;
 if (select count(*) from private.stockflow_economic_mappings)<>maps_before then raise exception 'BM5 refused batches still saved rows';end if;
 raise notice 'PASS BM5 invalid input refused with 22023';

 -- BM6: only management may save a batch.
 begin
  perform public.stockflow_economics_gateway('batch-mapping-key','batch-ops@test.local','set_mappings',jsonb_set(payload,'{idempotencyKey}','"batch-ops-denied-0001"'));
  raise exception 'BM6 operations role saved a batch';
 exception when insufficient_privilege then null;end;
 begin
  perform public.stockflow_economics_gateway('batch-mapping-key','batch-account@test.local','set_mappings',jsonb_set(payload,'{idempotencyKey}','"batch-account-denied1"'));
  raise exception 'BM6 accounts role saved a batch';
 exception when insufficient_privilege then null;end;
 raise notice 'PASS BM6 non-management roles denied';

 -- BM7: recovery recognises the new command name.
 if public.stockflow_economics_gateway('batch-mapping-key','batch-manager@test.local','recover_economic_command',jsonb_build_object('commandAction','set_mappings','commandKey','batch-unknown-key-0001','closeUnresolved',false))->>'status'<>'unresolved'
  or public.stockflow_economics_gateway('batch-mapping-key','batch-manager@test.local','recover_economic_command',jsonb_build_object('commandAction','set_mappings','commandKey','batch-save-0000000001','closeUnresolved',false))->>'status'<>'accepted' then raise exception 'BM7 recovery did not recognise set_mappings';end if;
 raise notice 'PASS BM7 recovery accepts set_mappings';
end$test$;
rollback;
