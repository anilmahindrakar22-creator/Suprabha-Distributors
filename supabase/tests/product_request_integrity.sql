begin;
insert into public.stockflow_members(email,role,status) values
 ('request-sales@example.test','sales','active'),('request-admin@example.test','administrator','active'),('request-viewer@example.test','viewer','active');
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('request-test-key','sha256'),'hex') where name='orders';
insert into public.stockflow_snapshots(id,company,fetched_at,payload) values('suprabha','TEST',now()::text,'{"catalog":[]}'::jsonb)
on conflict(id) do update set payload=stockflow_snapshots.payload||'{"catalog":[]}'::jsonb;
do $test$
declare payload jsonb:='{"productName":"Missing reagent fixture","idempotencyKey":"request-create-test-001"}'; result jsonb; replay jsonb; v_request_id uuid; before_products bigint;
begin
  select count(*) into before_products from private.stockflow_products;
  begin
    perform public.stockflow_product_request_gateway('request-test-key','request-viewer@example.test','create_product_request',payload);
    raise exception 'Viewer allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.stockflow_product_request_gateway('wrong','request-sales@example.test','create_product_request',payload);
    raise exception 'Bad key allowed';
  exception when insufficient_privilege then null; end;
  result:=public.stockflow_product_request_gateway('request-test-key','request-sales@example.test','create_product_request',payload);
  replay:=public.stockflow_product_request_gateway('request-test-key','request-sales@example.test','create_product_request',payload);
  if result is distinct from replay then raise exception 'Replay changed result'; end if;
  v_request_id:=(result->>'requestId')::uuid;
  if (select count(*) from private.stockflow_product_request_events e where e.request_id=v_request_id)<>1 then raise exception 'Duplicate audit'; end if;
  begin
    update private.stockflow_product_request_events set actor_email='changed' where request_id=v_request_id;
    raise exception 'Audit mutation allowed';
  exception when insufficient_privilege then null; end;
  update public.stockflow_snapshots s set payload=s.payload||'{"catalog":[{"item":"Existing reagent"}]}'::jsonb where id='suprabha';
  begin
    perform public.stockflow_product_request_gateway('request-test-key','request-sales@example.test','create_product_request','{"productName":"Existing reagent","idempotencyKey":"request-existing-001"}');
    raise exception 'Existing catalog item requested';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.stockflow_product_request_gateway('request-test-key','request-sales@example.test','create_product_request',payload||'{"productName":"Changed request"}');
    raise exception 'Changed replay allowed';
  exception when invalid_parameter_value then null; end;
  result:=public.stockflow_product_request_gateway('request-test-key','request-admin@example.test','review_product_request',jsonb_build_object('requestId',v_request_id,'expectedVersion',1,'status','rejected','resolution','Not in approved range','idempotencyKey','request-review-test-001'));
  if result->>'status'<>'rejected' or result->>'version'<>'2' then raise exception 'Review failed'; end if;
  begin
    perform public.stockflow_product_request_gateway('request-test-key','request-admin@example.test','review_product_request',jsonb_build_object('requestId',v_request_id,'expectedVersion',1,'status','resolved','resolution','Stale review','idempotencyKey','request-review-test-002'));
    raise exception 'Stale review allowed';
  exception when sqlstate 'PT409' then null; end;
  begin
    delete from private.stockflow_product_requests where id=v_request_id;
    raise exception 'Hard deletion allowed';
  exception when insufficient_privilege then null; end;
  if (select count(*) from private.stockflow_products)<>before_products then raise exception 'Product Master changed'; end if;
  if has_function_privilege('authenticated','public.stockflow_product_request_gateway(text,text,text,jsonb)','EXECUTE') then raise exception 'Public execution granted'; end if;
end $test$;
create function private.product_request_test_failure() returns trigger language plpgsql as $$ begin raise exception 'Injected audit failure'; end $$;
create trigger product_request_test_failure before insert on private.stockflow_product_request_events for each row execute function private.product_request_test_failure();
do $test$
begin
  begin
    perform public.stockflow_product_request_gateway('request-test-key','request-sales@example.test','create_product_request','{"productName":"Rollback fixture","idempotencyKey":"request-rollback-001"}');
    raise exception 'Failure injection did not run';
  exception when raise_exception then
    if sqlerrm<>'Injected audit failure' then raise; end if;
  end;
  if exists(select 1 from private.stockflow_product_requests where product_name='Rollback fixture')
    or exists(select 1 from private.stockflow_command_results where idempotency_key='request-rollback-001') then raise exception 'Partial mutation survived'; end if;
end $test$;
rollback;
