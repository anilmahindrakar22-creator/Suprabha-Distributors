begin;
set local statement_timeout='60s';

create function pg_temp.u_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Unlinked PO receipts: %',label; end if; end$$;

create function pg_temp.u_po(item text,created timestamptz,po_status text default 'open',po_no text default null)
returns uuid language plpgsql as $$
declare po uuid:=gen_random_uuid();
begin
 insert into private.stockflow_purchase_orders(id,po_number,supplier_name,status,created_by_email,created_at)
 values(po,coalesce(po_no,'UNLINKED-'||po),'Unlinked fixture supplier',po_status,'unlinked-operations@test.local',created);
 insert into private.stockflow_purchase_order_lines(po_id,tally_item_key,item_name,quantity,received_quantity,unit)
 values(po,item,item,20,case when po_status='received' then 20 else 3 end,'Nos');
 return po;
end$$;

create function pg_temp.u_source(src text,item text,qty numeric,d date default '2099-06-30',
 revision bigint default 1,cancelled boolean default false,kind text default 'purchase',ref text default null)
returns uuid language plpgsql as $$
declare voucher uuid; line uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,kind,cancelled,evidence)
 values('unlinked-fixture-company',src,revision,d,kind,cancelled,jsonb_build_object('sourceReference',ref)) returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(voucher,'1','unlinked-product-guid',qty,'Nos',500,jsonb_build_object('label',item)) returning id into line;
 return line;
end$$;

create function pg_temp.u_link(po uuid,item text,src text,line uuid,qty numeric) returns void language sql as $$
 insert into private.stockflow_po_tally_receipt_links(po_id,tally_item_key,company_id,source_id,line_key,
  source_line_id,business_date,quantity,unit,linked_by)
 values(po,item,'unlinked-fixture-company',src,'1',line,'2099-06-30',qty,'Nos','unlinked-operations@test.local');
$$;

insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('unlinked-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,roles,status)
select 'unlinked-'||r||'@test.local',r,array[r],'active'
from unnest(array['accounts','operations','administrator','management']) r;
insert into private.stockflow_products(tally_item_key,name,base_unit)
values('UNLINKED-ITEM','Unlinked product name','Nos');

do $tests$
declare r jsonb; row jsonb; po uuid; earliest uuid; line uuid; payload jsonb; role_name text; i integer;
begin
 perform pg_temp.u_assert(private.stockflow_unlinked_po_receipts('2099-06-30',1)->'rows'='[]'::jsonb,'empty read');
 -- 1/2/3: unlinked, partly linked and fully linked, including reference trim/fallback.
 perform pg_temp.u_source('unlinked-none','UNLINKED-ITEM',10,'2099-06-30',1,false,'purchase','  Bill A  ');
 po:=pg_temp.u_po('UNLINKED-ITEM','2099-06-01','received');
 line:=pg_temp.u_source('unlinked-partial','UNLINKED-ITEM',12);
 perform pg_temp.u_link(po,'UNLINKED-ITEM','unlinked-partial',line,10);
 line:=pg_temp.u_source('unlinked-full','UNLINKED-ITEM',5);
 perform pg_temp.u_link(po,'UNLINKED-ITEM','unlinked-full',line,5);
 -- 4: excluded cancellation, sale, old date, future date and nonpositive quantities.
 perform pg_temp.u_source('unlinked-cancelled','UNLINKED-ITEM',10,'2099-06-30',1,true);
 perform pg_temp.u_source('unlinked-sale','UNLINKED-ITEM',10,'2099-06-30',1,false,'sale');
 perform pg_temp.u_source('unlinked-old','UNLINKED-ITEM',10,date '2099-06-30'-31);
 perform pg_temp.u_source('unlinked-future','UNLINKED-ITEM',10,'2099-07-01');
 perform pg_temp.u_source('unlinked-zero','UNLINKED-ITEM',0);
 perform pg_temp.u_source('unlinked-negative','UNLINKED-ITEM',-1);
 -- 5: latest revision only; link quantities follow source identity across revisions.
 line:=pg_temp.u_source('unlinked-revised','UNLINKED-FALLBACK',8,'2099-06-01');
 po:=pg_temp.u_po('UNLINKED-FALLBACK','2099-05-01','received');
 perform pg_temp.u_link(po,'UNLINKED-FALLBACK','unlinked-revised',line,2);
 perform pg_temp.u_source('unlinked-revised','UNLINKED-FALLBACK',9,'2099-06-01',2);
 -- 6: created date uses Kolkata; creation and PO number both determine the earliest eligible hint.
 -- Earlier open POs must also pass the receive sheet's unit and remaining-quantity rules.
 po:=pg_temp.u_po('UNLINKED-ITEM','2099-05-01','open');
 update private.stockflow_purchase_order_lines set unit='Box' where po_id=po;
 r:=private.stockflow_unlinked_po_receipts('2099-06-30',1);
 select x into row from jsonb_array_elements(r->'rows') x where x->>'sourceId'='unlinked-none';
 perform pg_temp.u_assert(row->'openPo'='null'::jsonb,'6 different unit has no open PO hint');
 po:=pg_temp.u_po('UNLINKED-ITEM','2099-05-02','open');
 update private.stockflow_purchase_order_lines set received_quantity=15 where po_id=po;
 r:=private.stockflow_unlinked_po_receipts('2099-06-30',1);
 select x into row from jsonb_array_elements(r->'rows') x where x->>'sourceId'='unlinked-none';
 perform pg_temp.u_assert(row->'openPo'='null'::jsonb,'6 still due less than purchase quantity has no open PO hint');
 perform pg_temp.u_po('UNLINKED-ITEM','2099-07-01','open');
 perform pg_temp.u_po('UNLINKED-ITEM','2099-05-01','cancelled');
 perform pg_temp.u_po('UNLINKED-ITEM','2099-06-02','open');
 perform pg_temp.u_po('UNLINKED-ITEM','2099-05-31 20:00:00+00','open','UNLINKED-B');
 earliest:=pg_temp.u_po('UNLINKED-ITEM','2099-05-31 20:00:00+00','open','UNLINKED-A');
 -- Only ineligible POs for fallback item: after purchase, received, cancelled, or no due quantity.
 perform pg_temp.u_po('UNLINKED-FALLBACK','2099-06-02','open');
 perform pg_temp.u_po('UNLINKED-FALLBACK','2099-05-01','cancelled');
 po:=pg_temp.u_po('UNLINKED-FALLBACK','2099-05-01','open');
 update private.stockflow_purchase_order_lines set received_quantity=quantity where po_id=po;

 r:=private.stockflow_unlinked_po_receipts('2099-06-30',1);
 perform pg_temp.u_assert(r->>'page'='1' and r->>'pageSize'='20' and r->>'total'='3'
  and jsonb_array_length(r->'rows')=3,'1-5 exact kept rows');
 select x into row from jsonb_array_elements(r->'rows') x where x->>'sourceId'='unlinked-none';
 perform pg_temp.u_assert((row->>'unlinkedQuantity')::numeric=10 and (row->>'linkedQuantity')::numeric=0
  and row->>'reference'='Bill A' and row->>'itemName'='Unlinked product name','1 no links/name/reference');
 perform pg_temp.u_assert(row->'openPo'=jsonb_build_object('id',earliest,'poNumber','UNLINKED-A','stillDue',17),'6 earliest eligible open PO');
 select x into row from jsonb_array_elements(r->'rows') x where x->>'sourceId'='unlinked-partial';
 perform pg_temp.u_assert((row->>'quantity')::numeric=12 and (row->>'linkedQuantity')::numeric=10 and (row->>'unlinkedQuantity')::numeric=2
  and row->>'reference'='unlinked-partial','2 partial link/reference fallback');
 select x into row from jsonb_array_elements(r->'rows') x where x->>'sourceId'='unlinked-revised';
 perform pg_temp.u_assert((row->>'quantity')::numeric=9 and (row->>'linkedQuantity')::numeric=2 and (row->>'unlinkedQuantity')::numeric=7
  and row->>'itemName'='UNLINKED-FALLBACK' and row->'openPo'='null'::jsonb,'5 latest/boundary date; 6 no eligible hint');
 perform pg_temp.u_assert(r->'rows'->0->>'sourceId'='unlinked-none'
  and r->'rows'->1->>'sourceId'='unlinked-partial' and r->'rows'->2->>'date'='2099-06-01','date/reference order');
 -- 7: assert exact key set, so any money field fails this contract.
 for row in select x from jsonb_array_elements(r->'rows') x loop
  perform pg_temp.u_assert((select array_agg(k order by k) from jsonb_object_keys(row) k)=
   array['date','itemKey','itemName','lineKey','linkedQuantity','openPo','quantity','reference','sourceId','unit','unlinkedQuantity'],
   '7 exact row keys');
 end loop;
 -- 8: 3 initial kept rows plus 18 = 21; page 2 has exactly one row.
 for i in 1..18 loop perform pg_temp.u_source('unlinked-page-'||lpad(i::text,2,'0'),'UNLINKED-PAGE',1); end loop;
 r:=private.stockflow_unlinked_po_receipts('2099-06-30',2);
 perform pg_temp.u_assert(r->>'total'='21' and r->>'page'='2' and r->>'pageSize'='20'
  and jsonb_array_length(r->'rows')=1 and r->'rows'->0->>'sourceId'='unlinked-revised','8 pagination');
 perform pg_temp.u_assert(private.stockflow_unlinked_po_receipts('2099-06-30',3)->'rows'='[]'::jsonb,'empty page');
 -- 9: authorization and strict payload/action validation.
 begin perform public.stockflow_po_unlinked_gateway('unlinked-key','unlinked-accounts@test.local','get_unlinked_receipts','{"page":1}');
  raise exception 'Accounts accepted'; exception when sqlstate '42501' then null; end;
 begin perform public.stockflow_po_unlinked_gateway('bad-key','unlinked-operations@test.local','get_unlinked_receipts','{"page":1}');
  raise exception 'Bad key accepted'; exception when sqlstate '42501' then null; end;
 for payload in select x from jsonb_array_elements('[{"page":0},{"page":101},{"page":1,"extra":true},{"page":"1"},
  {"page":1.5},{},null,[],{"page":null},{"page":100000000000000000000000}]') x loop
  begin perform public.stockflow_po_unlinked_gateway('unlinked-key','unlinked-operations@test.local','get_unlinked_receipts',payload);
   raise exception 'Invalid payload accepted: %',payload; exception when sqlstate '22023' then null; end;
 end loop;
 begin perform public.stockflow_po_unlinked_gateway('unlinked-key','unlinked-operations@test.local','unknown','{"page":1}');
  raise exception 'Unknown action accepted'; exception when sqlstate '22023' then null; end;
 begin perform public.stockflow_po_unlinked_gateway('unlinked-key','unlinked-operations@test.local',null,'{"page":1}');
  raise exception 'Null action accepted'; exception when sqlstate '22023' then null; end;
 foreach role_name in array array['operations','administrator','management'] loop
  perform pg_temp.u_assert(public.stockflow_po_unlinked_gateway('unlinked-key','unlinked-'||role_name||'@test.local',
   'get_unlinked_receipts','{"page":1}')=private.stockflow_unlinked_po_receipts((now() at time zone 'Asia/Kolkata')::date,1),'allowed gateway dispatch');
 end loop;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  perform pg_temp.u_assert(not has_function_privilege(role_name,'private.stockflow_unlinked_po_receipts(date,integer)','execute'),'private ACL');
 end loop;
end$tests$;
rollback;
