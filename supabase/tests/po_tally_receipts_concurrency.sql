-- Disposable replay database only. R10 requires committed fixtures for dblink.
-- PTR-RACE / d7020000 are distinct from every other concurrency fixture prefix.
create extension if not exists dblink with schema public;
begin;
create temporary table ptr_race_config as select secret_sha256 from private.stockflow_gateway_config where name='orders';
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('ptr-race-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,roles,status) values
 ('ptr-race-a@test.local','operations',array['operations'],'active'),
 ('ptr-race-b@test.local','operations',array['operations'],'active');
insert into private.stockflow_products(tally_item_key,name,base_unit) values('PTR-RACE-ITEM','PTR-RACE item','Nos');
insert into private.stockflow_purchase_orders(id,po_number,supplier_name,created_by_email,created_at) values
 ('d7020000-0000-4000-8000-000000000001','PTR-RACE-PO-A','PTR-RACE supplier','ptr-race-a@test.local',current_date::timestamp at time zone 'Asia/Kolkata'),
 ('d7020000-0000-4000-8000-000000000002','PTR-RACE-PO-B','PTR-RACE supplier','ptr-race-b@test.local',current_date::timestamp at time zone 'Asia/Kolkata');
insert into private.stockflow_purchase_order_lines(po_id,tally_item_key,item_name,quantity,unit,rate) values
 ('d7020000-0000-4000-8000-000000000001','PTR-RACE-ITEM','PTR-RACE item',2,'Nos',10),
 ('d7020000-0000-4000-8000-000000000002','PTR-RACE-ITEM','PTR-RACE item',2,'Nos',10);
-- Economics fixture constraints: nonnegative revision, INR, purchase, valid unit/product.
insert into private.stockflow_economic_source_vouchers(id,company_id,source_id,source_revision,business_date,kind,evidence)
 values('d7020000-0000-4000-8000-000000000003','ptr-race-company','ptr-race-source',1,current_date,'purchase','{"sourceReference":"PTR-RACE purchase"}');
insert into private.stockflow_economic_source_lines(id,voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values('d7020000-0000-4000-8000-000000000004','d7020000-0000-4000-8000-000000000003','1','ptr-race-product-guid',2,'Nos',100,'{"label":"PTR-RACE-ITEM"}');
create function public.test_ptr_race(p_id uuid,p_actor text,p_key uuid) returns jsonb language plpgsql as $$
begin
 return public.stockflow_po_receipt_gateway('ptr-race-key',p_actor,'receive_from_tally',jsonb_build_object(
  'id',p_id,'expectedVersion',1,'idempotencyKey',p_key,
  'links',jsonb_build_array(jsonb_build_object('itemKey','PTR-RACE-ITEM','sourceId','ptr-race-source','lineKey','1'))));
exception when sqlstate 'PT409' then return jsonb_build_object('error',sqlstate,'message',sqlerrm);
-- Raw unique violations and all unrelated errors must fail the test.
end $$;
revoke all on function public.test_ptr_race(uuid,text,uuid) from public,anon,authenticated;
commit;

do $race$
declare v_a jsonb; v_b jsonb; v_loser jsonb; v_pid integer; v_attempt integer;
begin
 perform public.dblink_connect('ptr_a','dbname='||current_database()||' user='||current_user||' options=-cstatement_timeout=15000');
 perform public.dblink_connect('ptr_b','dbname='||current_database()||' user='||current_user||' options=-cstatement_timeout=15000');
 select pid into v_pid from public.dblink('ptr_b','select pg_backend_pid()') as t(pid integer);
 perform public.dblink_exec('ptr_a','begin');
 select result into v_a from public.dblink('ptr_a',$q$
  select public.test_ptr_race('d7020000-0000-4000-8000-000000000001','ptr-race-a@test.local','d7020000-0000-4000-8000-000000000011')
 $q$) as t(result jsonb);
 if v_a->>'status' is distinct from 'received' or (v_a->>'version')::integer is distinct from 2
  or (v_a->'lines'->0->>'receivedQuantity')::numeric is distinct from 2 then raise exception 'R10: first receipt failed: %',v_a; end if;
 perform public.dblink_send_query('ptr_b',$q$
  select public.test_ptr_race('d7020000-0000-4000-8000-000000000002','ptr-race-b@test.local','d7020000-0000-4000-8000-000000000012')
 $q$);
 for v_attempt in 1..500 loop
  exit when exists(select 1 from pg_locks where pid=v_pid and not granted);
  perform pg_sleep(0.01);
 end loop;
 if not exists(select 1 from pg_locks where pid=v_pid and not granted) then raise exception 'R10: second receipt did not wait on competing link'; end if;
 perform public.dblink_exec('ptr_a','commit');
 select result into v_b from public.dblink_get_result('ptr_b') as t(result jsonb);
 perform * from public.dblink_get_result('ptr_b') as t(result jsonb);
 if v_b is distinct from '{"error":"PT409","message":"Already recorded on another PO"}'::jsonb then
  raise exception 'R10: expected exactly one success and one PT409: %, %',v_a,v_b; end if;
 v_loser:=public.stockflow_po_receipt_gateway('ptr-race-key','ptr-race-b@test.local','get_tally_receipts',
  '{"id":"d7020000-0000-4000-8000-000000000002"}');
 if (v_loser->>'version')::integer is distinct from 1
  or (v_loser->'lines'->0->>'receivedQuantity')::numeric is distinct from 0
  or v_loser->'lines'->0->'candidates' is distinct from '[]'::jsonb then
  raise exception 'R10: losing PO changed or still offers claimed receipt: %',v_loser; end if;
 if (select count(*) from private.stockflow_po_tally_receipt_links
  where company_id='ptr-race-company' and source_id='ptr-race-source' and line_key='1')<>1 then raise exception 'R10: wrong scoped link count'; end if;
 if exists(select 1 from private.stockflow_purchase_order_events where po_id='d7020000-0000-4000-8000-000000000002') then
  raise exception 'R10: losing receipt left an event'; end if;
 perform public.dblink_disconnect('ptr_a');
 perform public.dblink_disconnect('ptr_b');
 raise notice 'PASS R10: two POs race for one voucher line, exactly one succeeds';
end $race$;
drop function public.test_ptr_race(uuid,text,uuid);
update private.stockflow_gateway_config set secret_sha256=(select secret_sha256 from ptr_race_config) where name='orders';
drop table ptr_race_config;
