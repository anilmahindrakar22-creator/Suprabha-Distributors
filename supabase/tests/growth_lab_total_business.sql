begin;

create function pg_temp.t_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Growth lab total business assertion failed: %',label;end if;end$$;

create function pg_temp.t_line(src text,item text,lab text,qty numeric,net bigint,
 kind text default 'sale',d date default '2030-08-10') returns void language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values('total-co',src,1,d,lab,kind,false,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(voucher,'1',item,qty,'pack',net,'{}');
end$$;

do $fixture$
begin
 perform pg_temp.t_line('buy','reagent',null,10,500000,'purchase','2020-01-01');
 -- Lab A: one consumable sale and one bulk invoice of Rs 2.5 L (counts as instrument and bulk).
 perform pg_temp.t_line('sale-a1','reagent','A',1,100000);
 perform pg_temp.t_line('sale-a2','analyser','A',1,25000000);
 -- Lab B: consumables only.
 perform pg_temp.t_line('sale-b1','reagent','B',2,200000);
 -- Lab D: bulk only, so it has no consumables row in the margin list.
 perform pg_temp.t_line('sale-d1','analyser','D',1,25000000);
end$fixture$;

do $checks$
declare model jsonb; r jsonb;
begin
 model:=private.stockflow_growth_margin_model('2031-07-15');
 select value into r from jsonb_array_elements(model->'labs') where value->>'labKey'='total-co|A';
 perform pg_temp.t_assert(r is not null,'T1 lab A present');
 perform pg_temp.t_assert((r->>'totalSalesPaise')::numeric=100000+25000000,'T1 lab A total business includes the bulk invoice');
 perform pg_temp.t_assert((r->>'instrumentSalesPaise')::numeric=25000000,'T1 lab A instrument and bulk part');
 perform pg_temp.t_assert((r->>'salesPaise')::numeric=100000 and (r->>'gpPaise')::numeric=100000-50000,'T2 lab A consumables sales and GP unchanged');
 select value into r from jsonb_array_elements(model->'labs') where value->>'labKey'='total-co|B';
 perform pg_temp.t_assert((r->>'totalSalesPaise')::numeric=200000 and (r->>'instrumentSalesPaise')::numeric=0,'T3 consumables-only lab total equals its sales');
 perform pg_temp.t_assert((r->>'salesPaise')::numeric=200000,'T3 lab B consumables sales unchanged');
 perform pg_temp.t_assert(not exists(select 1 from jsonb_array_elements(model->'labs') x where x->>'labKey'='total-co|D'),'T4 bulk-only lab stays out of the consumables list');
 raise notice 'PASS growth lab total business T1-T4';
end$checks$;

rollback;
