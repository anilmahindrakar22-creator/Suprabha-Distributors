begin;
alter table public.stockflow_members drop constraint if exists stockflow_members_roles_pending_union;
insert into public.stockflow_members(email,role,status) values
 ('combined-admin@test.local','viewer','active'),('combined-member@test.local','sales','active');
update public.stockflow_members set roles=array['administrator','viewer'] where email='combined-admin@test.local';
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('combined-members-key','sha256'),'hex') where name='orders';
do $$
declare payload jsonb; result jsonb; stamp timestamptz;
begin
 select updated_at into stamp from public.stockflow_members where email='combined-member@test.local';
 payload:=jsonb_build_object('email','combined-member@test.local','role','sales','roles',jsonb_build_array('sales','warehouse'),
   'status','active','expectedUpdatedAt',stamp,'idempotencyKey','combined-member-roles-command');
 result:=public.stockflow_user_gateway('combined-members-key','combined-admin@test.local','upsert_user',payload);
 if result->'roles'<>'["sales","warehouse"]'::jsonb then raise exception 'Secondary Administrator assignment failed'; end if;
 if public.stockflow_user_gateway('combined-members-key','combined-admin@test.local','upsert_user',payload) is distinct from result then
   raise exception 'Assignment replay changed'; end if;
 if (select count(*) from private.stockflow_member_events where member_email='combined-member@test.local'
   and previous_roles='{"sales"}'::text[] and new_roles='{"sales","warehouse"}'::text[])<>1 then
   raise exception 'Role-set audit missing or duplicate'; end if;
 begin
  perform public.stockflow_user_gateway('combined-members-key','combined-admin@test.local','upsert_user',
    payload||'{"idempotencyKey":"combined-member-stale-command","roles":["sales"]}'::jsonb);
  raise exception 'Stale role assignment accepted';
 exception when sqlstate 'PT409' then null; end;
 begin
  perform public.stockflow_user_gateway('combined-members-key','combined-admin@test.local','upsert_user',
    (payload-'roles'-'expectedUpdatedAt')||'{"idempotencyKey":"combined-member-legacy-command"}'::jsonb);
  raise exception 'Legacy client erased combined roles';
 exception when sqlstate 'PT409' then null; end;
 select updated_at into stamp from public.stockflow_members where email='combined-admin@test.local';
 begin
  perform public.stockflow_user_gateway('combined-members-key','combined-admin@test.local','upsert_user',
    payload||jsonb_build_object('email','combined-admin@test.local','role','viewer','roles',jsonb_build_array('viewer'),
      'expectedUpdatedAt',stamp,'idempotencyKey','combined-self-demote-command'));
  raise exception 'Administrator removed own access';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.stockflow_user_gateway('combined-members-key','combined-member@test.local','upsert_user',payload);
  raise exception 'Operational user changed membership';
 exception when insufficient_privilege then null; end;
 update public.stockflow_members set status='suspended' where email='combined-admin@test.local';
 begin
  perform public.stockflow_user_gateway('combined-members-key','combined-admin@test.local','upsert_user',payload);
  raise exception 'Suspended administrator replay accepted';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
