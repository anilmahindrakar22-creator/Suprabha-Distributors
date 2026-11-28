begin;

create table private.stockflow_economic_errored_voucher_exclusions (
 id bigint generated always as identity primary key,
 company_id text not null, source_id text not null,
 source_revision bigint not null check (source_revision>=0),
 voucher_type text not null check (voucher_type='Debit Note'),
 voucher_number text not null check (length(btrim(voucher_number)) between 1 and 80),
 voucher_date date not null,
 reason text not null check (length(btrim(reason)) between 10 and 500),
 owner_decision_ref text not null check (length(btrim(owner_decision_ref)) between 5 and 200),
 approved_by text not null, recorded_at timestamptz not null default now(),
 unique (company_id, source_id, source_revision)
);
create trigger stockflow_errored_voucher_exclusions_append_only before update or delete
 on private.stockflow_economic_errored_voucher_exclusions for each row
 execute function private.stockflow_economic_exception_ack_append_only();
revoke all on private.stockflow_economic_errored_voucher_exclusions from public,anon,authenticated,service_role;

do $patch$
declare definition text; old_text text; new_text text;
begin
 definition:=replace(pg_get_functiondef('private.stockflow_import_economic_vouchers()'::regprocedure),chr(13),'');
 old_text:=$old$   if nullif(btrim(entry->>'sourceId'),'') is null or jsonb_typeof(entry->'lines') is distinct from 'array'$old$;
 new_text:=$new$   if entry->>'amountStatus' is distinct from 'verified' and entry->>'voucherType'='Debit Note' and coalesce(entry->>'revision','') ~ '^[0-9]{1,18}$'
     and exists(select 1 from private.stockflow_economic_errored_voucher_exclusions x where x.company_id=doc->>'companyId' and x.source_id=entry->>'sourceId' and x.source_revision=(entry->>'revision')::bigint) then
    continue;
   end if;
$new$||old_text;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
  raise exception 'Expected one incomplete-voucher anchor';
 end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;
end $patch$;
revoke all on function private.stockflow_import_economic_vouchers() from public,anon,authenticated;

