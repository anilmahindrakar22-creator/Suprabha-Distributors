begin;
set local statement_timeout='300s';
set local lock_timeout='60s';

create function pg_temp.p_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Growth price cards assertion: %',label;end if;end$$;

-- The replay captures the actual installed R1-R4 definition before applying R5.
do $$declare definition text;begin
 select model into strict definition from public.test_growth_price_cards_before;
 execute replace(definition,'private.stockflow_growth_inbox_model','pg_temp.old_inbox_model');
end$$;

-- P5 uses the original inbox fixture, including revision, bulk and priority cases.
create function pg_temp.inbox_sale(src text,lab text,d date,amount bigint,k text default 'sale',rev bigint default 1,cancel boolean default false)
returns void language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values('growth-inbox-co',src,rev,d,lab,k,cancel,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(voucher,'1','inbox-item',1,'pack',amount,'{}');
end$$;
create function pg_temp.inbox_link(lab text) returns uuid language plpgsql as $$
declare customer uuid;
begin
 insert into private.stockflow_customers(name,tally_key,city,created_by_email)
 values('Inbox '||lab,'inbox-'||lab,'Inbox town','test') returning id into customer;
 insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
 values('growth-inbox-co',lab,customer,'test');return customer;
end$$;


savepoint inbox_fixture;
do $p5$
declare i int; j int; d date; old_bytes text; new_bytes text;
begin
 for i in 0..11 loop
  d:=('1900-01-05'::date+i*interval '1 month')::date;
  if i between 3 and 8 then
   perform pg_temp.inbox_sale('regular'||i,'regular',d,1000000);
   perform pg_temp.inbox_sale('bulk'||i,'bulk',d,300000);
   perform pg_temp.inbox_sale('unlinked'||i,'unlinked',d,300000);
   for j in 1..10 loop perform pg_temp.inbox_sale('page'||j||'-'||i,'page'||j,d,200000);end loop;
  end if;
  if i between 4 and 8 then perform pg_temp.inbox_sale('short1'||i,'short1',d,1000000);end if;
  if i<3 then
   perform pg_temp.inbox_sale('stopped'||i,'stopped',d,1000000);
   perform pg_temp.inbox_sale('falling'||i,'falling',d,2000000);
   perform pg_temp.inbox_sale('short3'||i,'short3',d,10000000);
   perform pg_temp.inbox_sale('floor2'||i,'floor2',d,199999);
  end if;
  if i<2 then perform pg_temp.inbox_sale('short2'||i,'short2',d,1000000);end if;
  if i<6 then perform pg_temp.inbox_sale('priority'||i,'priority',d,1000000);end if;
  if i<=6 then perform pg_temp.inbox_sale('floor1'||i,'floor1',d,100000);end if;
 end loop;
 perform pg_temp.inbox_sale('falling-h2','falling','1900-12-05',2500000);
 perform pg_temp.inbox_sale('short3-h2a','short3','1900-12-05',10650000);
 perform pg_temp.inbox_sale('short3-h2b','short3','1900-12-06',10650000);
 perform pg_temp.inbox_sale('priority-h2','priority','1900-10-05',1000000);
 perform pg_temp.inbox_sale('floor1-return','floor1','1900-08-05',-3000000,'return');
 perform pg_temp.inbox_sale('new','new','1900-10-05',500000);
 perform pg_temp.inbox_sale('floor4','floor4','1900-10-05',499999);
 perform pg_temp.inbox_sale('earliest','earliest','1900-01-05',500000);
 perform pg_temp.inbox_sale('bulk-invoice','bulk','1900-12-05',20000000);
 perform pg_temp.inbox_sale('null-ledger',null,'1900-10-05',500000);
 -- Latest revisions must suppress cancelled, moved and recategorized old rows.
 perform pg_temp.inbox_sale('cancelled','cancelled','1900-10-05',500000);
 perform pg_temp.inbox_sale('cancelled','cancelled','1900-10-05',500000,'sale',2,true);
 perform pg_temp.inbox_sale('moved','moved','1900-10-05',500000);
 perform pg_temp.inbox_sale('moved','moved','1901-02-05',500000,'sale',2);
 perform pg_temp.inbox_sale('purchase','purchase','1900-10-05',500000);
 perform pg_temp.inbox_sale('purchase','purchase','1900-10-05',500000,'purchase',2);
 perform pg_temp.inbox_sale('return-net','return-net','1900-10-05',500000);
 perform pg_temp.inbox_sale('return-net-credit','return-net','1900-10-06',-500000,'credit');


 perform pg_temp.inbox_link('regular');perform pg_temp.inbox_link('new');
 perform pg_temp.inbox_link('stopped');perform pg_temp.inbox_link('falling');
 perform pg_temp.inbox_link('page1');perform pg_temp.inbox_link('page2');perform pg_temp.inbox_link('page3');
 select string_agg(row_to_json(m)::text,E'\n' order by card_key) into old_bytes from pg_temp.old_inbox_model('1901-01-15') m;
 select string_agg(row_to_json(m)::text,E'\n' order by card_key) into new_bytes from private.stockflow_growth_inbox_model('1901-01-15') m where rule_key<>'R5';
 perform pg_temp.p_assert(old_bytes is not null and old_bytes=new_bytes,'P5 R1-R4 byte-identical on original inbox fixture');
 perform pg_temp.p_assert((select count(*) from pg_temp.old_inbox_model('1901-01-15'))=17,'P5 all 17 original cards compared');
end$p5$;
rollback to inbox_fixture;

create function pg_temp.p_line(src text,item text,lab text,qty numeric,net bigint,
 d date default '2031-01-10',revision bigint default 1,k text default 'sale') returns void language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values('price-co',src,revision,d,lab,k,false,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(voucher,'1',item,qty,'pack',net,'{}');
end$$;
create function pg_temp.p_payload(lab text,decision text,extras jsonb default '{}',rule text default 'R5',period text default '2031-06')
returns jsonb language sql as $$
 select jsonb_build_object('requestId',gen_random_uuid()::text,'cardKey','price-co|'||lab||'|'||rule||'|'||period,'decision',decision)||extras
$$;
create function pg_temp.p_call(payload jsonb,actor text default 'management') returns jsonb language sql as $$
 select public.stockflow_growth_gateway('price-key','price-'||actor||'@test.local','decide_growth_card',payload)
$$;
create function pg_temp.p_bad(payload jsonb,code text default '22023',message text default null,actor text default 'management')
returns void language plpgsql as $$
declare caught boolean:=false;
begin
 begin perform pg_temp.p_call(payload,actor);
 exception when others then
  if sqlstate<>code or (message is not null and sqlerrm<>message) then raise;end if;
  caught:=true;
 end;
 perform pg_temp.p_assert(caught,'P11 expected '||code||' for '||payload::text);
end$$;
create function pg_temp.p_state(lab text,d date default '2031-07-15',rule text default 'R5') returns text language sql as $$
 select state from private.stockflow_growth_inbox_model(d) where company_id='price-co' and customer_source_id=lab and rule_key=rule
$$;

insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('price-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,roles,status)
select 'price-'||r||'@test.local',r,array[r],'active'
from unnest(array['administrator','management','sales','operations']) r;
do $$declare f text;begin
 select pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure) into f;
 execute replace(f,'(now() at time zone ''Asia/Kolkata'')::date','''2031-07-15''::date');
end$$;

do $fixture$
declare n integer; month_index integer; lab text; price bigint; qty integer;
begin
 for n in 1..9 loop
  lab:=(array['pack','low','near','small','base1','base2','base3','base4','base5'])[n];
  price:=(array[35000,85000,95000,85000,100000,100000,100000,100000,100000])[n];
  qty:=case when lab='small' then 1 else 10 end;
  for month_index in 0..5 loop
   perform pg_temp.p_line(lab||month_index,'reagent',lab,qty,price*qty,('2030-08-10'::date+month_index*interval '1 month')::date);
  end loop;
 end loop;
 insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
 values('price-co','1','2031-07-15','{"products":[{"id":"reagent","name":"Price reagent"},{"id":"second","name":"Second reagent"}]}');
 insert into private.stockflow_products(tally_item_key,name,item_group) values('Price reagent','Price reagent','Test');
 insert into private.stockflow_customers(id,name,tally_key,city,created_by_email)
 values('f5000000-0000-4000-8000-000000000001','Price Low','price-low','Price town','test');
 insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
 values('price-co','low','f5000000-0000-4000-8000-000000000001','test');
end$fixture$;

do $p1_p4$
declare card record; old_card text; current_card text;
begin
 select * into strict card from private.stockflow_growth_inbox_model('2031-07-15') where lab_key='price-co|low' and rule_key='R5';
 perform pg_temp.p_assert(card.card_key='price-co|low|R5|2031-06' and card.rule_version=1 and card.stake_paise=75000
  and card.state='review' and card.action is null and card.also_matches='[]'
  and card.name='Price Low' and card.town='Price town' and card.customer_id='f5000000-0000-4000-8000-000000000001'
  and card.inputs='{"items":1,"annualGapPaise":900000,"lastBoughtOn":"2031-01-10","lines":[{"itemKey":"price-co|reagent|pack","name":"Price reagent","tallyItemKey":"Price reagent","unitPricePaise":85000,"typicalPricePaise":100000,"quantity":60,"gapPaise":900000}]}'::jsonb,
  'P1 exact price card');
 perform pg_temp.p_assert((select count(*) from private.stockflow_growth_price_cards('2031-07-15'))=1,
  'P2 pack difference, near typical and annual floor excluded');
 select row_to_json(m)::text into old_card from pg_temp.old_inbox_model('2031-07-15') m where lab_key='price-co|low';
 select row_to_json(m)::text into current_card from private.stockflow_growth_inbox_model('2031-07-15') m where lab_key='price-co|low' and rule_key='R1';
 perform pg_temp.p_assert(old_card=current_card and (select count(*) from private.stockflow_growth_inbox_model('2031-07-15')
  where lab_key='price-co|low')=2,'P4 R1 and R5 coexist with identical R1 bytes');
end$p1_p4$;

-- P3 covers inclusive validity, draft/pending/superseded, and expired/future approvals.
savepoint price_approvals;
insert into private.stockflow_customer_product_prices(customer_id,tally_item_key,price_amount,valid_from,valid_to,status,
 source_type,reason,created_by_email,approved_by_email,approved_at)
values
 ('f5000000-0000-4000-8000-000000000001','Price reagent',850,'2030-01-01','2031-07-14','approved','customer_contract','test','test','test',now()),
 ('f5000000-0000-4000-8000-000000000001','Price reagent',850,'2031-07-16',null,'approved','customer_contract','test','test','test',now()),
 ('f5000000-0000-4000-8000-000000000001','Price reagent',850,'2031-01-01',null,'draft','customer_contract','test','test',null,null),
 ('f5000000-0000-4000-8000-000000000001','Price reagent',850,'2031-01-01',null,'pending_approval','customer_contract','test','test',null,null),
 ('f5000000-0000-4000-8000-000000000001','Price reagent',850,'2031-01-01',null,'superseded','customer_contract','test','test',null,null);
select pg_temp.p_assert(pg_temp.p_state('low')='review','P3 non-current or unapproved rows retain line');
insert into private.stockflow_customer_product_prices(customer_id,tally_item_key,price_amount,valid_from,valid_to,status,
 source_type,reason,created_by_email,approved_by_email,approved_at)
values('f5000000-0000-4000-8000-000000000001','Price reagent',850,'2031-07-15','2031-07-15','approved',
 'customer_contract','test','test','test',now());
select pg_temp.p_assert(pg_temp.p_state('low') is null,'P3 current approved line excluded');
rollback to price_approvals;

savepoint review_cases;
do $p6_p10$
declare request_payload jsonb; result jsonb; decision_id uuid; total_before bigint;
begin
 request_payload:=pg_temp.p_payload('low','review','{"note":"  Checked the price book  "}');
 select count(*) into total_before from private.stockflow_growth_decisions;
 result:=pg_temp.p_call(request_payload);
 perform pg_temp.p_assert(result=jsonb_build_object('cardKey',request_payload->>'cardKey','decision','review','state','hidden')
  and pg_temp.p_call(request_payload)=result and (select count(*) from private.stockflow_growth_decisions)=total_before+1,
  'P6 review result and idempotent receipt');
 select id into strict decision_id from private.stockflow_growth_decisions where company_id='price-co'
  and decision='reviewed' and note='Checked the price book';
 perform pg_temp.p_assert(exists(select 1 from private.stockflow_economic_audit where action='decide_growth_card'
  and entity_id=decision_id and payload=request_payload),'P6 audited review');
 perform pg_temp.p_assert(pg_temp.p_state('low','2031-08-15')='hidden','P7 reviewed carries to next period');
 perform pg_temp.p_assert(pg_temp.p_call(pg_temp.p_payload('low','undo'))->>'state'='review'
  and pg_temp.p_state('low','2031-08-15')='review','P10 undo reopens and ends carry-over');
end$p6_p10$;
rollback to review_cases;

-- Price evidence changes use later source revisions, preserving append-only business history.
savepoint carry_changes;
select pg_temp.p_call(pg_temp.p_payload('low','review'));
select pg_temp.p_line('low0','reagent','low',10,799000,'2030-08-10',2);
select pg_temp.p_assert(pg_temp.p_state('low','2031-08-15')='hidden','P7 exactly 1 percent reduction remains hidden');
select pg_temp.p_line('low0','reagent','low',10,798940,'2030-08-10',3);
select pg_temp.p_assert(pg_temp.p_state('low','2031-08-15')='review','P7 greater than 1 percent reduction returns');
rollback to carry_changes;

savepoint new_item;
select pg_temp.p_call(pg_temp.p_payload('low','review'));
select pg_temp.p_line('new-low','second','low',1,85000);
select pg_temp.p_line('new-base1','second','base1',1,100000);
select pg_temp.p_line('new-base2','second','base2',1,100000);
select pg_temp.p_line('new-base3','second','base3',1,100000);
select pg_temp.p_assert(pg_temp.p_state('low','2031-08-15')='review','P7 new underpaid item returns');
rollback to new_item;

savepoint reject_cases;
select pg_temp.p_call(pg_temp.p_payload('low','reject','{"category":"agreed_volume_rate"}'));
select pg_temp.p_assert(pg_temp.p_state('low','2031-08-15')='hidden','P8 volume agreement carries over');
select pg_temp.p_line('low0','reagent','low',10,790000,'2030-08-10',2);
select pg_temp.p_assert(pg_temp.p_state('low','2031-08-15')='review','P8 volume agreement lower price returns');
rollback to reject_cases;
select pg_temp.p_call(pg_temp.p_payload('low','reject','{"category":"price"}'));
select pg_temp.p_assert(pg_temp.p_state('low')='hidden' and pg_temp.p_state('low','2031-08-15')='review',
 'P8 price rejection hides only current period');
rollback to reject_cases;

savepoint snooze_cases;
select pg_temp.p_call(pg_temp.p_payload('low','snooze','{"until":"1m"}'));
select pg_temp.p_assert(pg_temp.p_state('low')='hidden' and pg_temp.p_state('low','2031-07-15','R1')='review',
 'P9 R5 snooze leaves R1 visible');
select pg_temp.p_call(pg_temp.p_payload('low','snooze','{"until":"1m"}','R1'));
select pg_temp.p_call(pg_temp.p_payload('low','undo'));
select pg_temp.p_assert(pg_temp.p_state('low')='review' and pg_temp.p_state('low','2031-07-15','R1')='hidden',
 'P9 R5 reopening leaves R1 snooze active');
rollback to snooze_cases;
select pg_temp.p_call(pg_temp.p_payload('low','snooze','{"until":"1m"}','R1'));
select pg_temp.p_assert(pg_temp.p_state('low')='review' and pg_temp.p_state('low','2031-07-15','R1')='hidden',
 'P9 R1 snooze leaves R5 visible');
select pg_temp.p_call(pg_temp.p_payload('low','snooze','{"until":"1m"}'));
select pg_temp.p_call(pg_temp.p_payload('low','undo','{}','R1'));
select pg_temp.p_assert(pg_temp.p_state('low')='hidden' and pg_temp.p_state('low','2031-07-15','R1')='review',
 'P9 R1 reopening leaves R5 snooze active');
rollback to snooze_cases;

do $p11$
declare actor text;
begin
 perform pg_temp.p_bad(pg_temp.p_payload('low','accept','{"actionType":"visit","ownerEmail":"price-sales@test.local","dueOn":"2031-07-16","detail":"Review price"}'),
  '22023','Price cards are reviewed, not accepted');
 perform pg_temp.p_bad(pg_temp.p_payload('low','review','{}','R1'),'22023','Review applies to price cards only');
 perform pg_temp.p_bad(pg_temp.p_payload('low','reject','{"category":"agreed_volume_rate"}','R1'));
 perform pg_temp.p_bad(pg_temp.p_payload('low','review','{"extra":true}'));
 perform pg_temp.p_bad(pg_temp.p_payload('low','review','{"category":"price"}'));
 perform pg_temp.p_bad(pg_temp.p_payload('low','review','{"note":"  "}'));
 perform pg_temp.p_bad(pg_temp.p_payload('low','review',jsonb_build_object('note',repeat('x',501))));
 foreach actor in array array['sales','operations'] loop
  perform pg_temp.p_bad(pg_temp.p_payload('low','review'),'PT403',null,actor);
  begin
   perform public.stockflow_growth_gateway('price-key','price-'||actor||'@test.local','get_growth_inbox','{"filter":"R5","page":1}');
   raise exception 'P11 unauthorized read succeeded';
  exception when sqlstate 'PT403' then null;end;
 end loop;
end$p11$;

-- An existing open action must never turn a price card into an in-progress card.
savepoint open_action;
select pg_temp.p_call(pg_temp.p_payload('low','accept',
 '{"actionType":"visit","ownerEmail":"price-sales@test.local","dueOn":"2031-07-16","detail":"Discuss recurring sales"}','R1'));
select pg_temp.p_assert(pg_temp.p_state('low')='review' and pg_temp.p_state('low','2031-07-15','R1')='in_progress'
 and (select action is null from private.stockflow_growth_inbox_model('2031-07-15') where lab_key='price-co|low' and rule_key='R5'),
 'R5 ignores open commercial actions');
rollback to open_action;

savepoint fractional_prices;
select pg_temp.p_line('fraction-low','second','low',3,255001);
select pg_temp.p_line('fraction-base1','second','base1',3,300002);
select pg_temp.p_line('fraction-base2','second','base2',3,300002);
select pg_temp.p_line('fraction-base3','second','base3',3,300002);
select pg_temp.p_assert((select inputs#>'{lines,1}'=
 '{"itemKey":"price-co|second|pack","name":"Second reagent","tallyItemKey":null,"unitPricePaise":85000,"typicalPricePaise":100001,"quantity":3,"gapPaise":45001}'::jsonb
 and inputs->>'annualGapPaise'='945001' and stake_paise=78750
 from private.stockflow_growth_price_cards('2031-07-15') where lab_key='price-co|low'),
 'P1 fractional prices round only after calculating the gap, unmatched master remains eligible');
rollback to fractional_prices;

savepoint capped_lines;
do $$declare n integer; item text; card record;begin
 for n in 1..51 loop
  item:='cap-'||lpad(n::text,2,'0');
  perform pg_temp.p_line(item||'-low',item,'low',1,85000);
  perform pg_temp.p_line(item||'-base1',item,'base1',1,100000);
  perform pg_temp.p_line(item||'-base2',item,'base2',1,100000);
  perform pg_temp.p_line(item||'-base3',item,'base3',1,100000);
 end loop;
 select * into strict card from private.stockflow_growth_price_cards('2031-07-15') where lab_key='price-co|low';
 perform pg_temp.p_assert(card.inputs->>'items'='52' and card.inputs->>'annualGapPaise'='1665000'
  and card.stake_paise=138750 and jsonb_array_length(card.inputs->'lines')=50
  and card.inputs#>>'{lines,0,itemKey}'='price-co|reagent|pack'
  and card.inputs#>>'{lines,1,itemKey}'='price-co|cap-01|pack'
  and card.inputs#>>'{lines,49,itemKey}'='price-co|cap-49|pack','P1 full totals with 50 ordered display lines');
 perform pg_temp.p_call(pg_temp.p_payload('low','review'));
 perform pg_temp.p_assert(pg_temp.p_state('low','2031-08-15')='review',
  'P7 carry-over checks all current items including ones outside stored 50-line snapshot');
end$$;
rollback to capped_lines;

-- P12 multiple pages, tie ordering, counts and the exact sales-only snapshot keys.
do $p12$
declare n integer; filter_name text; page_number integer; result jsonb; started timestamptz; elapsed interval;
 expected bigint; expected_stake bigint; first_page jsonb; second_page jsonb;
begin
 for n in 1..12 loop
  perform pg_temp.p_line('paging-'||n,'reagent','page-'||lpad(n::text,2,'0'),60,5100000);
 end loop;
 -- Keep the median at 100000 with enough full-price peers.
 for n in 1..20 loop
  perform pg_temp.p_line('peer-'||n,'reagent','peer-'||n,60,6000000);
 end loop;
 select count(*),sum(stake_paise) into expected,expected_stake from private.stockflow_growth_inbox_model('2031-07-15') where state='review';
 foreach filter_name in array array['all','R5','done'] loop
  for page_number in 1..2 loop
   started:=clock_timestamp();
   result:=public.stockflow_growth_gateway('price-key','price-management@test.local','get_growth_inbox',
    jsonb_build_object('filter',filter_name,'page',page_number));
   elapsed:=clock_timestamp()-started;
   raise notice 'P12 inbox filter % page % duration %',filter_name,page_number,elapsed;
   perform pg_temp.p_assert(elapsed<interval '2 seconds','P12 read under 2 seconds');
   perform pg_temp.p_assert((result#>>'{counts,R5}')::integer=13 and (result#>>'{counts,all}')::bigint=expected
    and (result#>>'{counts,toReview}')::bigint=expected and (result->>'stakeToReviewPaise')::bigint=expected_stake
    and result#>>'{counts,done}'='0','P12 counts and stake include R5, done remains action-only');
   if filter_name='R5' then
    perform pg_temp.p_assert(result->>'total'='13' and not exists(select 1 from jsonb_array_elements(result->'rows') r
     where r->>'rule'<>'R5' or r->>'state'<>'review' or r->'action'<>'null'),'P12 filter pages only price cards');
    if page_number=1 then first_page:=result->'rows';else second_page:=result->'rows';end if;
   end if;
  end loop;
 end loop;
 perform pg_temp.p_assert(jsonb_array_length(first_page)=10 and jsonb_array_length(second_page)=3
  and first_page#>>'{0,labKey}'='price-co|low' and second_page#>>'{0,labKey}'='price-co|page-10'
  and not exists(select 1 from jsonb_array_elements(first_page) a join jsonb_array_elements(second_page) b
   on a->>'cardKey'=b->>'cardKey'),'P12 stable, disjoint R5 pages');
 perform pg_temp.p_assert(not exists(select 1 from private.stockflow_growth_price_cards('2031-07-15') c
  where c.inputs-array['items','annualGapPaise','lastBoughtOn','lines']<>'{}'
   or exists(select 1 from jsonb_array_elements(c.inputs->'lines') l
    where l-array['itemKey','name','tallyItemKey','unitPricePaise','typicalPricePaise','quantity','gapPaise']<>'{}')),
  'P12 sales-only keys exclude cost, GP and margin');
end$p12$;

savepoint scale_fixture;
-- P13 has 300 linked labs, 400 catalogued consumables and 15 priced labs per item.
create temporary table price_scale_pairs as
select gen_random_uuid() voucher_id,'item-'||lpad(item_index::text,3,'0') item,
 'lab-'||lpad(((item_index+peer_index*20)%300)::text,3,'0') lab,
 case when peer_index<3 then 1700000 else 2000000 end::bigint net
from generate_series(0,399) item_index cross join generate_series(0,14) peer_index;
create temporary table price_scale_labs as
select gen_random_uuid() customer_id,lab from (select distinct lab from price_scale_pairs) labs;
insert into private.stockflow_customers(id,name,tally_key,city,created_by_email)
select customer_id,'Scale '||lab,'price-scale-'||lab,'Scale town','test' from price_scale_labs;
insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
select 'price-scale-co',lab,customer_id,'test' from price_scale_labs;
insert into private.stockflow_products(tally_item_key,name,item_group)
select 'Scale '||item,'Scale '||item,'Test' from (select distinct item from price_scale_pairs) items;
insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
select 'price-scale-co','1','2031-07-15',jsonb_build_object('products',
 jsonb_agg(jsonb_build_object('id',item,'name','Scale '||item) order by item))
from (select distinct item from price_scale_pairs) items;
insert into private.stockflow_economic_source_vouchers(id,company_id,source_id,source_revision,business_date,
 customer_source_id,kind,cancelled,evidence)
select voucher_id,'price-scale-co',item||'|'||lab,1,'2030-08-10',lab,'sale',false,'{}' from price_scale_pairs;
insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
select voucher_id,'1',item,20,'pack',net,'{}' from price_scale_pairs;

-- Autovacuum cannot collect statistics for this transaction's bulk fixture.
analyze private.stockflow_economic_source_vouchers;
analyze private.stockflow_economic_source_lines;
analyze private.stockflow_economic_customer_identities;
analyze private.stockflow_economic_item_catalogs;
analyze private.stockflow_customers;
analyze private.stockflow_products;

do $p13$
declare started timestamptz; elapsed interval; model jsonb; result jsonb; card_key text;
begin
 started:=clock_timestamp();
 model:=private.stockflow_growth_margin_model('2031-07-15');
 elapsed:=clock_timestamp()-started;
 raise notice 'P13 margin model alone duration %',elapsed;
 perform pg_temp.p_assert((select count(*) from jsonb_array_elements(model->'labs') l
   where l->>'labKey' like 'price-scale-co|%')=300
  and (select count(*) from jsonb_array_elements(model->'items') i where i->>'itemKey' like 'price-scale-co|%')=400
  and (select count(*) from jsonb_array_elements(model->'pairs') p where p->>'labKey' like 'price-scale-co|%')=6000
  and not exists(select 1 from jsonb_array_elements(model->'items') i
   where i->>'itemKey' like 'price-scale-co|%' and (i->>'labs')::integer<>15),
  'P13 scale model contains 300 labs, 400 items and 6000 priced pairs with 15 labs per item');

 started:=clock_timestamp();
 result:=public.stockflow_growth_gateway('price-key','price-management@test.local','get_growth_inbox','{"filter":"all","page":1}');
 elapsed:=clock_timestamp()-started;
 raise notice 'P13 inbox all page 1 duration %',elapsed;
 perform pg_temp.p_assert(elapsed<interval '3 seconds','P13 scale inbox under 3 seconds');
 select r->>'cardKey' into card_key from jsonb_array_elements(result->'rows') r
 where r->>'rule'='R5' and r->>'labKey' like 'price-scale-co|%' order by r->>'cardKey' limit 1;
 perform pg_temp.p_assert(card_key is not null and (result#>>'{counts,R5}')::integer>=300,
  'P13 scale cards are present and reviewable');

 started:=clock_timestamp();
 result:=pg_temp.p_call(jsonb_build_object('requestId',gen_random_uuid()::text,'cardKey',card_key,'decision','review'));
 elapsed:=clock_timestamp()-started;
 raise notice 'P13 review decision duration %',elapsed;
 perform pg_temp.p_assert(elapsed<interval '3 seconds' and result->>'state'='hidden' and result->>'decision'='review'
  and result->>'cardKey'=card_key,'P13 scale review succeeds under 3 seconds');
end$p13$;
rollback to scale_fixture;

rollback;
\echo PASS growth price cards P1-P13
