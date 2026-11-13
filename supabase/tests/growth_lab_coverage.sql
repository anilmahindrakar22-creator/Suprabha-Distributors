begin;

create function pg_temp.l_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Growth lab coverage assertion failed: %',label;end if;end$$;

create function pg_temp.l_line(src text,item text,lab text,qty numeric,net bigint,
 kind text default 'sale',d date default '2030-08-10') returns void language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values('coverage-co',src,1,d,lab,kind,false,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(voucher,'1',item,qty,'pack',net,'{}');
end$$;

do $fixture$
begin
 perform pg_temp.l_line('buy','costed',null,10,500000,'purchase','2020-01-01');
 perform pg_temp.l_line('sale-a','costed','A',1,100000);
 perform pg_temp.l_line('return-a','unknown','A',-1,-10000,'return');
 perform pg_temp.l_line('sale-b','costed','B',1,100000);
 perform pg_temp.l_line('unknown-b','unknown','B',1,100000);
 perform pg_temp.l_line('return-c','unknown','C',-1,-10000,'return');
end$fixture$;

do $checks$
declare model jsonb; r jsonb; expected record; view_name text;
begin
 model:=private.stockflow_growth_margin_model('2031-07-15');
 perform pg_temp.l_assert(jsonb_array_length(model->'labs')=3,'L1 three labs');
 for expected in select * from (values
  ('A',100.0::numeric,100000-10000,100000,100000-50000),
  ('B',50.0::numeric,100000+100000,100000,100000-50000),
  ('C',null::numeric,-10000,0,0)
 ) e(lab,coverage,sales,known,gp) loop
  select value into r from jsonb_array_elements(model->'labs') where value->>'labKey'='coverage-co|'||expected.lab;
  perform pg_temp.l_assert(r is not null and (r->>'coveragePct')::numeric is not distinct from expected.coverage,'L1 coverage '||expected.lab);
  perform pg_temp.l_assert((r->>'salesPaise')::numeric=expected.sales
   and (r->>'knownSalesPaise')::numeric=expected.known
   and (r->>'gpPaise')::numeric=expected.gp
   and (r->>'marginPct')::numeric is not distinct from
    case when expected.known>0 then round(100.0*expected.gp/expected.known,1) end,'L2 unchanged totals '||expected.lab);
 end loop;
 perform pg_temp.l_assert(not exists(select 1 from jsonb_array_elements(model->'labs') x
  where x->'coveragePct' is distinct from 'null'::jsonb
   and ((x->>'coveragePct')::numeric not between 0 and 100 or x->>'coveragePct' is null)), 'L3 bounded coverage');
 -- Two costed-item labs give no typical price; their pair and item totals stay exact.
 foreach view_name in array array['items','pairs'] loop
  perform pg_temp.l_assert((select count(*) from jsonb_array_elements(model->view_name) x
   where x->>'itemKey'='coverage-co|costed|pack')=case view_name when 'items' then 1 else 2 end,'L4 row count '||view_name);
  for r in select value from jsonb_array_elements(model->view_name) where value->>'itemKey'='coverage-co|costed|pack' loop
   perform pg_temp.l_assert(r->'typicalPricePaise'='null'::jsonb
    and (r->>'salesPaise')::numeric=case view_name when 'items' then 2*100000 else 100000 end
    and (r->>'gpPaise')::numeric=case view_name when 'items' then 2*(100000-50000) else 100000-50000 end,'L4 unchanged '||view_name);
  end loop;
 end loop;
 raise notice 'PASS growth lab coverage L1-L4';
end$checks$;

rollback;
