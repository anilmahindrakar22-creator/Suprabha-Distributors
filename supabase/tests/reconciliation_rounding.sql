begin;

create function pg_temp.rr_assert(ok boolean,message text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception '%',message;end if;
end$$;

-- Dedicated company/source IDs keep these rollback-only fixtures isolated from
-- fixtures committed by the concurrency suites.
create function pg_temp.rr_line(company text,source text,revision integer,net bigint,
 rounding bigint default null,kind text default 'sale',cancelled boolean default false)
returns void language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,
  business_date,customer_source_id,kind,cancelled,evidence)
 values(company,source,revision,'2026-07-10','reconciliation-rounding-customer',kind,cancelled,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,gst_paise,evidence)
 values(voucher,'1','reconciliation-rounding-product',case when net<0 then -1 else 1 end,'Nos',net,0,
  jsonb_strip_nulls(jsonb_build_object('netSalesPaise',net,'roundingPaise',rounding)));
end$$;

create function pg_temp.rr_control(company text,net bigint) returns void language plpgsql as $$
begin
 insert into private.stockflow_sales_control_imports(company_id,source_version,valid_months)
 values(company,'2026-10-01T00:00:00Z',array['2026-07-01'::date]);
 insert into private.stockflow_sales_control_totals(company_id,month,kind,source_key,name,net_paise,source_version)
 values(company,'2026-07-01','sales_ledger','reconciliation-rounding-sales','Sales',net,'2026-10-01T00:00:00Z');
end$$;

select pg_temp.rr_line('reconciliation-rounding-rr1','rr1-sale',1,10037,37);
select pg_temp.rr_control('reconciliation-rounding-rr1',10000);
select pg_temp.rr_line('reconciliation-rounding-rr2','rr2-sale',1,9987,-13);
select pg_temp.rr_control('reconciliation-rounding-rr2',10000);
select pg_temp.rr_line('reconciliation-rounding-rr3','rr3-sale',1,10000);
select pg_temp.rr_control('reconciliation-rounding-rr3',10000);
select pg_temp.rr_line('reconciliation-rounding-rr4','rr4-sale',1,10137,37);
select pg_temp.rr_control('reconciliation-rounding-rr4',10000);
select pg_temp.rr_line('reconciliation-rounding-rr5','rr5-sale',1,10037,37);
select pg_temp.rr_line('reconciliation-rounding-rr5','rr5-return',1,-2011,-11,'return');
select pg_temp.rr_control('reconciliation-rounding-rr5',8000);
select pg_temp.rr_line('reconciliation-rounding-rr6','rr6-revised',1,2049,49);
select pg_temp.rr_line('reconciliation-rounding-rr6','rr6-revised',2,10037,37);
select pg_temp.rr_line('reconciliation-rounding-rr6','rr6-cancelled',1,3031,31);
select pg_temp.rr_line('reconciliation-rounding-rr6','rr6-cancelled',2,3031,31,'sale',true);
select pg_temp.rr_control('reconciliation-rounding-rr6',10000);
select pg_temp.rr_line('reconciliation-rounding-rr7','rr7-sale',1,10037,37);

do $test$
declare result jsonb; stored_before jsonb; stored_after jsonb;
begin
 select jsonb_object_agg(l.voucher_id::text||'/'||l.line_key,l.net_sales_paise) into stored_before
 from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
 where v.company_id like 'reconciliation-rounding-rr%';

 -- RR1 positive round-off is excluded from the exact Sales Accounts comparison.
 result:=private.stockflow_sales_reconciliation('reconciliation-rounding-rr1','2026-07-01');
 perform pg_temp.rr_assert(result @> '{"state":"matches","differencePaise":0,"appNetPaise":10000,"tallyNetPaise":10000,"roundOffPaise":37}',
  'RR1 positive rounding failed: '||result::text);
 -- RR2 subtracting negative round-off restores the Sales Accounts amount.
 result:=private.stockflow_sales_reconciliation('reconciliation-rounding-rr2','2026-07-01');
 perform pg_temp.rr_assert(result @> '{"state":"matches","differencePaise":0,"appNetPaise":10000,"roundOffPaise":-13}',
  'RR2 negative rounding failed: '||result::text);
 -- RR3 older evidence with no roundingPaise contributes zero round-off.
 result:=private.stockflow_sales_reconciliation('reconciliation-rounding-rr3','2026-07-01');
 perform pg_temp.rr_assert(result @> '{"state":"matches","differencePaise":0,"appNetPaise":10000,"roundOffPaise":0}',
  'RR3 absent rounding failed: '||result::text);
 -- RR4 a real one-rupee difference remains a mismatch.
 result:=private.stockflow_sales_reconciliation('reconciliation-rounding-rr4','2026-07-01');
 perform pg_temp.rr_assert(result @> '{"state":"differs","differencePaise":100,"appNetPaise":10100,"roundOffPaise":37}',
  'RR4 real difference hidden: '||result::text);
 -- RR5 a signed return carries its own signed rounding amount.
 result:=private.stockflow_sales_reconciliation('reconciliation-rounding-rr5','2026-07-01');
 perform pg_temp.rr_assert(result @> '{"state":"matches","differencePaise":0,"appNetPaise":8000,"tallyNetPaise":8000,"roundOffPaise":26}',
  'RR5 return rounding failed: '||result::text);
 -- RR6 both sums use only the latest uncancelled revision.
 result:=private.stockflow_sales_reconciliation('reconciliation-rounding-rr6','2026-07-01');
 perform pg_temp.rr_assert(result @> '{"state":"matches","differencePaise":0,"appNetPaise":10000,"roundOffPaise":37}',
  'RR6 cancelled or superseded lines counted: '||result::text);
 -- RR7 missing controls retain their explicit state and null difference.
 result:=private.stockflow_sales_reconciliation('reconciliation-rounding-rr7','2026-07-01');
 perform pg_temp.rr_assert(result @> '{"state":"no_control","differencePaise":null,"tallyNetPaise":null,"appNetPaise":10000,"roundOffPaise":37}',
  'RR7 missing control failed: '||result::text);
 -- RR8 all stored line amounts survive the reads exactly, including round-off.
 select jsonb_object_agg(l.voucher_id::text||'/'||l.line_key,l.net_sales_paise) into stored_after
 from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
 where v.company_id like 'reconciliation-rounding-rr%';
 perform pg_temp.rr_assert(stored_before is not null and stored_after=stored_before,'RR8 stored net sales changed');
 perform pg_temp.rr_assert((select l.net_sales_paise=10037
  from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
  where v.company_id='reconciliation-rounding-rr1'),'RR8 positive round-off was removed from storage');
end $test$;

-- Malformed evidence must raise at the numeric cast.
do $malformed$
declare voucher uuid; raised boolean:=false;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,kind,evidence)
 values('reconciliation-rounding-malformed','rr-malformed',1,'2026-07-10','sale','{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(voucher,'1','reconciliation-rounding-product',1,'Nos',10037,'{"netSalesPaise":10037,"roundingPaise":"invalid"}');
 begin
  perform private.stockflow_sales_reconciliation('reconciliation-rounding-malformed','2026-07-01');
 exception when invalid_text_representation then raised:=true;
 end;
 perform pg_temp.rr_assert(raised,'Malformed roundingPaise was ignored');
end $malformed$;

rollback;
