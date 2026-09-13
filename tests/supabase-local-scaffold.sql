do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.stockflow_members (
  email text primary key,
  role text not null,
  status text not null default 'active',
  updated_at timestamptz not null default now()
);

create table public.stockflow_snapshots (
  id text primary key,
  company text not null,
  fetched_at timestamptz not null,
  payload jsonb not null
);

insert into public.stockflow_snapshots(id,company,fetched_at,payload)
values('suprabha','SUPRABHA DISTRIBUTORS',now(),'{}'::jsonb);
