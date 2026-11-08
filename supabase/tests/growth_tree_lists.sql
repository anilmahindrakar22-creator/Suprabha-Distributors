begin;
set local lock_timeout='60s';
set local statement_timeout='300s';

create function pg_temp.tree_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Growth tree assertion: %',label;end if;end$$;
create function pg_temp.tree_sale(src text,lab text,d date,amount bigint,k text default 'sale',rev bigint default 1,cancel boolean default false)
returns void language plpgsql as $$
declare v uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values('growth-tree-co',src,rev,d,lab,k,cancel,'{}') returning id into v;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(v,'1','tree-item',1,'pack',amount,'{}');
end$$;
create function pg_temp.tree_read(payload jsonb) returns jsonb language plpgsql as $$
declare r jsonb;t timestamptz:=clock_timestamp();elapsed interval;
begin
 if payload is null then r:=private.stockflow_growth_read('1903-01-15',array['management']);
 else r:=private.stockflow_growth_labs_read('1903-01-15',array['management'],payload);end if;
 elapsed:=clock_timestamp()-t;raise notice 'T6 read %: %',coalesce(payload->>'list','get_growth'),elapsed;
 perform pg_temp.tree_assert(elapsed<interval '2 seconds','read under 2s');return r;
end$$;

do $test$
declare base jsonb;r jsonb;q jsonb;old_list jsonb;bad jsonb;h text;s text;idx int;i int;
 customer uuid:=gen_random_uuid();anchor text;current_body text;
