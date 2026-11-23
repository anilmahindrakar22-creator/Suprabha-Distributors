begin;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('item-detail-key','sha256'),'hex') where name='orders';
-- Draft is a historical status excluded by cover but absent from the current state table.
insert into private.stockflow_order_states(status) values('draft') on conflict do nothing;
insert into public.stockflow_members(email,role,roles,status) values
 ('detail-admin@test.local','administrator',array['administrator'],'active'),
 ('detail-management@test.local','management',array['management'],'active'),
 ('detail-operations@test.local','operations',array['operations'],'active'),
 ('detail-warehouse@test.local','warehouse',array['warehouse'],'active'),
 ('detail-viewer@test.local','viewer',array['viewer'],'active'),
 ('detail-inactive@test.local','administrator',array['administrator'],'suspended');

create function pg_temp.detail_assert(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',message; end if; end $$;

do $test$
declare r jsonb; a jsonb; v uuid; f record; role_name text; payload jsonb; i integer;
begin
 insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content) values
 ('item-detail-test','old',now()-interval '1 day','{"products":[{"id":"wrong","name":"Detail item"}]}'),
 ('item-detail-test','new',now(),'{"products":[{"id":"a","name":"Detail item"},{"id":"b","name":"Other item"}]}');
 for f in select * from (values
  ('sale',0,'2026-06-03'::date,'sale',false,'a',20::numeric),
  ('sale',1,'2026-06-03'::date,'sale',false,'a',12::numeric),
  ('return',0,'2026-06-04'::date,'return',false,'a',2::numeric),
  ('credit',0,'2026-06-05'::date,'credit',false,'a',1::numeric),
  ('cancel',0,'2026-06-05'::date,'sale',true,'a',999::numeric),
  ('other',0,'2026-06-05'::date,'sale',false,'b',999::numeric),
  ('old-catalog',0,'2026-06-05'::date,'sale',false,'wrong',999::numeric),
  ('outside',0,'2026-05-31'::date,'sale',false,'a',999::numeric),
  ('future',0,'2026-11-23'::date,'sale',false,'a',999::numeric),
  ('moved',0,'2026-06-05'::date,'sale',false,'a',999::numeric),
  ('moved',1,'2026-12-05'::date,'sale',false,'a',999::numeric),
  ('nov',0,'2026-11-22'::date,'sale',false,'a',3.125::numeric)
 ) x(source_id,revision,day,kind,cancelled,product,quantity) loop
  insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,kind,cancelled,evidence)
   values('item-detail-test',f.source_id,f.revision,f.day,f.kind,f.cancelled,'{}') returning id into v;
  insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
   values(v,'1',f.product,f.quantity,'kit',0,'{}');
 end loop;
 for i in 1..14 loop
  insert into private.stockflow_purchase_orders(po_number,supplier_name,status,created_by_email,created_at)
   values('DETAIL-'||i,'Detail supplier',case when i=14 then 'cancelled' else 'open' end,'detail-admin@test.local','2026-11-01'::timestamptz+make_interval(days=>i)) returning id into v;
  insert into private.stockflow_purchase_order_lines(po_id,tally_item_key,item_name,quantity,received_quantity,rate)
   values(v,case when i=13 then 'Other item' else 'Detail item' end,'Detail item',10,case when i=12 then 10 else 2 end,12);
 end loop;
 for f in select * from (values
  ('confirmed',false,10,3),('draft',false,99,0),('cancelled',false,99,0),('delivered',false,99,0),
  ('phone_order_received',false,99,0),('awaiting_confirmation',false,99,0),('awaiting_approval',false,99,0),
  ('confirmed',true,99,0),('confirmed',false,5,5)
 ) x(status,archived,quantity,fulfilled) loop
  insert into private.stockflow_orders(customer_name,status,idempotency_key,created_by_email,updated_by_email,archived_at)
   values('Detail customer',f.status,gen_random_uuid()::text,'detail-admin@test.local','detail-admin@test.local',case when f.archived then now() end) returning id into v;
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity,fulfilled_quantity)
   values(v,'Detail item','Detail item',f.quantity,f.fulfilled);
 end loop;
 insert into private.stockflow_supplier_prices(tally_item_key,supplier_name,rate,unit,effective_at,source_reference,source_id,imported_at) values
  ('Detail item','Older supplier',111.11,'kit','2026-11-20','old','old',now()),
  ('Detail item','Z supplier',222.22,'kit','2026-11-22','z','z',now()-interval '1 hour'),
  ('Detail item','Private detail supplier',87654.32,'kit','2026-11-22','new','new',now()),
  ('Detail item','ZZ tie supplier',333.33,'kit','2026-11-22','tie','tie',now());
 r:=private.stockflow_stock_item_detail('Detail item','2026-11-22',true,true);
 perform pg_temp.detail_assert(r->>'view'='item_detail' and r->>'itemKey'='Detail item' and r->>'asOf'='2026-11-22','Top-level contract');
 perform pg_temp.detail_assert(jsonb_array_length(r->'months')=6 and r->'months'->0->>'month'='2026-06' and r->'months'->5->>'month'='2026-11','Six ordered months');
 perform pg_temp.detail_assert((r->'months'->0->>'sold')::numeric=9 and (r->'months'->5->>'sold')::numeric=3.125,'Net sale, latest revision, cancelled, catalog, other item and date rules');
 for i in 1..4 loop
  perform pg_temp.detail_assert(r->'months'->i->>'month'=to_char(make_date(2026,6+i,1),'YYYY-MM') and (r->'months'->i->>'sold')::numeric=0,'Empty month or month order');
 end loop;
 perform pg_temp.detail_assert((r->>'openPoCount')::integer=11 and jsonb_array_length(r->'openPos')=10 and r->'openPos'->0->>'poNumber'='DETAIL-11' and (r->'openPos'->0->>'due')::numeric=8,'PO filters, count, limit and newest first');
 perform pg_temp.detail_assert(r->'waiting'='{"orders":1,"quantity":7}'::jsonb,'Waiting rules');
 perform pg_temp.detail_assert(r->'supplierPrice'->>'name'='Private detail supplier','Supplier effective/import/name ordering');
 foreach role_name in array array['admin','management','operations','warehouse','viewer'] loop
  r:=public.stockflow_requirements_gateway('item-detail-key','detail-'||role_name||'@test.local','get_requirements','{"view":"item_detail","itemKey":"Detail item"}');
  if role_name in ('admin','management') then
   perform pg_temp.detail_assert((r->'supplierPrice'->>'rate')::numeric=87654.32,'Authorized rate missing');
  elsif role_name='operations' then
   perform pg_temp.detail_assert(r->'supplierPrice'->>'name'='Private detail supplier' and not (r->'supplierPrice' ? 'rate') and position('87654.32' in r::text)=0,'Operations price leak');
  else
   perform pg_temp.detail_assert(not (r ? 'supplierPrice') and position('Private detail supplier' in r::text)=0 and position('87654.32' in r::text)=0,'Restricted supplier leak');
  end if;
 end loop;
 r:=public.stockflow_requirements_gateway('item-detail-key','detail-admin@test.local','get_requirements','{"view":"item_detail","itemKey":"No detail price"}');
 perform pg_temp.detail_assert(r->'supplierPrice'='null'::jsonb and r->'waiting'='{"orders":0,"quantity":0}'::jsonb,'Missing supplier/waiting');
 r:=public.stockflow_requirements_gateway('item-detail-key','detail-admin@test.local','get_requirements','{"view":"item_detail","itemKey":"Detail item "}');
 perform pg_temp.detail_assert(r->>'itemKey'='Detail item ' and r->'supplierPrice'='null'::jsonb,'Exact key must not be trimmed');
 begin
  perform public.stockflow_requirements_gateway('wrong','detail-admin@test.local','get_requirements','{"view":"item_detail","itemKey":"Detail item"}');
  raise exception 'Wrong key allowed';
 exception when sqlstate '42501' then null; end;
 foreach role_name in array array['inactive','missing'] loop
  begin
   perform public.stockflow_requirements_gateway('item-detail-key','detail-'||role_name||'@test.local','get_requirements','{"view":"item_detail","itemKey":"Detail item"}');
   raise exception 'Inactive/missing membership allowed';
  exception when sqlstate '42501' then null; end;
 end loop;
 for payload in select value from jsonb_array_elements(jsonb_build_array(
  '{"view":"item_detail"}'::jsonb,'{"view":"item_detail","itemKey":3}'::jsonb,
  '{"view":"item_detail","itemKey":null}'::jsonb,'{"view":"item_detail","itemKey":""}'::jsonb,
  '{"view":"item_detail","itemKey":"   "}'::jsonb,'{"view":"item_detail","itemKey":"Detail item","x":1}'::jsonb,
  jsonb_build_object('view','item_detail','itemKey',repeat('x',221)))) loop
  begin
   perform public.stockflow_requirements_gateway('item-detail-key','detail-admin@test.local','get_requirements',payload);
   raise exception 'Invalid payload allowed: %',payload;
  exception when sqlstate '22023' then null; end;
 end loop;
 foreach role_name in array array['on_po','cover'] loop
  r:=public.stockflow_requirements_gateway('item-detail-key','detail-admin@test.local','get_requirements',jsonb_build_object('view',role_name));
  perform pg_temp.detail_assert(r->>'view'=role_name,'Gateway delegation');
 end loop;
 perform pg_temp.detail_assert(not has_function_privilege('service_role','private.stockflow_stock_item_detail(text,date,boolean,boolean)','execute'),'Private read must not be callable');
 raise notice 'PASS stock item detail months, POs, waiting, role privacy, validation and delegation';
end $test$;
rollback;
