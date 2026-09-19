create schema if not exists private;

create table if not exists public.stockflow_members (
  id bigint generated always as identity primary key,
  email text not null,
  user_id uuid unique references auth.users(id) on delete set null,
  role text not null default 'viewer' check (role in ('administrator','sales','operations','warehouse','accounts','management','viewer')),
  status text not null default 'invited' check (status in ('invited','active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stockflow_members_email_normalized check (email = lower(btrim(email))),
  constraint stockflow_members_email_unique unique (email)
);

alter table public.stockflow_members enable row level security;
revoke all on table public.stockflow_members from anon;
revoke insert, update, delete, truncate, references, trigger on table public.stockflow_members from authenticated;
grant select on table public.stockflow_members to authenticated;

create policy "members_read_own_access"
on public.stockflow_members
for select
to authenticated
using ((select auth.uid()) = user_id and status = 'active');

create or replace function private.bind_stockflow_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.stockflow_members
     set user_id = new.id,
         status = case when status = 'suspended' then status else 'active' end,
         updated_at = now()
   where email = lower(btrim(new.email))
     and (user_id is null or user_id = new.id);
  return new;
end;
$$;

revoke all on function private.bind_stockflow_member() from public, anon, authenticated;

create or replace trigger bind_stockflow_member_after_auth_user
  after insert or update of email on auth.users
  for each row
  execute function private.bind_stockflow_member();

insert into public.stockflow_members (email, role, status)
values
  ('nikitesh.am@gmail.com', 'administrator', 'invited'),
  ('anil.mahindrakar22@gmail.com', 'administrator', 'invited')
on conflict (email) do update
set role = excluded.role,
    status = case when public.stockflow_members.status = 'active' then 'active' else excluded.status end,
    updated_at = now();

comment on table public.stockflow_members is 'Invite-only StockFlow application membership and role allowlist.';
