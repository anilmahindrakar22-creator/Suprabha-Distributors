begin;

create table private.stockflow_account_class_policies (
  id uuid primary key default extensions.gen_random_uuid(),
  a_min_paise bigint not null, b_min_paise bigint not null,
  check(b_min_paise>0 and a_min_paise>b_min_paise),
  effective_from timestamptz not null default now(), actor text not null,
  reason text not null check(char_length(btrim(reason)) between 3 and 500)
);
alter table private.stockflow_account_class_policies enable row level security;
revoke all on private.stockflow_account_class_policies from public,anon,authenticated;
create trigger stockflow_account_class_policies_no_delete before delete on private.stockflow_account_class_policies
  for each row execute function private.prevent_business_delete();
create trigger stockflow_account_class_policies_no_update before update on private.stockflow_account_class_policies
  for each row execute function private.prevent_order_event_mutation();
insert into private.stockflow_account_class_policies(a_min_paise,b_min_paise,actor,reason)
  values(20000000,7500000,'migration','D-13 owner thresholds (14 Oct 2026)');

-- Seam for the full-sales import (MARKET-FULL-SALES-IMPORT-PLAN step 4). The integration owner replaces this when windows are marked complete. Until then every class is not_available.
create function private.stockflow_sales_window_complete(p_company text,p_from date,p_to date)
returns boolean language sql stable as $$ select false $$;
revoke all on function private.stockflow_sales_window_complete(text,date,date) from public,anon,authenticated,service_role;

create function private.stockflow_account_class_window(p_today date)
returns table(window_from date,window_to date) language sql stable as $$
  select (date_trunc('month',p_today::timestamp)-interval '3 months')::date,
    (date_trunc('month',p_today::timestamp)-interval '1 day')::date
$$;
revoke all on function private.stockflow_account_class_window(date) from public,anon,authenticated,service_role;

-- Net-value policy (discount, rounding, freight) requires the integration owner's
-- financial review before activation. net_sales_paise excludes GST. The canonical
-- importer requires negative returns/credits; sum their stored signs unchanged.
create function private.stockflow_account_class(p_customer uuid,p_today date)
returns jsonb language plpgsql stable as $$
declare
  v_from date; v_to date; v_company text; v_monthly numeric; v_state text;
  v_window jsonb; v_policy private.stockflow_account_class_policies%rowtype;
begin
  select window_from,window_to into v_from,v_to from private.stockflow_account_class_window(p_today);
  v_window:=jsonb_build_object('from',v_from,'to',v_to);
  if not exists(select 1 from private.stockflow_economic_customer_identities where customer_id=p_customer) then
    return jsonb_build_object('state','not_linked','monthlyPaise',null,'window',v_window);
  end if;
  for v_company in select distinct company_id from private.stockflow_economic_customer_identities where customer_id=p_customer loop
    if private.stockflow_sales_window_complete(v_company,v_from,v_to) is distinct from true then
      return jsonb_build_object('state','not_available','monthlyPaise',null,'window',v_window);
    end if;
  end loop;
  select round(coalesce(sum(l.net_sales_paise),0)/3) into v_monthly
  from private.stockflow_economic_source_lines l
  join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
  join private.stockflow_economic_customer_identities i on i.company_id=v.company_id and i.source_id=v.customer_source_id
  where i.customer_id=p_customer and v.business_date between v_from and v_to
    and not v.cancelled and v.kind in ('sale','return','credit') and l.foc_reason is null
    and not exists(select 1 from private.stockflow_economic_source_vouchers n
      where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision);
  select * into strict v_policy from private.stockflow_account_class_policies order by effective_from desc,id desc limit 1;
  v_state:=case when v_monthly>=v_policy.a_min_paise then 'A' when v_monthly>=v_policy.b_min_paise then 'B' else 'below_b' end;
  return jsonb_build_object('state',v_state,'monthlyPaise',v_monthly::text,'window',v_window,'policyId',v_policy.id);
end $$;
revoke all on function private.stockflow_account_class(uuid,date) from public,anon,authenticated,service_role;

