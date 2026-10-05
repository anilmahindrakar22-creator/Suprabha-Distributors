begin;
-- Activation is last: all prior gateway and membership-governance migrations are required.
alter table public.stockflow_members add constraint stockflow_members_valid_role_set
  check (private.stockflow_valid_roles(roles) and role=any(roles));
alter table public.stockflow_members drop constraint stockflow_members_roles_pending_union;
create or replace function private.sync_stockflow_member_legacy_roles()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='INSERT' then
  if new.roles is null then new.roles:=array[new.role]; end if;
 elsif new.role is distinct from old.role and new.roles is not distinct from old.roles then
  if cardinality(old.roles)>1 then
   if not (new.role=any(old.roles)) then raise exception 'Explicit role-set update required' using errcode='23514'; end if;
  else new.roles:=array[new.role]; end if;
 end if;
 return new;
end $$;
revoke all on function private.sync_stockflow_member_legacy_roles() from public,anon,authenticated;
comment on column public.stockflow_members.roles is
 'Authoritative permission union; primary role remains for legacy labels and audit compatibility.';
commit;
