begin;

insert into public.stockflow_members(email,role,roles,status) values
  ('classes-admin@example.test','administrator',array['administrator'],'active'),
  ('classes-manager@example.test','management',array['management'],'active');
update private.stockflow_gateway_config
  set secret_sha256=encode(extensions.digest('classes-test-key','sha256'),'hex') where name='orders';

-- Own append-only baseline, ordered after any existing policy; all changes roll back.
insert into private.stockflow_account_class_policies(a_min_paise,b_min_paise,actor,reason,effective_from)
  select 20000000,7500000,'classes-admin@example.test','Account classes test baseline',
    greatest(clock_timestamp(),max(effective_from)+interval '1 microsecond')
  from private.stockflow_account_class_policies;

do $fixtures$
declare
  v_today date:=(now() at time zone 'Asia/Kolkata')::date;
  v_from date; v_to date; v_customer uuid; v_voucher uuid;
  v_case text; v_entry jsonb; v_line jsonb; v_result jsonb; v_read jsonb;
begin
  select window_from,window_to into v_from,v_to from private.stockflow_account_class_window('2026-10-14');
  if v_from is distinct from date '2026-07-01' or v_to is distinct from date '2026-09-30' then
    raise exception 'October class window must be July 1 through September 30';
  end if;
  select window_from,window_to into v_from,v_to from private.stockflow_account_class_window(v_today);
  if private.stockflow_sales_window_complete('classes-company',v_from,v_to) is distinct from false then
    raise exception 'Coverage seam must fail closed before activation';
  end if;

  foreach v_case in array array['A','B','below','return','credit','cancelled','revision','foc','current','old','unlinked'] loop
    insert into private.stockflow_customers(name,city,created_by_email)
      values('Account classes fixture '||v_case,'Account classes exact fixture city','classes-admin@example.test')
      returning id into v_customer;
    if v_case<>'unlinked' then
      insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
        values('classes-company','classes-ledger-'||v_case,v_customer,'classes-admin@example.test');
    end if;

    -- Same canonical voucher/line evidence shape as instrument_economics_integrity.sql.
    -- Direct inserts avoid an unrelated economics rebuild; every required column is supplied.
    for v_entry in select value from jsonb_array_elements(jsonb_build_array(
      jsonb_build_object('sourceId','classes-sale-'||v_case,'revision',1,'date',v_from,
        'kind','sale','customerSourceId','classes-ledger-'||v_case,'siteId','classes-site',
        'amountStatus','verified','lines',jsonb_build_array(jsonb_build_object(
          'lineKey','1','productId','classes-product','quantity','1','unit','pack',
          'netSalesPaise',case v_case when 'B' then '22500000' when 'below' then '15000000'
            when 'revision' then '999000000' else '63000000' end,'gstPaise','900000'))),
      jsonb_build_object('sourceId','classes-extra-'||v_case,'revision',1,
        'date',case v_case when 'current' then v_to+1 when 'old' then v_from-1 else v_to end,
        'kind',case v_case when 'return' then 'return' when 'credit' then 'credit' else 'sale' end,
        'customerSourceId','classes-ledger-'||v_case,'siteId','classes-site','amountStatus','verified',
        'cancelled',v_case='cancelled','lines',jsonb_build_array(jsonb_build_object(
          'lineKey','1','productId','classes-product',
          'quantity',case v_case when 'return' then '-1' when 'credit' then '0' else '1' end,
          'unit','pack','netSalesPaise',case when v_case in ('return','credit') then '-6000000'
            when v_case in ('cancelled','foc','current','old') then '999000000' else '0' end,
          'focReason',case when v_case='foc' then 'commercial_support' end)),
        'originalVoucherId',case when v_case in ('return','credit') then 'classes-sale-'||v_case end)
    )) loop
      insert into private.stockflow_economic_source_vouchers(
        company_id,source_id,source_revision,business_date,customer_source_id,site_id,kind,cancelled,currency,evidence)
        values('classes-company',v_entry->>'sourceId',(v_entry->>'revision')::bigint,
          (v_entry->>'date')::date,v_entry->>'customerSourceId',v_entry->>'siteId',v_entry->>'kind',
          coalesce((v_entry->>'cancelled')::boolean,false),'INR',v_entry) returning id into v_voucher;
      for v_line in select value from jsonb_array_elements(v_entry->'lines') loop
        insert into private.stockflow_economic_source_lines(
          voucher_id,line_key,product_id,quantity,unit,net_sales_paise,gst_paise,discount_paise,foc_reason,evidence)
          values(v_voucher,v_line->>'lineKey',v_line->>'productId',(v_line->>'quantity')::numeric,
            v_line->>'unit',(v_line->>'netSalesPaise')::bigint,coalesce((v_line->>'gstPaise')::bigint,0),
            0,v_line->>'focReason',v_line);
      end loop;
    end loop;
    if v_case='revision' then
      v_line:=jsonb_build_object('lineKey','1','productId','classes-product','quantity','1','unit','pack','netSalesPaise','63000000');
      v_entry:=jsonb_build_object('sourceId','classes-sale-revision','revision',2,'date',v_from,
        'kind','sale','customerSourceId','classes-ledger-revision','siteId','classes-site',
        'amountStatus','verified','lines',jsonb_build_array(v_line));
      insert into private.stockflow_economic_source_vouchers(
        company_id,source_id,source_revision,business_date,customer_source_id,site_id,kind,cancelled,currency,evidence)
        values('classes-company','classes-sale-revision',2,v_from,'classes-ledger-revision','classes-site','sale',false,'INR',v_entry)
        returning id into v_voucher;
      insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,gst_paise,discount_paise,evidence)
        values(v_voucher,'1','classes-product',1,'pack',63000000,0,0,v_line);
    end if;
    v_result:=private.stockflow_account_class(v_customer,v_today);
    if v_result->>'state' is distinct from (case when v_case='unlinked' then 'not_linked' else 'not_available' end)
      or v_result->'monthlyPaise' is distinct from 'null'::jsonb
      or v_result->'window' is distinct from jsonb_build_object('from',v_from,'to',v_to) then
      raise exception 'Link/coverage gate failed for %: %',v_case,v_result;
    end if;
  end loop;
  v_read:=public.stockflow_accounts_gateway('classes-test-key','classes-admin@example.test','get_accounts',
    '{"search":"Account classes fixture","class":"not_available"}');
  if (v_read->'page'->>'total')::integer<>10 or jsonb_array_length(v_read->'accounts')<>10
    or exists(select 1 from jsonb_array_elements(v_read->'accounts') as a where a->'class'->>'state' is distinct from 'not_available') then
    raise exception 'Incomplete accounts filter must return only not_available: %',v_read;
  end if;
