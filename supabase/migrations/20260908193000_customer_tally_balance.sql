alter table private.stockflow_customers add column tally_balance numeric(18,2);
alter table private.stockflow_customers add column balance_as_of timestamptz;

create or replace function private.stockflow_sync_tally_customers()
returns trigger language plpgsql security definer
set search_path = pg_catalog, private as $$
declare v_customer jsonb; v_tally_key text; v_name text; v_balance numeric(18,2);
begin
  if jsonb_typeof(new.payload->'customers') <> 'array' or jsonb_array_length(new.payload->'customers') = 0 then return new; end if;
  for v_customer in select value from jsonb_array_elements(new.payload->'customers') loop
    v_tally_key := nullif(btrim(v_customer->>'tallyKey'),''); v_name := nullif(btrim(v_customer->>'name'),'');
    if v_tally_key is null or v_name is null or char_length(v_name) not between 2 and 160 then continue; end if;
    begin v_balance := nullif(v_customer->>'tallyBalance','')::numeric; exception when invalid_text_representation or numeric_value_out_of_range then v_balance := null; end;
    insert into private.stockflow_customers(tally_key,name,phone,city,active,created_by_email,updated_at,tally_balance,balance_as_of)
    values(v_tally_key,v_name,nullif(left(btrim(coalesce(v_customer->>'phone','')),80),''),nullif(left(btrim(coalesce(v_customer->>'city','')),160),''),true,'tally-sync',now(),v_balance,case when v_balance is null then null else now() end)
    on conflict(tally_key) do update set name=excluded.name,phone=coalesce(excluded.phone,stockflow_customers.phone),city=coalesce(excluded.city,stockflow_customers.city),active=true,updated_at=now(),tally_balance=excluded.tally_balance,balance_as_of=excluded.balance_as_of;
  end loop;
  update private.stockflow_customers c set active=false,updated_at=now() where c.tally_key is not null and not exists(select 1 from jsonb_array_elements(new.payload->'customers') item where nullif(btrim(item->>'tallyKey'),'')=c.tally_key);
  return new;
end $$;
revoke all on function private.stockflow_sync_tally_customers() from public, anon, authenticated;

create or replace function public.stockflow_customer_gateway(
  p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, extensions as $$
declare v_email text:=lower(btrim(coalesce(p_actor_email,''))); v_hash text; v_role text;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  if p_action<>'get_customers' then raise exception 'Unsupported customer action' using errcode='22023'; end if;
  select role into v_role from public.stockflow_members where email=v_email and status='active';
  if v_role is null then raise exception 'Account is not approved' using errcode='42501'; end if;
  return jsonb_build_object('customerVersion',coalesce((select max(updated_at)::text||':'||count(*)::text from private.stockflow_customers where active),'0'),'customers',coalesce((select jsonb_agg(to_jsonb(customer) order by customer.name) from (select id,name,phone,city,tally_key as "tallyKey",case when v_role in ('administrator','accounts','management') then tally_balance else null end as "tallyBalance",case when v_role in ('administrator','accounts','management') then balance_as_of else null end as "balanceAsOf" from private.stockflow_customers where active order by name) customer),'[]'::jsonb));
end $$;
revoke all on function public.stockflow_customer_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_customer_gateway(text,text,text,jsonb) to service_role;
