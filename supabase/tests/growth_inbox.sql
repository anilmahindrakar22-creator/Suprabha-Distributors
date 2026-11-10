begin;
set local lock_timeout='60s';
set local statement_timeout='300s';

create function pg_temp.inbox_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Inbox assertion: %',label;end if;end$$;
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

-- Exercise the installed gateway body with a fixed clock, without replacing it.
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure);
 definition:=replace(definition,'public.stockflow_growth_gateway','pg_temp.inbox_gateway');
 definition:=replace(definition,'(now() at time zone ''Asia/Kolkata'')::date','''1901-01-15''::date');
 execute definition;
end$$;
create function pg_temp.inbox_call(action text,payload jsonb) returns jsonb language sql as $$
 select pg_temp.inbox_gateway('inbox-key','inbox-management@test.local',action,payload)
$$;
create function pg_temp.inbox_payload(lab text,rule text,decision text,extras jsonb default '{}') returns jsonb language sql as $$
 select jsonb_build_object('requestId',gen_random_uuid()::text,'cardKey','growth-inbox-co|'||lab||'|'||rule||'|1900-12','decision',decision)||extras
$$;
create function pg_temp.inbox_bad(payload jsonb,code text default '22023',message text default null) returns void language plpgsql as $$
declare caught boolean:=false;
begin
 begin perform pg_temp.inbox_call('decide_growth_card',payload);
 exception when others then
  if sqlstate<>code or (message is not null and sqlerrm<>message) then raise;end if;
  caught:=true;
 end;
 perform pg_temp.inbox_assert(caught,'expected '||code||' for '||payload::text);
end$$;

do $test$
declare i int; j int; lab text; d date; r jsonb; q jsonb; payload jsonb; accept_fields jsonb;
 customer uuid; opportunity uuid; manual_action uuid; accepted_action uuid; accepted_opportunity uuid; decision_id uuid; visit uuid;
 total_before bigint; action_before bigint; t timestamptz; elapsed interval; sample record; done_rows jsonb;
 fixed_today date:='1901-01-15'; live_today date:=(now() at time zone 'Asia/Kolkata')::date;
begin
 insert into private.stockflow_gateway_config(name,secret_sha256)
 values('orders',encode(extensions.digest('inbox-key','sha256'),'hex'))
 on conflict(name) do update set secret_sha256=excluded.secret_sha256;
 foreach lab in array array['management','administrator','sales','operations'] loop
  insert into public.stockflow_members(email,role,roles,status) values('inbox-'||lab||'@test.local',lab,array[lab],'active');
 end loop;
 insert into public.stockflow_members(email,role,roles,status) values('inbox-inactive@test.local','sales',array['sales'],'suspended');
 accept_fields:=jsonb_build_object('actionType','visit','ownerEmail','inbox-sales@test.local','dueOn','1901-01-16','detail','Discuss repeat sales');

 -- I1-I4. Fixed 1900 window avoids imported production/replay fixtures.
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

 for sample in select * from (values ('regular','R1'),('stopped','R2'),('falling','R3'),('new','R4')) x(lab,rule) loop
  perform pg_temp.inbox_assert(exists(select 1 from private.stockflow_growth_inbox_model(fixed_today)
   where customer_source_id=sample.lab and rule_key=sample.rule),'I1 fires '||sample.rule);
 end loop;
 perform pg_temp.inbox_assert(not exists(select 1 from private.stockflow_growth_inbox_model(fixed_today)
  where customer_source_id in ('short1','short2','short3','floor1','floor2','floor4','cancelled','moved','purchase','return-net')
  or customer_source_id is null),'I1/I3 short thresholds, floors and latest revisions');
 perform pg_temp.inbox_assert(not exists(select 1 from private.stockflow_growth_inbox_model('1900-04-15')
  where customer_source_id='earliest'),'I1 R4 earliest imported month');
 perform pg_temp.inbox_assert(exists(select 1 from private.stockflow_growth_inbox_model(fixed_today)
  where customer_source_id='priority' and rule_key='R1' and also_matches='["R3"]'),'I2 priority and alsoMatches');
 perform pg_temp.inbox_assert(exists(select 1 from private.stockflow_growth_inbox_model(fixed_today)
  where customer_source_id='bulk' and stake_paise=300000 and inputs->>'typicalPaise'='300000'
  and inputs->>'lastBoughtOn'='1900-09-05'),'I4 bulk excluded including last buying month');

 -- I5 exact counts, sums, stable paging, confirmation parity, owners and names.
 perform pg_temp.inbox_link('regular');perform pg_temp.inbox_link('new');
 perform pg_temp.inbox_link('stopped');perform pg_temp.inbox_link('falling');
 perform pg_temp.inbox_link('page1');perform pg_temp.inbox_link('page2');perform pg_temp.inbox_link('page3');
 insert into private.stockflow_economic_ledger_generations(company_id,source_version,observed_at,valid,catalog_version,content_hash,row_count)
 values('growth-inbox-co','v1','1900-01-01',true,'v1','v1',1);
 insert into private.stockflow_economic_ledger_masters(company_id,source_version,guid,name)
 values('growth-inbox-co','v1','unlinked','Unlinked inbox lab');
 t:=clock_timestamp();r:=pg_temp.inbox_call('get_growth_inbox','{"filter":"all","page":1}');elapsed:=clock_timestamp()-t;
 raise notice 'I14 get_growth_inbox duration %',elapsed;
 perform pg_temp.inbox_assert(elapsed<interval '2 seconds','I14 read under 2 seconds');
 perform pg_temp.inbox_assert(r->'counts'='{"all":17,"R1":14,"R2":1,"R3":1,"R4":1,"toReview":17,"inProgress":0,"done":0}', 'I5 exact counts');
 perform pg_temp.inbox_assert(r->>'stakeToReviewPaise'='6683333' and r->>'total'='17'
  and jsonb_array_length(r->'rows')=10 and r->>'pageSize'='10','I5 stake and page size');
 perform pg_temp.inbox_assert(r#>>'{rows,0,cardKey}'='growth-inbox-co|priority|R1|1900-12'
  and r#>>'{rows,1,name}'='Inbox regular' and r#>>'{rows,1,town}'='Inbox town','I5 stake/key ordering and linked names');
 q:=pg_temp.inbox_call('get_growth_inbox','{"filter":"all","page":2}');
 perform pg_temp.inbox_assert(jsonb_array_length(q->'rows')=7 and not exists(select 1 from jsonb_array_elements(q->'rows') a
  join jsonb_array_elements(r->'rows') b on a->>'cardKey'=b->>'cardKey'),'I5 disjoint second page');
 q:=private.stockflow_growth_read(fixed_today,array['management']);
 perform pg_temp.inbox_assert(r->'confirmed'=q->'confirmed' and r->'confirmedReason'=q->'confirmedReason','I5 confirmation matches Growth');
 perform pg_temp.inbox_assert(r->'owners'=(select jsonb_agg(jsonb_build_object('email',email) order by email collate "C")
  from public.stockflow_members where status='active' and role in ('administrator','management','sales')),'I5 owners');
 q:=pg_temp.inbox_call('get_growth_inbox','{"filter":"R1","page":1}');
 perform pg_temp.inbox_assert(q->>'total'='14' and exists(select 1 from jsonb_array_elements(q->'rows') x
  where x->>'labKey'='growth-inbox-co|unlinked' and x->>'name'='Unlinked inbox lab' and x->'customerId'='null'::jsonb),'I5 rule filter and ledger name');

 -- I6 receipt replay and owner read integration.
 payload:=pg_temp.inbox_payload('regular','R1','accept',accept_fields);
 select count(*) into total_before from private.stockflow_commercial_opportunities;
 select count(*) into action_before from private.stockflow_commercial_actions;
 t:=clock_timestamp();r:=pg_temp.inbox_call('decide_growth_card',payload);elapsed:=clock_timestamp()-t;
 raise notice 'I14 decide_growth_card duration %',elapsed;
 perform pg_temp.inbox_assert(elapsed<interval '1 second','I14 decide under 1 second');
 accepted_action:=(r->>'actionId')::uuid;accepted_opportunity:=(r->>'opportunityId')::uuid;
 perform pg_temp.inbox_assert(r->>'state'='in_progress' and (select count(*) from private.stockflow_commercial_opportunities)=total_before+1
  and (select count(*) from private.stockflow_commercial_actions)=action_before+1,'I6 exactly one opportunity and action');
 perform pg_temp.inbox_assert(exists(select 1 from private.stockflow_commercial_opportunities where id=accepted_opportunity
  and origin='growth_rule' and kind='recover' and division_id is null and opened_reason='Discuss repeat sales [rule=R1 v1 period=1900-12]'),'I6 opportunity provenance');
 perform pg_temp.inbox_assert(exists(select 1 from private.stockflow_commercial_actions where id=accepted_action
  and expected_monthly_gain_paise=1000000 and owner_email='inbox-sales@test.local' and due_on='1901-01-16'),'I6 action');
 select id into decision_id from private.stockflow_growth_decisions where action_id=accepted_action;
 perform pg_temp.inbox_assert((select count(*) from private.stockflow_growth_decisions where customer_source_id='regular')=1
  and exists(select 1 from private.stockflow_economic_audit where action='decide_growth_card' and entity_id=decision_id),'I6 decision and audit');
 q:=public.stockflow_my_actions_gateway('inbox-key','inbox-sales@test.local','get_my_actions','{"page":1}');
 perform pg_temp.inbox_assert(exists(select 1 from jsonb_array_elements(q->'rows') x where x->>'actionId'=accepted_action::text),'I6 owner My actions');
 perform pg_temp.inbox_assert(pg_temp.inbox_call('decide_growth_card',payload)=r
  and private.stockflow_decide_growth_card('1901-03-01','inbox-management@test.local',payload)=r
  and (select count(*) from private.stockflow_commercial_actions)=action_before+1
  and (select count(*) from private.stockflow_growth_decisions where customer_source_id='regular')=1,'I6 replay before date/card state');

 -- I7 conflicts, manual actions, reuse, and R4 forecast.
 perform pg_temp.inbox_bad(payload||jsonb_build_object('requestId',gen_random_uuid()),'PT409','Already in progress');
 select customer_id into customer from private.stockflow_economic_customer_identities where company_id='growth-inbox-co' and source_id='stopped';
 insert into private.stockflow_commercial_opportunities(customer_id,origin,kind,opened_reason,opened_by)
 values(customer,'manual','defend','Manual opportunity','test') returning id into opportunity;
 insert into private.stockflow_commercial_actions(opportunity_id,action_type,detail,owner_email,due_on,created_by)
 values(opportunity,'demo','Manual demo','inbox-sales@test.local','1901-01-14','test') returning id into manual_action;
 perform pg_temp.inbox_assert(exists(select 1 from private.stockflow_growth_inbox_model(fixed_today)
  where customer_source_id='stopped' and state='in_progress' and action->>'id'=manual_action::text),'I7 manual action');
 perform pg_temp.inbox_bad(pg_temp.inbox_payload('stopped','R2','accept',accept_fields),'PT409','Already in progress');
 select customer_id into customer from private.stockflow_economic_customer_identities where company_id='growth-inbox-co' and source_id='falling';
 insert into private.stockflow_commercial_opportunities(customer_id,origin,kind,opened_reason,opened_by)
 values(customer,'manual','recover','Existing recover opportunity','test') returning id into opportunity;
 select count(*) into total_before from private.stockflow_commercial_opportunities;
 q:=pg_temp.inbox_call('decide_growth_card',pg_temp.inbox_payload('falling','R3','accept',accept_fields));
 perform pg_temp.inbox_assert(q->>'opportunityId'=opportunity::text
  and (select count(*) from private.stockflow_commercial_opportunities)=total_before,'I7 reuses open opportunity');
 q:=pg_temp.inbox_call('decide_growth_card',pg_temp.inbox_payload('new','R4','accept',accept_fields));
 perform pg_temp.inbox_assert(exists(select 1 from private.stockflow_commercial_actions a
  join private.stockflow_commercial_opportunities o on o.id=a.opportunity_id where a.id=(q->>'actionId')::uuid
  and a.expected_monthly_gain_paise is null and o.kind='capture' and o.origin='growth_rule'),'I7 R4 null monthly forecast');
 r:=pg_temp.inbox_call('get_growth_inbox','{"filter":"all","page":2}');
 perform pg_temp.inbox_assert(r#>>'{counts,inProgress}'='4' and r#>>'{counts,toReview}'='13'
  and r->>'stakeToReviewPaise'='3600000' and r#>>'{rows,3,action,id}'=manual_action::text,'I5 review before in-progress due ordering');

 -- I8-I10 unlinked decisions, lab-wide snooze across periods, undo and snapshots.
 perform pg_temp.inbox_bad(pg_temp.inbox_payload('unlinked','R1','accept',accept_fields),'22023','Link the ledger first');
 payload:=pg_temp.inbox_payload('unlinked','R1','snooze','{"until":"1m","category":"service","note":" Call later "}');
 q:=pg_temp.inbox_call('decide_growth_card',payload);
 perform pg_temp.inbox_assert(q->>'state'='hidden' and q->>'snoozeUntil'='1901-02-14' and exists(select 1 from private.stockflow_growth_decisions
  where customer_source_id='unlinked' and snooze_until='1901-02-14' and note='Call later'),'I8 snooze unlinked');
 perform pg_temp.inbox_assert(private.stockflow_decide_growth_card('1901-01-17','inbox-management@test.local',payload)=q,
  'I9 snooze replay retains stored date');
 perform pg_temp.inbox_assert(exists(select 1 from private.stockflow_growth_inbox_model('1901-02-01')
  where customer_source_id='unlinked' and state='hidden') and exists(select 1 from private.stockflow_growth_inbox_model('1901-02-14')
  where customer_source_id='unlinked' and state='review'),'I9 snooze across periods and expires on date');
 q:=pg_temp.inbox_call('decide_growth_card',pg_temp.inbox_payload('unlinked','R1','undo'));
 perform pg_temp.inbox_assert(q->>'state'='review','I9 undo snooze');
 q:=pg_temp.inbox_call('decide_growth_card',pg_temp.inbox_payload('unlinked','R1','reject','{"category":"unknown"}'));
 perform pg_temp.inbox_assert(q->>'state'='hidden' and exists(select 1 from private.stockflow_growth_inbox_model('1901-02-15')
  where customer_source_id='unlinked' and state='review'),'I9 reject scoped to rule/period');
 perform pg_temp.inbox_bad(pg_temp.inbox_payload('unlinked','R1','reject','{"category":"unknown"}'),'PT409','Card already decided');
 q:=pg_temp.inbox_call('decide_growth_card',pg_temp.inbox_payload('unlinked','R1','undo'));
 perform pg_temp.inbox_assert(q->>'state'='review','I9 undo reject');
 perform pg_temp.inbox_bad(pg_temp.inbox_payload('unlinked','R1','undo'));
 perform pg_temp.inbox_bad(pg_temp.inbox_payload('unlinked','R1','reject','{"category":"unknown","stakePaise":1}'));
 perform pg_temp.inbox_bad(pg_temp.inbox_payload('unlinked','R1','reject','{"category":"unknown","inputs":{}}'));
 perform pg_temp.inbox_assert(not exists(select 1 from private.stockflow_growth_decisions d
  join private.stockflow_growth_inbox_model(fixed_today) m on m.company_id=d.company_id and m.customer_source_id=d.customer_source_id
  where d.inputs<>m.inputs or d.stake_paise<>m.stake_paise),'I10 server snapshots');
 q:=pg_temp.inbox_call('decide_growth_card',pg_temp.inbox_payload('bulk','R1','snooze','{"until":"next_run"}'));
 perform pg_temp.inbox_assert(q->>'snoozeUntil'='1901-03-01' and exists(select 1 from private.stockflow_growth_decisions
  where customer_source_id='bulk' and snooze_until='1901-03-01'),'I9 next_run stored and returned date');
 q:=pg_temp.inbox_call('decide_growth_card',pg_temp.inbox_payload('bulk','R1','undo'));
 q:=pg_temp.inbox_call('decide_growth_card',pg_temp.inbox_payload('bulk','R1','snooze','{"until":"2w"}'));
 perform pg_temp.inbox_assert(q->>'snoozeUntil'='1901-01-29' and exists(select 1 from private.stockflow_growth_decisions
  where customer_source_id='bulk' and snooze_until='1901-01-29'),'I9 two weeks stored and returned date');

 -- I11 Done persists independently of current rules, with sales-only outcomes.
 insert into private.stockflow_commercial_action_results(action_id,result,note,closed_by,closed_at)
 values(accepted_action,'done','Visit completed','inbox-sales@test.local','1901-01-10 12:00:00+05:30');
 perform pg_temp.inbox_sale('after-close','regular','1901-01-12',765432);
 perform pg_temp.inbox_sale('later-sale','regular','1901-01-14',900000);
 q:=pg_temp.inbox_call('get_growth_inbox','{"filter":"done","page":1}');
 perform pg_temp.inbox_assert(q->>'total'='1' and q#>>'{counts,done}'='1'
  and q#>>'{rows,0,outcome,status}'='bought' and q#>>'{rows,0,outcome,on}'='1901-01-12'
  and q#>>'{rows,0,outcome,valuePaise}'='765432' and q#>'{rows,0,outcome,daysLeft}'='null'::jsonb,'I11 first sale outcome');
 perform pg_temp.inbox_assert(exists(select 1 from private.stockflow_growth_inbox_model(fixed_today)
  where customer_source_id='regular' and state='hidden'),'I11 closed hidden from inbox');
 select action_id into manual_action from private.stockflow_growth_decisions where customer_source_id='falling' and decision='accepted';
 insert into private.stockflow_commercial_action_results(action_id,result,note,closed_by,closed_at)
 values(manual_action,'done','Demo completed','inbox-sales@test.local','1901-01-11 12:00:00+05:30');
 q:=pg_temp.inbox_call('get_growth_inbox','{"filter":"done","page":1}');
 perform pg_temp.inbox_assert(q#>>'{rows,0,labKey}'='growth-inbox-co|falling'
  and q#>>'{rows,0,outcome,status}'='waiting' and q#>>'{rows,0,outcome,daysLeft}'='26','I11 waiting and close ordering');
 q:=private.stockflow_growth_inbox_read('1901-02-10','{"filter":"done","page":1}');
 perform pg_temp.inbox_assert(q#>>'{rows,0,outcome,status}'='not_bought'
  and q#>'{rows,0,outcome,valuePaise}'='null'::jsonb,'I11 no sale after 30 days');

 -- Snooze follows a lab when its winning rule changes in the following run.
 for i in 0..5 loop
  perform pg_temp.inbox_sale('change-rule'||i,'change-rule',('1900-01-05'::date+i*interval '1 month')::date,500000);
 end loop;
 q:=pg_temp.inbox_call('decide_growth_card',pg_temp.inbox_payload('change-rule','R1','snooze','{"until":"1m"}'));
 perform pg_temp.inbox_assert(exists(select 1 from private.stockflow_growth_inbox_model('1901-02-01')
  where customer_source_id='change-rule' and rule_key='R2' and state='hidden'),'I9 snooze crosses rules');
 q:=pg_temp.inbox_call('decide_growth_card',pg_temp.inbox_payload('change-rule','R1','undo'));
 perform pg_temp.inbox_assert(exists(select 1 from private.stockflow_growth_inbox_model('1901-02-01')
  where customer_source_id='change-rule' and rule_key='R2' and state='review'),'I9 reopen crosses rules');

 -- Last reason compares recording timestamps, excludes none, and expires at 180 days.
 select customer_id into customer from private.stockflow_economic_customer_identities where company_id='growth-inbox-co' and source_id='page1';
 insert into private.stockflow_commercial_opportunities(customer_id,origin,kind,opened_reason,opened_by)
 values(customer,'manual','recover','Reason fixture','test') returning id into opportunity;
 insert into private.stockflow_commercial_constraints(opportunity_id,category,evidence,source,observed_on,facts,confidence,recorded_by,recorded_at)
 values(opportunity,'service','Service issue','our_view',live_today,'{}','low','test','1901-01-10 12:00+05:30');
 insert into private.stockflow_customer_visits(customer_id,visited_on,visited_by,outcome,request_id)
 values(customer,'1901-01-12','test','met','inbox-reason') returning id into visit;
 insert into private.stockflow_visit_reasons(visit_id,customer_id,category,source,recorded_by,recorded_at)
 values(visit,customer,'availability','lab_said','test','1901-01-12 12:00+05:30');
 insert into private.stockflow_customer_visits(customer_id,visited_on,visited_by,outcome,request_id)
 values(customer,'1901-01-13','test','met','inbox-none') returning id into visit;
 insert into private.stockflow_visit_reasons(visit_id,customer_id,category,source,recorded_by,recorded_at)
 values(visit,customer,'none',null,'test','1901-01-13 12:00+05:30');
 perform pg_temp.inbox_assert(exists(select 1 from private.stockflow_growth_inbox_model(fixed_today)
  where customer_source_id='page1' and last_reason='{"category":"availability","source":"lab_said","on":"1901-01-12"}'),'I5 latest non-none visit reason');
 insert into private.stockflow_commercial_constraints(opportunity_id,category,evidence,source,observed_on,facts,confidence,recorded_by,recorded_at)
 values(opportunity,'portfolio','Portfolio issue','document',live_today,'{}','high','test','1901-01-14 12:00+05:30');
 perform pg_temp.inbox_assert(exists(select 1 from private.stockflow_growth_inbox_model(fixed_today)
  where customer_source_id='page1' and last_reason='{"category":"portfolio","source":"document","on":"1901-01-14"}'),'I5 newer constraint reason');

 -- Any origin participates, with earliest due and UUID ties deterministic.
 insert into private.stockflow_commercial_actions(id,opportunity_id,action_type,detail,owner_email,due_on,created_by)
 values('19200000-0000-4000-8000-000000000002',opportunity,'visit','Later UUID','inbox-sales@test.local','1901-01-17','test'),
  ('19200000-0000-4000-8000-000000000001',opportunity,'demo','Earlier UUID','inbox-sales@test.local','1901-01-17','test');
 perform pg_temp.inbox_assert(exists(select 1 from private.stockflow_growth_inbox_model(fixed_today)
  where customer_source_id='page1' and action->>'id'='19200000-0000-4000-8000-000000000001'),'I5 action tie-break');
 insert into private.stockflow_commercial_action_results(action_id,result,note,closed_by)
 values('19200000-0000-4000-8000-000000000001','done','Fixture closed','test'),
  ('19200000-0000-4000-8000-000000000002','done','Fixture closed','test');

 -- I12 exact payload schemas, roles, owner and date checks.
 for payload in select x from jsonb_array_elements('[{"filter":"bad","page":1},{"filter":"all","page":0},{"filter":"all","page":1,"extra":1},{"filter":"all","page":1.5},{"filter":"all","page":999999999999},{}]') x loop
  begin perform pg_temp.inbox_call('get_growth_inbox',payload);raise exception 'Invalid inbox read accepted';
  exception when sqlstate '22023' then null;end;
 end loop;
 perform pg_temp.inbox_bad(pg_temp.inbox_payload('page1','R1','bad'));
 perform pg_temp.inbox_bad(pg_temp.inbox_payload('page1','R1','reject'));
 perform pg_temp.inbox_bad(pg_temp.inbox_payload('page1','R1','snooze','{"until":"bad"}'));
 perform pg_temp.inbox_bad(pg_temp.inbox_payload('page1','R1','accept',accept_fields||'{"dueOn":"1901-01-14"}'::jsonb));
 perform pg_temp.inbox_bad(pg_temp.inbox_payload('page1','R1','accept',accept_fields||jsonb_build_object('dueOn',fixed_today+181)));
 perform pg_temp.inbox_bad(pg_temp.inbox_payload('page1','R1','accept',accept_fields||'{"dueOn":"1901-02-30"}'::jsonb));
 perform pg_temp.inbox_bad(pg_temp.inbox_payload('page1','R1','accept',accept_fields||'{"ownerEmail":"inbox-inactive@test.local"}'::jsonb));
 perform pg_temp.inbox_bad(pg_temp.inbox_payload('page1','R1','accept',accept_fields||'{"actionType":"price_review"}'::jsonb));
 perform pg_temp.inbox_bad(pg_temp.inbox_payload('page1','R1','accept',accept_fields)||'{"cardKey":"growth-inbox-co|page1|R1|1900-11"}'::jsonb);
 perform pg_temp.inbox_bad(pg_temp.inbox_payload('page1','R1','undo','{"note":"extra"}'));
 perform pg_temp.inbox_bad(pg_temp.inbox_payload('page1','R1','reject','{"category":null}'));
 perform pg_temp.inbox_bad(pg_temp.inbox_payload('page1','R1','snooze','{"until":"1m","note":" "}'));
 foreach lab in array array['sales','operations'] loop
  begin perform public.stockflow_growth_gateway('inbox-key','inbox-'||lab||'@test.local','get_growth_inbox','{"filter":"all","page":1}');
   raise exception 'Unauthorized inbox read';exception when sqlstate 'PT403' then null;end;
  begin perform public.stockflow_growth_gateway('inbox-key','inbox-'||lab||'@test.local','decide_growth_card',pg_temp.inbox_payload('page1','R1','reject','{"category":"unknown"}'));
   raise exception 'Unauthorized inbox write';exception when sqlstate 'PT403' then null;end;
 end loop;
 begin perform public.stockflow_growth_gateway('wrong','inbox-management@test.local','get_growth_inbox','{"filter":"all","page":1}');
  raise exception 'Bad gateway key accepted';exception when sqlstate '42501' then null;end;

 -- Also cover the unmodified gateway clock and dispatch through a current card.
 for i in 3..8 loop
  perform pg_temp.inbox_sale('live'||i,'live',(date_trunc('month',live_today)-interval '12 months'+i*interval '1 month')::date,300000);
 end loop;
 customer:=pg_temp.inbox_link('live');
 payload:=jsonb_build_object('requestId',gen_random_uuid(),'cardKey','growth-inbox-co|live|R1|'||to_char(date_trunc('month',live_today)-interval '1 month','YYYY-MM'),
  'decision','accept','actionType','visit','ownerEmail','inbox-sales@test.local','dueOn',live_today,'detail','Current gateway fixture');
 q:=public.stockflow_growth_gateway('inbox-key','inbox-administrator@test.local','decide_growth_card',payload);
 perform pg_temp.inbox_assert(q->>'state'='in_progress','I12 live gateway accept');
 perform pg_temp.inbox_assert(public.stockflow_growth_gateway('inbox-key','inbox-administrator@test.local','decide_growth_card',payload)=q,'I6 live replay');
 q:=public.stockflow_growth_gateway('inbox-key','inbox-management@test.local','get_growth_inbox','{"filter":"all","page":1}');
 perform pg_temp.inbox_assert(exists(select 1 from jsonb_array_elements(q->'rows') x where x->>'cardKey'=payload->>'cardKey'),'I12 live gateway read');

 -- I13 append-only guards, grants and origin constraint.
 begin update private.stockflow_growth_decisions set note='changed' where id=decision_id;raise exception 'Update allowed';
 exception when others then if sqlerrm='Update allowed' then raise;end if;end;
 begin delete from private.stockflow_growth_decisions where id=decision_id;raise exception 'Delete allowed';
 exception when others then if sqlerrm='Delete allowed' then raise;end if;end;
 begin insert into private.stockflow_commercial_opportunities(customer_id,origin,kind,opened_reason,opened_by)
  values(customer,'unknown_origin','recover','Invalid origin','test');raise exception 'Unknown origin allowed';
 exception when check_violation then null;end;
 perform pg_temp.inbox_assert(not has_table_privilege('service_role','private.stockflow_growth_decisions','INSERT')
  and not has_function_privilege('service_role','private.stockflow_decide_growth_card(date,text,jsonb)','EXECUTE')
  and has_function_privilege('service_role','public.stockflow_growth_gateway(text,text,text,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.stockflow_growth_gateway(text,text,text,jsonb)','EXECUTE'),'I13 gateway only permissions');
 -- I14 Done reads share one sales materialization across all closed decisions.
 for i in 1..30 loop
  lab:='done-perf-'||i;
  for j in 3..8 loop
   perform pg_temp.inbox_sale(lab||'-'||j,lab,('1900-01-05'::date+j*interval '1 month')::date,300000);
  end loop;
  perform pg_temp.inbox_link(lab);
  q:=pg_temp.inbox_call('decide_growth_card',pg_temp.inbox_payload(lab,'R1','accept',accept_fields));
  d:=case i%3 when 0 then '1901-01-10'::date when 1 then '1900-12-15'::date else '1901-01-12'::date end;
  insert into private.stockflow_commercial_action_results(action_id,result,note,closed_by,closed_at)
  values((q->>'actionId')::uuid,'done','Done performance fixture','inbox-sales@test.local',
   (d+time '12:00') at time zone 'Asia/Kolkata');
  if i%3=0 then
   perform pg_temp.inbox_sale(lab||'-bought',lab,'1901-01-12',600000+i);
   perform pg_temp.inbox_sale(lab||'-later',lab,'1901-01-14',900000+i);
  end if;
 end loop;
 t:=clock_timestamp();q:=pg_temp.inbox_call('get_growth_inbox','{"filter":"done","page":1}');elapsed:=clock_timestamp()-t;
 raise notice 'I14 get_growth_inbox done duration % for % decisions',elapsed,q->>'total';
 perform pg_temp.inbox_assert(elapsed<interval '2 seconds','I14 Done read under 2 seconds');
 perform pg_temp.inbox_assert(q->>'total'='32' and q#>>'{counts,done}'='32' and jsonb_array_length(q->'rows')=10,
  'I14 Done count and page size with thirty additional decisions');
 done_rows:=q->'rows';
 for j in 2..4 loop
  q:=pg_temp.inbox_call('get_growth_inbox',jsonb_build_object('filter','done','page',j));
  done_rows:=done_rows||(q->'rows');
 end loop;
 perform pg_temp.inbox_assert(jsonb_array_length(done_rows)=32
  and (select count(distinct x->>'cardKey') from jsonb_array_elements(done_rows) x)=32,'I14 Done paging preserves every decision');
 for i in 1..30 loop
  select x into r from jsonb_array_elements(done_rows) x where x->>'labKey'='growth-inbox-co|done-perf-'||i;
  q:=case i%3
   when 0 then jsonb_build_object('status','bought','on','1901-01-12','valuePaise',600000+i,'daysLeft',null)
   when 1 then jsonb_build_object('status','not_bought','on',null,'valuePaise',null,'daysLeft',null)
   else jsonb_build_object('status','waiting','on',null,'valuePaise',null,'daysLeft',27) end;
  perform pg_temp.inbox_assert(r->'outcome'=q,'I14 per-lab outcome retained for decision '||i);
 end loop;
 raise notice 'PASS growth inbox I1-I14';
end$test$;
rollback;
