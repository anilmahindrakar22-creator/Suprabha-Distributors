begin;

create table private.stockflow_economic_voucher_exclusions (
 id bigint generated always as identity primary key,
 company_id text not null, source_id text not null,
 voucher_number text not null check (length(btrim(voucher_number)) between 1 and 80),
 voucher_date date not null,
 reason text not null check (length(btrim(reason)) between 10 and 500),
 owner_decision_ref text not null check (length(btrim(owner_decision_ref)) between 5 and 200),
 approved_by text not null, recorded_at timestamptz not null default now(),
 unique (company_id, source_id)
);
create trigger stockflow_voucher_exclusions_append_only before update or delete
 on private.stockflow_economic_voucher_exclusions for each row
 execute function private.stockflow_economic_exception_ack_append_only();
revoke all on private.stockflow_economic_voucher_exclusions from public,anon,authenticated,service_role;

do $patch$
declare definition text; old_text text; new_text text;
begin
 definition:=replace(pg_get_functiondef('private.stockflow_import_economic_vouchers()'::regprocedure),chr(13),'');
 old_text:=$old$entry->>'classificationPolicy' is distinct from 'explicit_non_economic_v1'
      or length(btrim(coalesce(entry->>'voucherType','')))<1 or entry->>'voucherType' in ('Sales','GST SALE','Purchase','Credit Note')$old$;
 new_text:=$new$(entry->>'classificationPolicy' is distinct from 'explicit_non_economic_v1' and not (entry->>'classificationPolicy'='owner_excluded_v1' and entry->>'voucherType' in ('Sales','GST SALE') and exists(select 1 from private.stockflow_economic_voucher_exclusions x where x.company_id=doc->>'companyId' and x.source_id=entry->>'sourceId')))
      or length(btrim(coalesce(entry->>'voucherType','')))<1 or (entry->>'voucherType' in ('Sales','GST SALE','Purchase','Credit Note') and entry->>'classificationPolicy' is distinct from 'owner_excluded_v1')$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
  raise exception 'Expected one non-economic policy anchor';
 end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old$   if entry->>'kind'='non_economic' then
$old$;
 new_text:=$new$   if entry->>'kind'='non_economic' then
    if entry->>'classificationPolicy'='owner_excluded_v1' and not exists(select 1 from private.stockflow_economic_voucher_exclusions x where x.company_id=doc->>'companyId' and x.source_id=entry->>'sourceId') then raise exception 'Accounting-only sale needs owner exclusion';end if;
$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
  raise exception 'Expected one non-economic branch anchor';
 end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;
end $patch$;
revoke all on function private.stockflow_import_economic_vouchers() from public,anon,authenticated;

create function private.stockflow_economic_exclude_voucher(p_actor text,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,private,extensions as $$
declare previous_row private.stockflow_economic_voucher_exclusions%rowtype; parsed_date date;
begin
 if jsonb_typeof(p_payload) is distinct from 'object' then
  raise exception 'Invalid voucher exclusion payload' using errcode='22023';
 end if;
 if not (p_payload ?& array['companyId','sourceId','voucherNumber','voucherDate','reason','ownerDecisionRef'])
  or p_payload-array['companyId','sourceId','voucherNumber','voucherDate','reason','ownerDecisionRef']<>'{}'::jsonb
  or exists(select 1 from jsonb_each(p_payload) where jsonb_typeof(value) is distinct from 'string')
  or nullif(btrim(p_payload->>'companyId'),'') is null or nullif(btrim(p_payload->>'sourceId'),'') is null
  or length(btrim(p_payload->>'voucherNumber')) not between 1 and 80
  or length(btrim(p_payload->>'reason')) not between 10 and 500
  or length(btrim(p_payload->>'ownerDecisionRef')) not between 5 and 200
  or (p_payload->>'voucherDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or length(btrim(coalesce(p_actor,''))) not between 3 and 320 then
  raise exception 'Invalid voucher exclusion payload' using errcode='22023';
 end if;
 begin
  parsed_date:=(p_payload->>'voucherDate')::date;
 exception when data_exception then
  raise exception 'Invalid voucher exclusion payload' using errcode='22023';
 end;
 perform pg_advisory_xact_lock(hashtext('stockflow-voucher-exclusions'));
 select * into previous_row from private.stockflow_economic_voucher_exclusions
 where company_id=p_payload->>'companyId' and source_id=p_payload->>'sourceId';
 if found then
  if previous_row.voucher_number is distinct from p_payload->>'voucherNumber'
   or previous_row.voucher_date is distinct from parsed_date
   or previous_row.reason is distinct from p_payload->>'reason'
   or previous_row.owner_decision_ref is distinct from p_payload->>'ownerDecisionRef' then
   raise exception 'Voucher exclusion already recorded with different values' using errcode='23505';
  end if;
 else
  if not exists(select 1 from private.stockflow_economic_import_exceptions e
   where e.company_id=p_payload->>'companyId' and e.source_id=p_payload->>'sourceId'
    and e.evidence->>'voucherType' in ('Sales','GST SALE')
    and position('Accounting-only' in coalesce(e.evidence->>'error','')||coalesce(e.reason,''))>0
    and private.stockflow_economic_import_exception_open(e.id)) then
   raise exception 'Only an open accounting-only sale can be excluded' using errcode='22023';
  end if;
  insert into private.stockflow_economic_voucher_exclusions(company_id,source_id,voucher_number,voucher_date,reason,owner_decision_ref,approved_by)
  values(p_payload->>'companyId',p_payload->>'sourceId',p_payload->>'voucherNumber',parsed_date,p_payload->>'reason',p_payload->>'ownerDecisionRef',p_actor)
  returning * into previous_row;
 end if;
 return jsonb_build_object('id',previous_row.id,'sourceId',previous_row.source_id,'voucherNumber',previous_row.voucher_number);
end $$;
revoke all on function private.stockflow_economic_exclude_voucher(text,jsonb) from public,anon,authenticated,service_role;

alter function public.stockflow_economics_gateway(text,text,text,jsonb)
 rename to stockflow_economics_gateway_before_voucher_exclusions;
create function public.stockflow_economics_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private,extensions set statement_timeout='20s' as $$
declare v_hash text; v_roles text[];
begin
 if p_action='exclude_accounting_only_sale' then
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
   raise exception 'Unauthorized gateway' using errcode='42501';
  end if;
  v_roles:=private.stockflow_active_member_roles(lower(btrim(coalesce(p_actor_email,''))));
  if not coalesce(v_roles&&array['administrator','management'],false) then
   raise exception 'Data checks are restricted' using errcode='42501';
  end if;
  return private.stockflow_economic_exclude_voucher(lower(btrim(p_actor_email)),p_payload);
 end if;
 return public.stockflow_economics_gateway_before_voucher_exclusions(p_gateway_key,p_actor_email,p_action,p_payload);
end $$;
revoke all on function public.stockflow_economics_gateway_before_voucher_exclusions(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.stockflow_economics_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_economics_gateway(text,text,text,jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
