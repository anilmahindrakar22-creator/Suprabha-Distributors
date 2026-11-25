begin;

do $$
begin
 if md5(replace((select prosrc from pg_proc where oid='private.stockflow_economic_import_exception_open(bigint)'::regprocedure),chr(13),''))<>'ff35ef0318676ffbbee5abfb51ab5e2b' then raise exception 'Unexpected import exception open check'; end if;
end $$;

create function private.stockflow_economic_import_exception_dedupe() returns trigger
language plpgsql set search_path=pg_catalog,private as $$
begin
 if new.source_id is not null and exists(
  select 1 from private.stockflow_economic_import_exceptions e
  where e.company_id is not distinct from new.company_id
   and e.source_id=new.source_id and e.reason=new.reason
   and e.evidence->>'revision' is not distinct from new.evidence->>'revision'
   and private.stockflow_economic_import_exception_open(e.id)
 ) then return null; end if;
 return new;
end $$;
revoke all on function private.stockflow_economic_import_exception_dedupe() from public,anon,authenticated,service_role;
create trigger stockflow_economic_import_exception_dedupe before insert
 on private.stockflow_economic_import_exceptions for each row
 execute function private.stockflow_economic_import_exception_dedupe();
create index if not exists stockflow_economic_import_exceptions_source_reason on private.stockflow_economic_import_exceptions (company_id, source_id, reason) where source_id is not null;

create table private.stockflow_economic_import_exception_acks (
 id bigint generated always as identity primary key,
 exception_id bigint not null unique references private.stockflow_economic_import_exceptions(id),
 action_id uuid not null,
 acknowledged_by text not null check (length(btrim(acknowledged_by)) between 3 and 320),
 reason text not null check (length(btrim(reason)) between 10 and 500),
 acknowledged_at timestamptz not null default now()
);
create table private.stockflow_economic_import_exception_ack_actions (
 id uuid primary key, reason_group text not null, recorded_before timestamptz not null,
 acknowledged_count integer not null check (acknowledged_count > 0),
 acknowledged_by text not null, reason text not null, acknowledged_at timestamptz not null default now()
);
create function private.stockflow_economic_exception_ack_append_only() returns trigger
language plpgsql set search_path=pg_catalog,private as $$
begin
 raise exception 'Acknowledgements are append-only';
end $$;
revoke all on function private.stockflow_economic_exception_ack_append_only() from public,anon,authenticated,service_role;
create trigger stockflow_exception_acks_append_only before update or delete
 on private.stockflow_economic_import_exception_acks for each row
 execute function private.stockflow_economic_exception_ack_append_only();
create trigger stockflow_exception_ack_actions_append_only before update or delete
 on private.stockflow_economic_import_exception_ack_actions for each row
 execute function private.stockflow_economic_exception_ack_append_only();
revoke all on private.stockflow_economic_import_exception_acks,private.stockflow_economic_import_exception_ack_actions from public,anon,authenticated,service_role;

create or replace function private.stockflow_economic_import_exception_open(p_id bigint)
returns boolean language sql stable set search_path=pg_catalog,private as $$
 select exists(
  select 1 from private.stockflow_economic_import_exceptions e where e.id=p_id
  and not exists(
   select 1 from private.stockflow_economic_source_vouchers v
   where v.company_id=e.company_id and v.source_id=e.source_id
   and case when e.evidence->>'revision' ~ '^[0-9]{1,19}$' then
    v.source_revision>(e.evidence->>'revision')::numeric
    or (v.source_revision=(e.evidence->>'revision')::numeric and v.imported_at>e.recorded_at)
   else v.imported_at>e.recorded_at end
  )
  and not exists(select 1 from private.stockflow_economic_import_exception_acks a where a.exception_id=e.id)
 )
$$;
revoke all on function private.stockflow_economic_import_exception_open(bigint) from public,anon,authenticated;

