-- New orders are numbered per Indian financial year (1 April to 31 March, IST):
-- SO/26-27/0049. Existing SF-YYMMDD-NNNNN numbers are kept unchanged.
-- The counter row is locked by the create transaction, so concurrent creates
-- get distinct consecutive numbers and a rolled-back create releases its number.

create table private.stockflow_order_number_counters (
  financial_year text primary key check (financial_year ~ '^[0-9]{2}-[0-9]{2}$'),
  last_value integer not null check (last_value >= 0),
  updated_at timestamptz not null default now()
);
alter table private.stockflow_order_number_counters enable row level security;
revoke all on table private.stockflow_order_number_counters from public, anon, authenticated;

create or replace function private.stockflow_financial_year(p_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select lpad((y % 100)::text, 2, '0') || '-' || lpad(((y + 1) % 100)::text, 2, '0')
  from (
    select extract(year from p_at at time zone 'Asia/Kolkata')::integer
      - case when extract(month from p_at at time zone 'Asia/Kolkata') < 4 then 1 else 0 end as y
  ) fy;
$$;
revoke all on function private.stockflow_financial_year(timestamptz) from public, anon, authenticated;

create or replace function private.stockflow_next_order_number(p_at timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year text := private.stockflow_financial_year(p_at);
  v_value integer;
begin
  insert into private.stockflow_order_number_counters as c (financial_year, last_value)
  values (v_year, 1)
  on conflict (financial_year) do update set last_value = c.last_value + 1, updated_at = now()
  returning c.last_value into v_value;
  return 'SO/' || v_year || '/' || case when v_value >= 10000 then v_value::text else lpad(v_value::text, 4, '0') end;
end $$;
revoke all on function private.stockflow_next_order_number(timestamptz) from public, anon, authenticated;

-- Continue from the highest existing running number this financial year, so the
-- first new number follows the last SF number (identity values can have gaps).
insert into private.stockflow_order_number_counters (financial_year, last_value)
select private.stockflow_financial_year(now()), coalesce(max(order_seq), 0)::integer
from private.stockflow_orders
where private.stockflow_financial_year(created_at) = private.stockflow_financial_year(now());

-- The public gateway wraps the original order gateway (renamed in
-- 20260921160000); the number assignment lives in that inner function.
do $$
declare
  f text;
  outer_f text;
  anchor constant text := $a$    v_order_number := 'SF-' || to_char(now(), 'YYMMDD') || '-' || lpad(v_order_seq::text, 5, '0');$a$;
begin
  select pg_get_functiondef('public.stockflow_order_gateway(text,text,text,jsonb)'::regprocedure) into outer_f;
  if position(anchor in outer_f) > 0 then
    raise exception 'Order number assignment unexpectedly found in the public gateway wrapper';
  end if;
  select pg_get_functiondef('public.stockflow_order_gateway_before_auto_pricing(text,text,text,jsonb)'::regprocedure) into f;
  if (length(f) - length(replace(f, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'Expected exactly one create-order number assignment';
  end if;
  execute replace(f, anchor, $n$    v_order_number := private.stockflow_next_order_number(now());$n$);
end $$;