begin
 raise notice 'Growth tree baseline';
 base:=pg_temp.tree_read(null);
 perform pg_temp.tree_assert(base#>>'{tree,revenuePaise}'='0','isolated fixed window');
 -- Check the guarded dispatch; T5 below verifies the original list path.
 select prosrc into current_body from pg_proc where oid='private.stockflow_growth_labs_read(date,text[],jsonb)'::regprocedure;
 anchor:=$anchor$if list_name in ('window_labs','bulk_invoices') then
  return private.stockflow_growth_tree_labs_read(p_today,p_roles,p_payload);
 end if;
 $anchor$;
 perform pg_temp.tree_assert(position(anchor in replace(current_body,chr(13),''))>0,'guarded new-list dispatch');

 perform pg_temp.tree_sale('a1','A','1902-01-01',100);
 perform pg_temp.tree_sale('a2','A','1902-02-01',100);
 -- B has 50 repeat paise in one month and a bulk-only month. Its repeat
 -- average is 50, between the no-ledger lab's 70 and D's 40; bulk must affect
 -- neither the numerator nor the denominator of per_month.
 perform pg_temp.tree_sale('b1','B','1902-01-01',50);
 perform pg_temp.tree_sale('b2','B','1902-07-01',20000000);
 perform pg_temp.tree_sale('c1','C','1902-01-01',150);
 perform pg_temp.tree_sale('c2','C','1902-07-01',150);
 perform pg_temp.tree_sale('z','Z','1902-01-02',25000000);
 perform pg_temp.tree_sale('r1','R','1902-01-01',200);
 perform pg_temp.tree_sale('r2','R','1902-08-01',-400,'return');
 perform pg_temp.tree_sale('n1','N','1902-01-01',100);
 perform pg_temp.tree_sale('n2','N','1902-02-01',-100,'credit');
 perform pg_temp.tree_sale('null',null,'1902-07-01',70);
 perform pg_temp.tree_sale('d','D','1902-01-01',40);
 perform pg_temp.tree_sale('e','E','1902-01-01',100);
 perform pg_temp.tree_sale('cancel','Z','1902-01-01',99000000);
 perform pg_temp.tree_sale('cancel','Z','1902-01-01',99000000,'sale',2,true);
 perform pg_temp.tree_sale('moved','Z','1902-01-01',99000000);
 perform pg_temp.tree_sale('moved','Z','1903-01-01',99000000,'sale',2);
 perform pg_temp.tree_sale('purchase','Z','1902-01-01',99000000,'purchase');
 insert into private.stockflow_customers(id,name,tally_key,city,created_by_email)
 values(customer,'Linked B','growth-tree-linked','Town B','test');
 insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
 values('growth-tree-co','B',customer,'test');
 insert into private.stockflow_economic_ledger_generations(company_id,source_version,observed_at,valid,catalog_version,content_hash,row_count)
 values('growth-tree-co','old','1902-01-01',true,'old','old',1),('growth-tree-co','new','1902-02-01',true,'new','new',1),
 ('growth-tree-co','invalid','1902-03-01',false,null,null,null);
 insert into private.stockflow_economic_ledger_masters(company_id,source_version,guid,name)
 values('growth-tree-co','old','Z','Old Z'),('growth-tree-co','new','Z','Current Z');
 r:=pg_temp.tree_read(null);
 raise notice 'Growth tree T1: exact non-bulk buying membership, including zero and negative scope nets';
 foreach h in array array[null::text,'H1','H2'] loop
  q:=pg_temp.tree_read(jsonb_build_object('list','window_labs','page',1)||case when h is null then '{}'::jsonb else jsonb_build_object('half',h) end);
  idx:=case h when 'H1' then 0 else 1 end;
  perform pg_temp.tree_assert(q->>'total'=case when h is null then r#>>'{tree,labsBuying}' else r#>>array['halves',idx::text,'labsBuying'] end,'T1 parity '||coalesce(h,'window'));
  perform pg_temp.tree_assert((q->>'total')::int=case h when 'H1' then 7 when 'H2' then 2 else 8 end,'T1 exact count');
  if h is null then
   perform pg_temp.tree_assert(exists(select 1 from jsonb_array_elements(q->'rows') l where l->>'labKey'='growth-tree-co|R' and l->>'valuePaise'='-200')
    and exists(select 1 from jsonb_array_elements(q->'rows') l where l->>'labKey'='growth-tree-co|N' and l->>'valuePaise'='0')
    and not exists(select 1 from jsonb_array_elements(q->'rows') l where l->>'labKey'='growth-tree-co|Z'),'T1 exact tree membership over net filter');
  else
   perform pg_temp.tree_assert(exists(select 1 from jsonb_array_elements(q->'rows') l where l->>'labKey'='growth-tree-co|C' and l->>'monthsBought'='2' and l->>'valuePaise'='150'),'half value and window monthsBought');
  end if;
 end loop;
 raise notice 'Growth tree T2: exact per-month order and labKey ties';
 q:=pg_temp.tree_read('{"list":"window_labs","page":1,"sort":"per_month"}');
 perform pg_temp.tree_assert((select jsonb_agg(l->>'labKey' order by ord) from jsonb_array_elements(q->'rows') with ordinality a(l,ord))=
  '["growth-tree-co|C","growth-tree-co|A","growth-tree-co|E","growth-tree-co|(no ledger)","growth-tree-co|B","growth-tree-co|D","growth-tree-co|N","growth-tree-co|R"]'::jsonb,'T2 repeat-only per_month order and ties');
 perform pg_temp.tree_assert(q#>>'{rows,4,valuePaise}'='20000050' and q#>>'{rows,4,monthsBought}'='2',
  'T2 mixed bulk/repeat lab ranks by repeat average while retaining total value and window months');
 q:=pg_temp.tree_read('{"list":"window_labs","half":"H1","page":1,"sort":"per_month"}');
 perform pg_temp.tree_assert(q#>>'{rows,0,labKey}'='growth-tree-co|R' and q#>>'{rows,1,labKey}'='growth-tree-co|C'
  and q#>>'{rows,2,labKey}'='growth-tree-co|A','T2 repeat-only half denominator');
 foreach s in array array['value','months','last'] loop
  q:=pg_temp.tree_read(jsonb_build_object('list','window_labs','page',1,'sort',s));
  perform pg_temp.tree_assert(q#>>'{rows,0,labKey}'=case s when 'value' then 'growth-tree-co|B' when 'months' then 'growth-tree-co|B' else 'growth-tree-co|(no ledger)' end,'T2 existing sorts '||s);
 end loop;
 q:=pg_temp.tree_read('{"list":"window_labs","page":2}');
 perform pg_temp.tree_assert(q->>'total'='8' and q->'rows'='[]'::jsonb,'empty later page preserves total');
 raise notice 'Growth tree T3: bulk totals, voucher rows, names and halves';
 foreach h in array array[null::text,'H1','H2'] loop
  q:=pg_temp.tree_read(jsonb_build_object('list','bulk_invoices','page',1)||case when h is null then '{}'::jsonb else jsonb_build_object('half',h) end);
  idx:=case h when 'H1' then 0 else 1 end;
  perform pg_temp.tree_assert(q->>'total'=case when h is null then r#>>'{tree,bulkInvoices}' else r#>>array['halves',idx::text,'bulkInvoices'] end,'T3 bulk count '||coalesce(h,'window'));
  if h is null then
   perform pg_temp.tree_assert(q->'rows'=jsonb_build_array(
    jsonb_build_object('invoice',true,'name','Current Z','customerId',null,'valuePaise',25000000,'date','1902-01-02'),
    jsonb_build_object('invoice',true,'name','Linked B','customerId',customer,'valuePaise',20000000,'date','1902-07-01')),'T3 exact invoice rows');
  else perform pg_temp.tree_assert(jsonb_array_length(q->'rows')=1 and q#>>'{rows,0,name}'=case h when 'H1' then 'Current Z' else 'Linked B' end,'T3 half rows');end if;
 end loop;
 q:=pg_temp.tree_read('{"list":"bulk_invoices","page":1,"sort":"last"}');
 perform pg_temp.tree_assert(q#>>'{rows,0,name}'='Linked B','T3 last sort');
 raise notice 'Growth tree T4: validation and private access';
 foreach bad in array array[
 '{"list":"month_buying","month":"1902-01","page":1,"half":"H1"}'::jsonb,
 '{"list":"regular_labs","page":1,"sort":"per_month"}',
 '{"list":"bulk_invoices","page":1,"sort":"per_month"}',
 '{"list":"bulk_invoices","page":1,"sort":"months"}',
 '{"list":"window_labs","page":1,"half":"H3"}',
 '{"list":"window_labs","page":1,"half":null}',
 '{"list":"window_labs","page":1,"half":1}',
 '{"list":"window_labs","page":1,"month":"1902-01"}',
 '{"list":"bulk_invoices","page":1,"regularOnly":false}',
 '{"list":"window_labs","page":0}', '{"list":"window_labs","page":2147483648}',
 '{"list":"bulk_invoices","page":1,"sort":null}', '{"list":"window_labs","page":1,"extra":1}' ] loop
  begin perform pg_temp.tree_read(bad);raise exception 'Invalid payload accepted: %',bad;
  exception when sqlstate '22023' then null;end;
 end loop;
 begin perform private.stockflow_growth_labs_read('1903-01-15',array['sales'],'{"list":"window_labs","page":1}');raise exception 'sales admitted';
 exception when sqlstate '42501' then null;end;
 perform pg_temp.tree_assert(not has_function_privilege('service_role','private.stockflow_growth_tree_labs_read(date,text[],jsonb)','EXECUTE'),'gateway-only helper');
 perform pg_temp.tree_assert((select proconfig @> array['statement_timeout=20s'] from pg_proc where oid='public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure),'gateway timeout');
 raise notice 'Growth tree T5: existing list parity and row contract';
 q:=pg_temp.tree_read('{"list":"month_buying","month":"1902-01","page":1}');
 perform pg_temp.tree_assert(q->>'total'=r#>>'{months,0,labsBuying}','T5 original P6 parity');
 old_list:=pg_temp.tree_read('{"list":"month_buying","month":"1902-01","page":1,"sort":"months"}');
 perform pg_temp.tree_assert((select l from jsonb_array_elements(old_list->'rows') l where l->>'labKey'='growth-tree-co|B')=
  jsonb_build_object('labKey','growth-tree-co|B','customerId',customer,'name','Linked B','town','Town B',
   'valuePaise',50,'monthsBought',2,'lastBoughtOn','1902-07-01','trend','down'),'T5 existing row unchanged');
 raise notice 'PASS growth tree lists T1-T6';
end$test$;
rollback;
