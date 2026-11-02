begin;

alter table private.stockflow_wallet_snapshots
 add column special_tests_per_month integer check (special_tests_per_month between 1 and 1000000),
 add column paise_per_special_test bigint check (paise_per_special_test between 1 and 100000000);

alter table private.stockflow_wallet_snapshots drop constraint stockflow_wallet_snapshots_test_volume_rule;
alter table private.stockflow_wallet_snapshots add constraint stockflow_wallet_snapshots_test_volume_rule check (
 (tests_per_day is null and working_days_per_month is null and paise_per_test is null
  and special_tests_per_month is null and paise_per_special_test is null)
 or (tests_per_day is not null and working_days_per_month is not null and paise_per_test is not null
  and ((special_tests_per_month is null and paise_per_special_test is null)
   or (special_tests_per_month is not null and paise_per_special_test is not null))
  and monthly_wallet_paise::numeric = tests_per_day::numeric * working_days_per_month::numeric * paise_per_test::numeric
   + coalesce(special_tests_per_month::numeric * paise_per_special_test::numeric,0))
);

do $patch$
declare definition text; old_text text; new_text text;
begin
 definition:=replace(pg_get_functiondef('public.stockflow_wallet_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
 old_text:=$old$ tv jsonb; tv_tests numeric; tv_days numeric; tv_price numeric;
 today date:=(now() at time zone 'Asia/Kolkata')::date;$old$;
 new_text:=$new$ tv jsonb; tv_tests numeric; tv_days numeric; tv_price numeric; tv_special numeric; tv_special_price numeric;
 today date:=(now() at time zone 'Asia/Kolkata')::date;$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected wallet declaration anchor';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old$  tv:=p_payload->'testVolume';
  if p_payload->>'method'='test_volume' then
   if jsonb_typeof(tv) is distinct from 'object'
    or jsonb_typeof(tv->'testsPerDay') is distinct from 'number'
    or jsonb_typeof(tv->'workingDaysPerMonth') is distinct from 'number'
    or jsonb_typeof(tv->'paisePerTest') is distinct from 'number'
    or jsonb_typeof(p_payload->'monthlyWalletPaise') is distinct from 'number' then
    raise exception 'Wallet total must equal tests per day × working days × price per test' using errcode='22023';
   end if;
   tv_tests:=(tv->>'testsPerDay')::numeric;
   tv_days:=(tv->>'workingDaysPerMonth')::numeric;
   tv_price:=(tv->>'paisePerTest')::numeric;
   if tv_tests<>trunc(tv_tests) or tv_tests not between 1 and 100000
    or tv_days<>trunc(tv_days) or tv_days not between 1 and 31
    or tv_price<>trunc(tv_price) or tv_price not between 1 and 100000000
    or (p_payload->>'monthlyWalletPaise')::numeric<>tv_tests*tv_days*tv_price then
    raise exception 'Wallet total must equal tests per day × working days × price per test' using errcode='22023';
   end if;
  elsif tv is not null and tv<>'null'::jsonb then
   raise exception 'Wallet total must equal tests per day × working days × price per test' using errcode='22023';
  end if;
  amount:=(p_payload->>'monthlyWalletPaise')::numeric;$old$;
 new_text:=$new$  tv:=p_payload->'testVolume';
  if p_payload->>'method'='test_volume' then
   if jsonb_typeof(tv) is distinct from 'object'
    or jsonb_typeof(tv->'testsPerDay') is distinct from 'number'
    or jsonb_typeof(tv->'workingDaysPerMonth') is distinct from 'number'
    or jsonb_typeof(tv->'paisePerTest') is distinct from 'number'
    or (tv ? 'specialTestsPerMonth')<>(tv ? 'paisePerSpecialTest')
    or (tv ? 'specialTestsPerMonth' and (jsonb_typeof(tv->'specialTestsPerMonth') is distinct from 'number'
      or jsonb_typeof(tv->'paisePerSpecialTest') is distinct from 'number'))
    or jsonb_typeof(p_payload->'monthlyWalletPaise') is distinct from 'number' then
    raise exception 'Wallet total must equal routine plus special tests × price' using errcode='22023';
   end if;
   tv_tests:=(tv->>'testsPerDay')::numeric;
   tv_days:=(tv->>'workingDaysPerMonth')::numeric;
   tv_price:=(tv->>'paisePerTest')::numeric;
   tv_special:=case when tv ? 'specialTestsPerMonth' then (tv->>'specialTestsPerMonth')::numeric end;
   tv_special_price:=case when tv ? 'paisePerSpecialTest' then (tv->>'paisePerSpecialTest')::numeric end;
   if tv_tests<>trunc(tv_tests) or tv_tests not between 1 and 100000
    or tv_days<>trunc(tv_days) or tv_days not between 1 and 31
    or tv_price<>trunc(tv_price) or tv_price not between 1 and 100000000
    or (tv_special is not null and (tv_special<>trunc(tv_special) or tv_special not between 1 and 1000000))
    or (tv_special_price is not null and (tv_special_price<>trunc(tv_special_price) or tv_special_price not between 1 and 100000000))
    or (p_payload->>'monthlyWalletPaise')::numeric<>tv_tests*tv_days*tv_price+coalesce(tv_special*tv_special_price,0) then
    raise exception 'Wallet total must equal routine plus special tests × price' using errcode='22023';
   end if;
  elsif tv is not null and tv<>'null'::jsonb then
   raise exception 'Wallet total must equal routine plus special tests × price' using errcode='22023';
  end if;
  amount:=(p_payload->>'monthlyWalletPaise')::numeric;$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected wallet amount anchor';end if;
 definition:=replace(definition,old_text,new_text);
 if position('tests per day × working days × price per test' in definition)>0 then raise exception 'Legacy wallet test-volume validation remains';end if;
 old_text:=$old$insert into private.stockflow_wallet_snapshots(customer_id,monthly_wallet_paise,method,source,confidence,as_of,note,lowered_reason,entered_by,tests_per_day,working_days_per_month,paise_per_test)$old$;
 new_text:=$new$insert into private.stockflow_wallet_snapshots(customer_id,monthly_wallet_paise,method,source,confidence,as_of,note,lowered_reason,entered_by,tests_per_day,working_days_per_month,paise_per_test,special_tests_per_month,paise_per_special_test)$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected wallet insert columns anchor';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old$btrim(p_payload->>'note'),p_payload->>'loweredReason',actor,tv_tests::integer,tv_days::integer,tv_price::bigint) returning id into entity;$old$;
 new_text:=$new$btrim(p_payload->>'note'),p_payload->>'loweredReason',actor,tv_tests::integer,tv_days::integer,tv_price::bigint,tv_special::integer,tv_special_price::bigint) returning id into entity;$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected wallet insert values anchor';end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;

 definition:=replace(pg_get_functiondef('private.stockflow_wallet_account_read(date,uuid)'::regprocedure),chr(13),'');
 old_text:=$old$'enteredBy',s.entered_by,'enteredAt',s.entered_at,'verifiedBy',s.verified_by,
  'testVolume',case when s.tests_per_day is null then 'null'::jsonb else
   jsonb_build_object('testsPerDay',s.tests_per_day,'workingDaysPerMonth',s.working_days_per_month,'paisePerTest',s.paise_per_test) end,$old$;
 new_text:=$new$'enteredBy',s.entered_by,'enteredAt',s.entered_at,'verifiedBy',s.verified_by,
  'testVolume',case when s.tests_per_day is null then 'null'::jsonb else
   jsonb_strip_nulls(jsonb_build_object('testsPerDay',s.tests_per_day,'workingDaysPerMonth',s.working_days_per_month,'paisePerTest',s.paise_per_test,
    'specialTestsPerMonth',s.special_tests_per_month,'paisePerSpecialTest',s.paise_per_special_test)) end,$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected wallet snapshot read anchor';end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;
end $patch$;

commit;