create function private.stockflow_economic_exclude_errored_voucher(p_actor text,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,private,extensions as $$
declare previous_row private.stockflow_economic_errored_voucher_exclusions%rowtype; parsed_date date;
 eligible_ids bigint[]; n integer; request_id uuid; ack_reason text;
begin
 if jsonb_typeof(p_payload) is distinct from 'object' then
  raise exception 'Invalid errored voucher exclusion payload' using errcode='22023';
 end if;
 if not (p_payload ?& array['companyId','sourceId','revision','voucherNumber','voucherDate','reason','ownerDecisionRef'])
  or p_payload-array['companyId','sourceId','revision','voucherNumber','voucherDate','reason','ownerDecisionRef']<>'{}'::jsonb
  or exists(select 1 from jsonb_each(p_payload) where jsonb_typeof(value) is distinct from 'string')
  or nullif(btrim(p_payload->>'companyId'),'') is null or nullif(btrim(p_payload->>'sourceId'),'') is null
  or (p_payload->>'revision') !~ '^[0-9]{1,18}$'
  or length(btrim(p_payload->>'voucherNumber')) not between 1 and 80
  or length(btrim(p_payload->>'reason')) not between 10 and 500
  or length(btrim(p_payload->>'ownerDecisionRef')) not between 5 and 200
  or (p_payload->>'voucherDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or length(btrim(coalesce(p_actor,''))) not between 3 and 320 then
  raise exception 'Invalid errored voucher exclusion payload' using errcode='22023';
 end if;
 begin
  parsed_date:=(p_payload->>'voucherDate')::date;
 exception when data_exception then
  raise exception 'Invalid errored voucher exclusion payload' using errcode='22023';
 end;
 perform pg_advisory_xact_lock(hashtext('stockflow-errored-voucher-exclusions'));
 select * into previous_row from private.stockflow_economic_errored_voucher_exclusions
 where company_id=p_payload->>'companyId' and source_id=p_payload->>'sourceId' and source_revision=(p_payload->>'revision')::bigint;
 if found then
  if previous_row.voucher_number is distinct from p_payload->>'voucherNumber'
   or previous_row.voucher_date is distinct from parsed_date
   or previous_row.reason is distinct from p_payload->>'reason'
   or previous_row.owner_decision_ref is distinct from p_payload->>'ownerDecisionRef' then
   raise exception 'Errored voucher exclusion already recorded with different values' using errcode='23505';
  end if;
  return jsonb_build_object('id',previous_row.id,'sourceId',previous_row.source_id,'revision',previous_row.source_revision::text,'acknowledged',
   (select count(*) from private.stockflow_economic_import_exceptions e join private.stockflow_economic_import_exception_acks a on a.exception_id=e.id
     join private.stockflow_economic_import_exception_ack_actions aa on aa.id=a.action_id and aa.reason_group='errored_voucher_exclusion'
    where e.company_id=previous_row.company_id and e.source_id=previous_row.source_id and e.evidence->>'revision'=previous_row.source_revision::text
     and e.evidence->>'voucherType'='Debit Note' and e.evidence->>'amountStatus' is distinct from 'verified'));
 end if;
 select array_agg(e.id order by e.id) into eligible_ids
 from private.stockflow_economic_import_exceptions e
 where e.company_id=p_payload->>'companyId' and e.source_id=p_payload->>'sourceId'
  and e.evidence->>'voucherType'='Debit Note' and e.evidence->>'revision'=p_payload->>'revision'
  and e.evidence->>'amountStatus' is distinct from 'verified'
  and private.stockflow_economic_import_exception_open(e.id);
 n:=coalesce(cardinality(eligible_ids),0);
 if n=0 then
  raise exception 'Only an open errored Debit Note revision can be excluded' using errcode='22023';
 end if;
 insert into private.stockflow_economic_errored_voucher_exclusions(company_id,source_id,source_revision,voucher_type,voucher_number,voucher_date,reason,owner_decision_ref,approved_by)
 values(p_payload->>'companyId',p_payload->>'sourceId',(p_payload->>'revision')::bigint,'Debit Note',p_payload->>'voucherNumber',parsed_date,p_payload->>'reason',p_payload->>'ownerDecisionRef',p_actor)
 returning * into previous_row;
 request_id:=extensions.gen_random_uuid();
 ack_reason:=left(btrim(p_payload->>'reason')||' ['||btrim(p_payload->>'ownerDecisionRef')||']',500);
 insert into private.stockflow_economic_import_exception_ack_actions(id,reason_group,recorded_before,acknowledged_count,acknowledged_by,reason)
 values(request_id,'errored_voucher_exclusion',now(),n,p_actor,ack_reason);
 insert into private.stockflow_economic_import_exception_acks(exception_id,action_id,acknowledged_by,reason)
 select id,request_id,p_actor,ack_reason from unnest(eligible_ids) id;
 return jsonb_build_object('id',previous_row.id,'sourceId',previous_row.source_id,'revision',previous_row.source_revision::text,'acknowledged',n);
end $$;
revoke all on function private.stockflow_economic_exclude_errored_voucher(text,jsonb) from public,anon,authenticated,service_role;

alter function public.stockflow_economics_gateway(text,text,text,jsonb)
 rename to stockflow_economics_gateway_before_errored_exclusion;
create function public.stockflow_economics_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private,extensions set statement_timeout='20s' as $$
declare v_hash text; v_roles text[];
begin
 if p_action='exclude_errored_voucher' then
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
   raise exception 'Unauthorized gateway' using errcode='42501';
  end if;
  v_roles:=private.stockflow_active_member_roles(lower(btrim(coalesce(p_actor_email,''))));
  if not coalesce(v_roles&&array['administrator','management'],false) then
   raise exception 'Data checks are restricted' using errcode='42501';
  end if;
  return private.stockflow_economic_exclude_errored_voucher(lower(btrim(p_actor_email)),p_payload);
 end if;
 return public.stockflow_economics_gateway_before_errored_exclusion(p_gateway_key,p_actor_email,p_action,p_payload);
end $$;
revoke all on function public.stockflow_economics_gateway_before_errored_exclusion(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.stockflow_economics_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_economics_gateway(text,text,text,jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
