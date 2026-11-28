begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

create function pg_temp.q_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Quarterly lab tiers assertion failed: %',label;end if;end$$;
create function pg_temp.q_line(src text,d date,net bigint) returns void language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values('lab-tiers-quarterly-co',src,1,d,'edge','sale',false,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(voucher,'1','consumable',1,'pack',net,'{}');
end$$;

-- Exercise the migration's exact cleanup against the production-shaped periods.
insert into private.stockflow_lab_tier_snapshots values
 ('2026-10-01','lab-tiers-quarterly-cleanup','kept','silver',2500000,false,now()),
 ('2026-11-01','lab-tiers-quarterly-cleanup','removed','gold',10000000,false,now());
delete from private.stockflow_lab_tier_snapshots where month <> date_trunc('quarter', month)::date;
select pg_temp.q_assert(exists(select 1 from private.stockflow_lab_tier_snapshots
 where month='2026-10-01' and company_id='lab-tiers-quarterly-cleanup' and customer_source_id='kept'),
 'cleanup preserves October quarter snapshot');
select pg_temp.q_assert(not exists(select 1 from private.stockflow_lab_tier_snapshots
 where month='2026-11-01' and company_id='lab-tiers-quarterly-cleanup'),
 'cleanup removes November monthly snapshot');

-- Isolate current/previous periods so refresh must compute and seed both.
delete from private.stockflow_lab_tier_snapshots where month in ('2027-01-01','2026-10-01');
insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
values('lab-tiers-quarterly-co','fixture','2027-01-03',
 '{"groups":[],"products":[{"id":"consumable","name":"Consumable"}]}');
select pg_temp.q_line('base','2026-09-30',5000000);
-- Neither the expired purchase nor the quarter-start purchase belongs to January's window.
select pg_temp.q_line('expired','2025-12-31',120000000);
select pg_temp.q_line('future','2027-01-01',120000000);

do $checks$
declare r jsonb; held jsonb; before_change jsonb; day date;
begin
 r:=private.stockflow_refresh_lab_tiers('2027-01-03');
 perform pg_temp.q_assert(r @> '{"quarter":"2027-01-01","recomputed":true,"previousQuarterSeeded":true}',
  'grace refresh computes January and seeds October');
 perform pg_temp.q_assert((r->>'labs')::bigint=(select count(*) from private.stockflow_lab_tier_snapshots where month='2027-01-01'),
  'refresh reports actual quarter row count');
 perform pg_temp.q_assert((select tier='silver' and consumables_paise=5000000
  from private.stockflow_lab_tier_snapshots where month='2027-01-01' and company_id='lab-tiers-quarterly-co'),
  'January uses only the preceding twelve months');
 perform pg_temp.q_assert((select tier='diamond' from private.stockflow_lab_tier_snapshots
  where month='2026-10-01' and company_id='lab-tiers-quarterly-co'), 'previous quarter seeded from its own window');
 select to_jsonb(s) into before_change from private.stockflow_lab_tier_snapshots s
  where month='2027-01-01' and company_id='lab-tiers-quarterly-co';
 -- Late Tally entry dated before the quarter starts crosses the Silver/Gold band.
 perform pg_temp.q_line('late','2026-12-31',6000000);
 r:=private.stockflow_refresh_lab_tiers('2027-01-20');
 perform pg_temp.q_assert(r @> '{"recomputed":false,"previousQuarterSeeded":false}', 'after grace quarter is held');
 select to_jsonb(s) into held from private.stockflow_lab_tier_snapshots s
  where month='2027-01-01' and company_id='lab-tiers-quarterly-co';
 perform pg_temp.q_assert(held=before_change,'held snapshot including tier, amount and timestamp is unchanged');
 r:=private.stockflow_refresh_lab_tiers('2027-01-05');
 perform pg_temp.q_assert(r @> '{"recomputed":true,"previousQuarterSeeded":false}', 'grace refresh includes late entry');
 perform pg_temp.q_assert((select tier='gold' and consumables_paise=11000000
  from private.stockflow_lab_tier_snapshots where month='2027-01-01' and company_id='lab-tiers-quarterly-co'),
  'late entry moves January to Gold');
 -- Day 7 still recomputes; day 8 holds, even if another late entry arrives.
 r:=private.stockflow_refresh_lab_tiers('2027-01-07');
 perform pg_temp.q_assert(r->>'recomputed'='true','day seven is inside grace');
 perform pg_temp.q_line('later','2026-12-30',100000000);
 r:=private.stockflow_refresh_lab_tiers('2027-01-08');
 perform pg_temp.q_assert(r->>'recomputed'='false','day eight is outside grace');
 for day in select generate_series('2027-01-01'::date,'2027-03-31'::date,interval '1 day')::date loop
  r:=private.stockflow_growth_lab_tiers_read(day,'{}');
  perform pg_temp.q_assert(r @> '{"month":"2027-01-01","stale":false}', 'every date reads January quarter');
 end loop;
 r:=private.stockflow_growth_lab_tiers_read('2027-02-20','{"list":"movers"}');
 perform pg_temp.q_assert(exists(select 1 from jsonb_array_elements(r->'rows') e
  where e @> '{"labKey":"lab-tiers-quarterly-co|edge","tier":"gold","previousTier":"diamond","change":"down"}'),
  'moved tier compares January with October, not December');
 -- A missing current quarter is computed even outside grace.
 delete from private.stockflow_lab_tier_snapshots where month='2027-01-01';
 r:=private.stockflow_refresh_lab_tiers('2027-01-20');
 perform pg_temp.q_assert(r->>'recomputed'='true','missing quarter is computed after grace');
end$checks$;
rollback;