-- Patch only the reviewed W1 seams; fail closed if any anchor drifts.
do $upgrade$
declare
  v_definition text; v_anchor text; v_index integer;
  v_anchors text[]:=array[
    $old$  v_visited date; v_next date; v_outcome text; v_note text;$old$,
    $old$('get_accounts','create_territory','assign_account','set_location','log_visit')$old$,
    $old$  if jsonb_typeof(p_payload) is distinct from 'object' then$old$,
    $old$    v_search:=lower(coalesce(p_payload->>'search',''));$old$,
    $old$    with filtered as materialized ($old$,
    $old$    ), latest as ($old$,
    $old$'id',s.id,'name',s.name,'city',s.city,$old$,
    $old$'today',v_today) into v_result;$old$,
    $old$  if p_action='create_territory' then$old$
  ];
  v_replacements text[]:=array[
    $new$  v_visited date; v_next date; v_outcome text; v_note text;
  v_class text; v_a_min bigint; v_b_min bigint; v_reason text;$new$,
    $new$('get_accounts','create_territory','assign_account','set_location','log_visit','set_class_policy')$new$,
    $new$  if p_action='set_class_policy' and not (v_roles && array['administrator']::text[]) then
    raise exception 'Administrator required to change account class policy' using errcode='42501';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then$new$,
    $new$    v_class:=p_payload->>'class';
    if p_payload ? 'class' and (jsonb_typeof(p_payload->'class') is distinct from 'string'
      or v_class not in ('A','B','below_b','not_available','not_linked')) then
      raise exception 'Invalid account class' using errcode='22023'; end if;
    v_search:=lower(coalesce(p_payload->>'search',''));$new$,
    $new$    with candidates as materialized ($new$,
    $new$    ), classified as materialized (
      select c.*,case when v_class is not null then private.stockflow_account_class(c.id,v_today) end as account_class
      from candidates c
    ), filtered as materialized (
      select * from classified where v_class is null or account_class->>'state'=v_class
    ), latest as ($new$,
    $new$'id',s.id,'name',s.name,'city',s.city,
        'class',coalesce(s.account_class,private.stockflow_account_class(s.id,v_today)),$new$,
    $new$'today',v_today,'classPolicy',(select jsonb_build_object('aMinPaise',p.a_min_paise::text,'bMinPaise',p.b_min_paise::text)
        from private.stockflow_account_class_policies p order by p.effective_from desc,p.id desc limit 1)) into v_result;$new$,
    $new$  if p_action='set_class_policy' then
    if jsonb_typeof(p_payload->'aMinPaise') is distinct from 'string'
      or jsonb_typeof(p_payload->'bMinPaise') is distinct from 'string'
      or (p_payload->>'aMinPaise') !~ '^[0-9]{1,19}$' or (p_payload->>'bMinPaise') !~ '^[0-9]{1,19}$'
      or jsonb_typeof(p_payload->'reason') is distinct from 'string'
      or char_length(btrim(p_payload->>'reason')) not between 3 and 500 then
      raise exception 'Invalid account class policy' using errcode='22023'; end if;
    begin
      v_a_min:=(p_payload->>'aMinPaise')::bigint; v_b_min:=(p_payload->>'bMinPaise')::bigint;
    exception when numeric_value_out_of_range then raise exception 'Invalid account class thresholds' using errcode='22023'; end;
    if v_b_min<=0 or v_a_min<=v_b_min then raise exception 'Invalid account class thresholds' using errcode='22023'; end if;
    v_reason:=btrim(p_payload->>'reason');
    -- Serialize policy changes and order them after existing rows even within one transaction.
    lock table private.stockflow_account_class_policies in share row exclusive mode;
    insert into private.stockflow_account_class_policies(a_min_paise,b_min_paise,actor,reason,effective_from)
      values(v_a_min,v_b_min,v_email,v_reason,greatest(clock_timestamp(),
        (select max(effective_from)+interval '1 microsecond' from private.stockflow_account_class_policies))) returning id into v_id;
    v_result:=jsonb_build_object('ok',true,'policyId',v_id,'classPolicy',jsonb_build_object('aMinPaise',v_a_min::text,'bMinPaise',v_b_min::text));
  elsif p_action='create_territory' then$new$
  ];
begin
  v_definition:=replace(pg_get_functiondef('public.stockflow_accounts_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
  for v_index in 1..array_length(v_anchors,1) loop
    v_anchor:=v_anchors[v_index];
    if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor)<>1 then
      raise exception 'Unexpected accounts gateway anchor %',v_index;
    end if;
    v_definition:=replace(v_definition,v_anchor,v_replacements[v_index]);
  end loop;
  execute v_definition;
end $upgrade$;
revoke all on function public.stockflow_accounts_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_accounts_gateway(text,text,text,jsonb) to service_role;

commit;
