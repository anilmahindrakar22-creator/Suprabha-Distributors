begin;
insert into public.stockflow_members(email,role,status) values ('recent-sales@test.local','sales','active');
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('recent-test-key','sha256'),'hex') where name='orders';
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values
 ('71000000-0000-4000-8000-000000000001','Different display name','Recent Ledger','test'),
 ('71000000-0000-4000-8000-000000000002','Recent Ledger',null,'test');
-- No customers/economics payload: this changes only the disposable snapshot.
insert into public.stockflow_snapshots(id,company,fetched_at,payload) values ('suprabha','RECENT TEST',now()::text,jsonb_build_object(
 'catalog',jsonb_build_array(
  jsonb_build_object('tallyKey','A','item','Product A','active',true),
  jsonb_build_object('tallyKey','B','item','Product B','active',true),
  jsonb_build_object('tallyKey','OLD','item','Old product','active',false),
  jsonb_build_object('tallyKey','DUP1','item','Duplicate','active',true),
  jsonb_build_object('tallyKey','DUP2','item','duplicate','active',true)),
 'tallyInvoices','[
 {"masterId":"2","voucherNumber":"S2","party":" recent   ledger ","date":"20260920","lineItems":[{"itemName":"Product A","quantity":4},{"itemName":"Product A","quantity":2},{"itemName":"Product B","quantity":2},{"itemName":"Old product","quantity":1},{"itemName":"Duplicate","quantity":7}]},
 {"masterId":"2","voucherNumber":"S2","party":" recent   ledger ","date":"20260920","lineItems":[{"itemName":"Product A","quantity":4},{"itemName":"Product A","quantity":2},{"itemName":"Product B","quantity":2},{"itemName":"Old product","quantity":1},{"itemName":"Duplicate","quantity":7}]},
 {"masterId":"1","voucherNumber":"S1","party":"Recent Ledger","date":"20260919","lineItems":[{"itemName":"product a","quantity":3}]},
 {"masterId":"3","voucherNumber":"OTHER","party":"Another Ledger","date":"20260921","lineItems":[{"itemName":"Product B","quantity":99}]},
 {"masterId":"4","voucherNumber":"FUTURE","party":"Recent Ledger","date":"20990921","lineItems":[{"itemName":"Product B","quantity":99}]},
 {"masterId":"5","voucherNumber":"RETURN","party":"Recent Ledger","date":"20260921","lineItems":[{"itemName":"Product B","quantity":-5}]}
 ]'::jsonb)) on conflict(id) do update set payload=excluded.payload;
do $$
declare r jsonb;
begin
 r:=public.stockflow_recent_products_gateway('recent-test-key','recent-sales@test.local','get_tally_recent_products','{"customerId":"71000000-0000-4000-8000-000000000001"}');
 if r->>'linked'<>'true' or jsonb_array_length(r->'products')<>2 then raise exception 'Wrong customer/catalog scope: %',r;end if;
 if r#>>'{products,0,tallyKey}'<>'A' or (r#>>'{products,0,billCount}')::int<>2 or (r#>>'{products,0,lastQuantity}')::numeric<>6 then raise exception 'Frequency/duplicate/last quantity failed: %',r;end if;
 if r#>>'{products,1,lastQuantity}'<>'2' or r#>>'{products,0,lastBilledAt}'<>'2026-09-20' then raise exception 'Wrong latest positive invoice: %',r;end if;
 if r::text~*'cost|price|Another Ledger|Different display name|Recent Ledger' then raise exception 'Private fields leaked';end if;
 r:=public.stockflow_recent_products_gateway('recent-test-key','recent-sales@test.local','get_tally_recent_products','{"customerId":"71000000-0000-4000-8000-000000000002"}');
 if r->>'linked'<>'false' or r->'products'<>'[]'::jsonb then raise exception 'Unlinked name was guessed';end if;
 update public.stockflow_snapshots set payload=payload||jsonb_build_object('tallyInvoices',(
  select jsonb_agg(jsonb_build_object('masterId',n::text,'voucherNumber','BOUND-'||n,'party','Recent Ledger',
   'date','202609'||lpad(n::text,2,'0'),'lineItems',jsonb_build_array(jsonb_build_object('itemName','Product A','quantity',n))))
  from generate_series(1,21) n)) where id='suprabha';
 r:=public.stockflow_recent_products_gateway('recent-test-key','recent-sales@test.local','get_tally_recent_products','{"customerId":"71000000-0000-4000-8000-000000000001"}');
 if (r->>'billCount')::int<>20 or (r#>>'{products,0,billCount}')::int<>20 or (r#>>'{products,0,lastQuantity}')::numeric<>21 then raise exception 'Last20 bill boundary failed: %',r;end if;
 if has_function_privilege('anon','public.stockflow_recent_products_gateway(text,text,text,jsonb)','execute') or has_function_privilege('authenticated','public.stockflow_recent_products_gateway(text,text,text,jsonb)','execute') then raise exception 'RPC exposed';end if;
 begin perform public.stockflow_recent_products_gateway('wrong','recent-sales@test.local','get_tally_recent_products','{}');raise exception 'Bad secret accepted';exception when insufficient_privilege then null;end;
 update public.stockflow_members set status='suspended' where email='recent-sales@test.local';
 begin perform public.stockflow_recent_products_gateway('recent-test-key','recent-sales@test.local','get_tally_recent_products','{}');raise exception 'Suspended user accepted';exception when insufficient_privilege then null;end;
end $$;
rollback;