end $fixtures$;

-- Transactional test-only activation: the production seam returns false again after rollback.
create or replace function private.stockflow_sales_window_complete(p_company text,p_from date,p_to date)
returns boolean language sql stable as $$ select true $$;

do $classes$
declare
  v_today date:=(now() at time zone 'Asia/Kolkata')::date;
  v_customer record; v_result jsonb; v_read jsonb; v_replay jsonb; v_payload jsonb;
  v_case text; v_state text; v_expected bigint; v_total integer; v_policy uuid; v_count bigint;
begin
  for v_customer in select id,name from private.stockflow_customers where name like 'Account classes fixture %' loop
    v_case:=replace(v_customer.name,'Account classes fixture ','');
    v_state:=case when v_case='unlinked' then 'not_linked' when v_case in ('B','return','credit') then 'B'
      when v_case='below' then 'below_b' else 'A' end;
    v_expected:=case when v_case='unlinked' then null when v_case='B' then 7500000
      when v_case='below' then 5000000 when v_case in ('return','credit') then 19000000 else 21000000 end;
    v_result:=private.stockflow_account_class(v_customer.id,v_today);
    if v_result->>'state' is distinct from v_state or (v_result->>'monthlyPaise')::bigint is distinct from v_expected
      or (v_case<>'unlinked' and not (v_result ? 'policyId')) then
      raise exception 'Class calculation failed for %: expected % / %, got %',v_case,v_state,v_expected,v_result;
    end if;
  end loop;

  foreach v_state in array array['A','B','below_b','not_linked','not_available'] loop
    v_total:=case v_state when 'A' then 6 when 'B' then 3 when 'below_b' then 1 when 'not_linked' then 1 else 0 end;
    v_read:=public.stockflow_accounts_gateway('classes-test-key','classes-admin@example.test','get_accounts',
      jsonb_build_object('search','Account classes fixture','class',v_state));
    if (v_read->'page'->>'total')::integer is distinct from v_total
      or jsonb_array_length(v_read->'accounts')<>v_total
      or exists(select 1 from jsonb_array_elements(v_read->'accounts') as a where not (a ? 'class') or a->'class'->>'state' is distinct from v_state)
      or v_read->'classPolicy' is distinct from '{"aMinPaise":"20000000","bMinPaise":"7500000"}'::jsonb then
      raise exception 'Class filter/policy failed for %: %',v_state,v_read;
    end if;
  end loop;
  v_read:=public.stockflow_accounts_gateway('classes-test-key','classes-admin@example.test','get_accounts','{"search":"Account classes fixture"}');
  if jsonb_array_length(v_read->'accounts')<>11
    or exists(select 1 from jsonb_array_elements(v_read->'accounts') as a where not (a ? 'class') or a->'class'->>'state' is null)
    or not (v_read ? 'classPolicy') then raise exception 'Unfiltered accounts lack classes/policy'; end if;
  begin
    perform public.stockflow_accounts_gateway('classes-test-key','classes-admin@example.test','get_accounts','{"class":"invalid"}');
    raise exception 'Invalid class filter accepted';
  exception when sqlstate '22023' then null; end;

  v_payload:='{"aMinPaise":"22000000","bMinPaise":"8000000","reason":"Test updated owner thresholds","idempotencyKey":"account-classes-policy-001"}';
  select count(*) into v_count from private.stockflow_account_class_policies;
  begin
    perform public.stockflow_accounts_gateway('classes-test-key','classes-manager@example.test','set_class_policy',v_payload);
    raise exception 'Management changed administrator-only class policy';
  exception when sqlstate '42501' then null; end;
  if (select count(*) from private.stockflow_account_class_policies)<>v_count then raise exception 'Denied policy change wrote a row'; end if;
  v_result:=public.stockflow_accounts_gateway('classes-test-key','classes-admin@example.test','set_class_policy',v_payload);
  v_policy:=(v_result->>'policyId')::uuid;
  v_replay:=public.stockflow_accounts_gateway('classes-test-key','classes-admin@example.test','set_class_policy',v_payload);
  if v_result is distinct from v_replay or v_result->'ok' is distinct from 'true'::jsonb
    or v_result->'classPolicy' is distinct from '{"aMinPaise":"22000000","bMinPaise":"8000000"}'::jsonb
    or (select count(*) from private.stockflow_account_class_policies)<>v_count+1
    or not exists(select 1 from private.stockflow_account_class_policies where id=v_policy and actor='classes-admin@example.test'
      and a_min_paise=22000000 and b_min_paise=8000000 and reason='Test updated owner thresholds') then
    raise exception 'Administrator policy change/replay failed: % / %',v_result,v_replay;
  end if;
  for v_customer in select id,name from private.stockflow_customers where name in ('Account classes fixture A','Account classes fixture B') loop
    v_result:=private.stockflow_account_class(v_customer.id,v_today);
    if v_result->>'state' is distinct from (case when v_customer.name='Account classes fixture A' then 'B' else 'below_b' end)
      or v_result->>'policyId' is distinct from v_policy::text then
      raise exception 'New thresholds did not apply: %',v_result;
    end if;
  end loop;
  v_read:=public.stockflow_accounts_gateway('classes-test-key','classes-admin@example.test','get_accounts','{"search":"Account classes fixture A"}');
  if v_read->'classPolicy' is distinct from '{"aMinPaise":"22000000","bMinPaise":"8000000"}'::jsonb
    or v_read->'accounts'->0->'class'->>'state' is distinct from 'B' then raise exception 'Gateway did not use updated policy'; end if;
  foreach v_case in array array['8000000','7999999'] loop
    begin
      perform public.stockflow_accounts_gateway('classes-test-key','classes-admin@example.test','set_class_policy',
        v_payload||jsonb_build_object('aMinPaise',v_case,'idempotencyKey','account-classes-invalid-'||v_case));
      raise exception 'Policy a<=b accepted';
    exception when sqlstate '22023' then null; end;
  end loop;
  if (select count(*) from private.stockflow_account_class_policies)<>v_count+1 then raise exception 'Invalid policy change wrote a row'; end if;
  begin
    update private.stockflow_account_class_policies set reason='Edited policy history' where id=v_policy;
    raise exception 'Policy update allowed';
  exception when sqlstate '42501' then null; end;
  begin
    delete from private.stockflow_account_class_policies where id=v_policy;
    raise exception 'Policy deletion allowed';
  exception when sqlstate '42501' then null; end;
  if not exists(select 1 from private.stockflow_account_class_policies where id=v_policy and reason='Test updated owner thresholds') then
    raise exception 'Append-only policy row changed';
  end if;
end $classes$;

rollback;