create function private.stockflow_economic_acknowledge_exceptions(p_actor text,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,private,extensions as $$
declare request_id uuid; expected_count integer; eligible_ids bigint[]; n integer;
 cutoff timestamptz:=now()-interval '7 days'; previous_action private.stockflow_economic_import_exception_ack_actions%rowtype;
begin
 if jsonb_typeof(p_payload) is distinct from 'object' then
  raise exception 'Invalid acknowledgement payload' using errcode='22023';
 end if;
 if not (p_payload ?& array['requestId','reason','expectedCount','note'])
  or p_payload-array['requestId','reason','expectedCount','note']<>'{}'::jsonb
  or jsonb_typeof(p_payload->'requestId') is distinct from 'string'
  or jsonb_typeof(p_payload->'reason') is distinct from 'string'
  or jsonb_typeof(p_payload->'expectedCount') is distinct from 'number'
  or jsonb_typeof(p_payload->'note') is distinct from 'string'
  or length(btrim(p_payload->>'note')) not between 10 and 500
  or (p_payload->>'expectedCount') !~ '^-?[0-9]+$'
  or length(btrim(coalesce(p_actor,''))) not between 3 and 320 then
  raise exception 'Invalid acknowledgement payload' using errcode='22023';
 end if;
 begin
  request_id:=(p_payload->>'requestId')::uuid;
  expected_count:=(p_payload->>'expectedCount')::integer;
 exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Invalid acknowledgement payload' using errcode='22023';
 end;
 perform pg_advisory_xact_lock(hashtext('stockflow-exception-acks'));
 select * into previous_action from private.stockflow_economic_import_exception_ack_actions where id=request_id;
 if found then
  return jsonb_build_object('actionId',previous_action.id,'acknowledged',previous_action.acknowledged_count);
 end if;
 select array_agg(e.id order by e.id) into eligible_ids
 from private.stockflow_economic_import_exceptions e
 where e.reason=p_payload->>'reason' and e.source_id is null and e.recorded_at<cutoff
  and private.stockflow_economic_import_exception_open(e.id);
 n:=coalesce(cardinality(eligible_ids),0);
 if n=0 then raise exception 'Nothing to acknowledge' using errcode='22023'; end if;
 if n<>expected_count then raise exception 'Problem count changed; reload' using errcode='40001'; end if;
 insert into private.stockflow_economic_import_exception_ack_actions
  (id,reason_group,recorded_before,acknowledged_count,acknowledged_by,reason)
 values(request_id,p_payload->>'reason',cutoff,n,p_actor,p_payload->>'note');
 insert into private.stockflow_economic_import_exception_acks(exception_id,action_id,acknowledged_by,reason)
 select id,request_id,p_actor,p_payload->>'note' from unnest(eligible_ids) id;
 return jsonb_build_object('actionId',request_id,'acknowledged',n);
end $$;
revoke all on function private.stockflow_economic_acknowledge_exceptions(text,jsonb) from public,anon,authenticated,service_role;

alter function private.stockflow_data_speed_report_read(jsonb) rename to stockflow_data_speed_report_read_before_exception_acks;
create function private.stockflow_data_speed_report_read(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,private,extensions as $$
declare result jsonb; problems jsonb;
begin
 result:=private.stockflow_data_speed_report_read_before_exception_acks(p);
 select coalesce(jsonb_agg(g.value||jsonb_build_object('acknowledgeable',(
  select count(*) from private.stockflow_economic_import_exceptions e
  where e.reason=g.value->>'reason' and e.source_id is null and e.recorded_at<now()-interval '7 days'
   and private.stockflow_economic_import_exception_open(e.id)
 )) order by g.ordinality),'[]'::jsonb) into problems
 from jsonb_array_elements(result->'exceptions') with ordinality g(value,ordinality);
 return jsonb_set(result,'{exceptions}',problems);
end $$;
revoke all on function private.stockflow_data_speed_report_read_before_exception_acks(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.stockflow_data_speed_report_read(jsonb) from public,anon,authenticated,service_role;

alter function public.stockflow_economics_gateway(text,text,text,jsonb)
 rename to stockflow_economics_gateway_before_exception_acks;
create function public.stockflow_economics_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private,extensions set statement_timeout='20s' as $$
declare v_hash text; v_roles text[];
begin
 if p_action='acknowledge_economic_exceptions' then
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
   raise exception 'Unauthorized gateway' using errcode='42501';
  end if;
  v_roles:=private.stockflow_active_member_roles(lower(btrim(coalesce(p_actor_email,''))));
  if not coalesce(v_roles&&array['administrator','management'],false) then
   raise exception 'Data checks are restricted' using errcode='42501';
  end if;
  return private.stockflow_economic_acknowledge_exceptions(lower(btrim(p_actor_email)),p_payload);
 end if;
 return public.stockflow_economics_gateway_before_exception_acks(p_gateway_key,p_actor_email,p_action,p_payload);
end $$;
revoke all on function public.stockflow_economics_gateway_before_exception_acks(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.stockflow_economics_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_economics_gateway(text,text,text,jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
