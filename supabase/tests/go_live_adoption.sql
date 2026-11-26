-- Disposable go-live fixtures.
begin;
set local statement_timeout='120s';
create function pg_temp.gl_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Go-live: %',label; end if; end $$;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('gl-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,roles,status) values
 ('gl-manager@test.local','management',array['management','sales'],'active'),
 ('gl-ops@test.local','operations',array['operations'],'active');
do $test$
declare
 before_read jsonb; after_read jsonb; customer uuid; order_id uuid; archived_id uuid;
 company text:='gl-company-'||extensions.gen_random_uuid()::text; bad jsonb; r text;
begin
 before_read:=private.stockflow_go_live_read('2040-01-02T12:00:00+05:30');
 insert into private.stockflow_customers(name,created_by_email) values('Generic customer','gl-manager@test.local') returning id into customer;
 insert into private.stockflow_orders(customer_name,created_by_email,updated_by_email,idempotency_key,created_at)
 values('Generic customer','gl-manager@test.local','gl-manager@test.local','go-live-order-current','2040-01-02T00:00:00+05:30') returning id into order_id;
 insert into private.stockflow_orders(customer_name,created_by_email,updated_by_email,idempotency_key,created_at)
 values('Generic customer','gl-manager@test.local','gl-manager@test.local','go-live-order-previous','2040-01-01T23:59:00+05:30');
 insert into private.stockflow_orders(customer_name,created_by_email,updated_by_email,idempotency_key,created_at,archived_at)
 values('Generic customer','gl-manager@test.local','gl-manager@test.local','go-live-order-archived','2040-01-02T01:00:00+05:30',now()) returning id into archived_id;
 insert into private.stockflow_order_tally_invoices(voucher_reference,order_id) values('gl-invoice-1',order_id),('gl-invoice-2',order_id),('gl-archived',archived_id);
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,kind,cancelled,evidence) values
 (company,'sale',1,'2040-01-02','sale',false,'{}'),
 (company,'cancelled',1,'2040-01-02','sale',false,'{}'),
 (company,'cancelled',2,'2040-01-02','sale',true,'{}'),
 (company,'purchase',1,'2040-01-02','purchase',false,'{}');
 insert into private.stockflow_customer_visits(customer_id,visited_on,visited_by,outcome,request_id,created_at)
 values(customer,'2040-01-02','gl-manager@test.local','met','gl-visit',now());
 insert into private.stockflow_command_results(actor_email,action,idempotency_key,request_hash,result,completed_at)
 values('gl-manager@test.local','test','go-live-command-current','test','{}','2040-01-02T00:00:00+05:30'),
 ('gl-manager@test.local','test','go-live-command-previous','test','{}','2040-01-01T23:59:00+05:30');
 after_read:=private.stockflow_go_live_read('2040-01-02T12:00:00+05:30');
 perform pg_temp.gl_assert(after_read#>>'{weeks,0,weekStart}'='2040-01-02','IST Monday');
 perform pg_temp.gl_assert((after_read#>>'{weeks,0,ordersEntered}')::int=(before_read#>>'{weeks,0,ordersEntered}')::int+1,'current and archived');
 perform pg_temp.gl_assert((after_read#>>'{weeks,1,ordersEntered}')::int=(before_read#>>'{weeks,1,ordersEntered}')::int+1,'Sunday previous week');
 perform pg_temp.gl_assert((after_read#>>'{weeks,0,ordersLinkedToTally}')::int=(before_read#>>'{weeks,0,ordersLinkedToTally}')::int+1,'linked distinct orders');
 perform pg_temp.gl_assert((after_read#>>'{weeks,0,tallySaleInvoices}')::int=(before_read#>>'{weeks,0,tallySaleInvoices}')::int+1,'latest non-cancelled sales');
 perform pg_temp.gl_assert((after_read#>>'{weeks,0,visitsLogged}')::int=(before_read#>>'{weeks,0,visitsLogged}')::int+1,'visit date');
 perform pg_temp.gl_assert((after_read#>>'{weeks,0,activePeople}')::int=(before_read#>>'{weeks,0,activePeople}')::int+1,'active people');
 perform pg_temp.gl_assert(exists(select 1 from jsonb_array_elements(after_read->'people') p where p->>'email'='gl-manager@test.local' and p->>'actionsThisWeek'='1' and p->>'ordersThisWeek'='1' and p->>'visitsThisWeek'='1' and (p->>'lastActionAt')::timestamptz='2040-01-02T00:00:00+05:30'::timestamptz),'person counts');
 perform pg_temp.gl_assert((after_read#>>'{membersByRole,sales}')::int=(select count(*) from public.stockflow_members where status='active' and 'sales'=any(roles)) and (after_read#>>'{membersByRole,management}')::int=(select count(*) from public.stockflow_members where status='active' and 'management'=any(roles)),'multi-role counts');
 perform public.stockflow_economics_gateway('gl-key','gl-manager@test.local','get_go_live','{}');
 begin
 perform public.stockflow_economics_gateway('gl-key','gl-ops@test.local','get_go_live','{}');
 raise exception 'Operations accepted';
 exception when sqlstate '42501' then perform pg_temp.gl_assert(sqlerrm='Go-live view is restricted','operations refused'); end;
 begin
 perform public.stockflow_economics_gateway('bad-key','gl-manager@test.local','get_go_live','{}');
 raise exception 'Bad key accepted';
 exception when sqlstate '42501' then perform pg_temp.gl_assert(sqlerrm='Unauthorized gateway','bad key'); end;
 for bad in select x from (values ('{"extra":true}'::jsonb),('[]'::jsonb),('null'::jsonb),(null::jsonb)) invalid(x) loop
 begin
 perform public.stockflow_economics_gateway('gl-key','gl-manager@test.local','get_go_live',bad);
 raise exception 'Invalid payload accepted';
 exception when sqlstate '22023' then perform pg_temp.gl_assert(sqlerrm='Invalid go-live request','payload'); end;
 end loop;
 foreach r in array array['anon','authenticated','service_role'] loop
 perform pg_temp.gl_assert(not has_function_privilege(r,'private.stockflow_go_live_read(timestamptz)','EXECUTE'),'private read');
 end loop;
end $test$;
rollback;
