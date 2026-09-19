create table if not exists public.stockflow_snapshots (
  id text primary key,
  company text not null,
  fetched_at text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.stockflow_snapshots enable row level security;
revoke all on table public.stockflow_snapshots from anon, authenticated;
comment on table public.stockflow_snapshots is 'Private latest StockFlow snapshots; accessed only through the authenticated Edge Function.';
