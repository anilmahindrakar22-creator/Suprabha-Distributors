-- Compatibility foundation only. Permission union is deliberately not enabled.
begin;

alter table public.stockflow_members add column roles text[];
update public.stockflow_members set roles = array[role];
alter table public.stockflow_members alter column roles set not null;

-- Until every gateway understands role sets, prevent dormant extra permissions
-- from being stored and later activated accidentally.
alter table public.stockflow_members add constraint stockflow_members_roles_pending_union
  check (roles = array[role]);

create function private.sync_stockflow_member_legacy_roles()
returns trigger language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    if new.roles is null then new.roles := array[new.role]; end if;
  elsif new.role is distinct from old.role
    and new.roles is not distinct from old.roles then
    new.roles := array[new.role];
  end if;
  return new;
end;
$$;
revoke all on function private.sync_stockflow_member_legacy_roles() from public, anon, authenticated;
create trigger stockflow_members_legacy_roles
before insert or update on public.stockflow_members
for each row execute function private.sync_stockflow_member_legacy_roles();

-- Extend the existing immutable audit, preserving all historical actor facts.
alter table private.stockflow_member_events
  add column previous_roles text[], add column new_roles text[];
-- Existing immutable trigger stays enabled. Future audit readers must fall back
-- to scalar roles for historical rows, rather than rewriting immutable events.
create function private.populate_stockflow_member_event_roles()
returns trigger language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.previous_roles is null and new.previous_role is not null then
    new.previous_roles := array[new.previous_role];
  end if;
  if new.new_roles is null then new.new_roles := array[new.new_role]; end if;
  if new.new_roles is distinct from array[new.new_role]
    or new.previous_roles is distinct from
      (case when new.previous_role is null then null::text[] else array[new.previous_role] end) then
    raise exception 'Combined role audit is not enabled' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.populate_stockflow_member_event_roles() from public, anon, authenticated;
create trigger stockflow_member_events_roles
before insert on private.stockflow_member_events
for each row execute function private.populate_stockflow_member_event_roles();

comment on column public.stockflow_members.roles is
  'Singleton compatibility storage; combined permission union awaits gateway integration.';
comment on column private.stockflow_member_events.new_roles is
  'Role-set audit for new events; historical null means ARRAY[new_role].';
comment on column private.stockflow_member_events.previous_roles is
  'Role-set audit for new events; historical null with previous_role means ARRAY[previous_role].';
commit;
