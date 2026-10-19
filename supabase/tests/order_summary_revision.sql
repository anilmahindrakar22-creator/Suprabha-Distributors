begin;
insert into public.stockflow_members(email,role,status) values ('revision-sales@test.local','sales','active'),('revision-ops@test.local','operations','active');
update private.stockflow_role_order_scopes set scope='created_by' where role='sales';
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('revision-test-key','sha256'),'hex') where name='orders';
insert into private.stockflow_orders(id,customer_name,status,idempotency_key,created_by_email,updated_by_email) values
 ('61000000-0000-4000-8000-000000000001','Revision visible','confirmed','revision-1','revision-sales@test.local','test'),
 ('61000000-0000-4000-8000-000000000002','Revision private','packed','revision-2','other@test.local','test');
do $$
declare before_sales text; before_ops text; after_sales text; after_ops text; counters jsonb;
begin
 before_sales:=public.stockflow_order_summary_gateway('revision-test-key','revision-sales@test.local','get_order_summary')->>'orderRevision';
 before_ops:=public.stockflow_order_summary_gateway('revision-test-key','revision-ops@test.local','get_order_summary')->>'orderRevision';
 if before_sales !~ '^[0-9a-f]{32}$' or before_ops !~ '^[0-9a-f]{32}$' then raise exception 'Revision missing';end if;
 if before_sales is distinct from private.stockflow_order_revision('revision-sales@test.local',array['sales']) then raise exception 'Scope not authoritative';end if;
 if before_sales is distinct from (public.stockflow_order_summary_gateway('revision-test-key','revision-sales@test.local','get_order_summary')->>'orderRevision') then raise exception 'Read changed revision';end if;
 update private.stockflow_orders set version=version+1 where id='61000000-0000-4000-8000-000000000002';
 if before_sales is distinct from private.stockflow_order_revision('revision-sales@test.local',array['sales']) then raise exception 'Invisible order change leaked';end if;
 if before_ops is not distinct from private.stockflow_order_revision('revision-ops@test.local',array['operations']) then raise exception 'Version-only update missed';end if;
 before_ops:=private.stockflow_order_revision('revision-ops@test.local',array['operations']);
 counters:=private.stockflow_operations_summary('revision-ops@test.local',array['operations']);
 update private.stockflow_orders set status='packed',version=version+1 where id='61000000-0000-4000-8000-000000000001';
 update private.stockflow_orders set archived_at=now() where id='61000000-0000-4000-8000-000000000002';
 insert into private.stockflow_orders(id,customer_name,status,idempotency_key,created_by_email,updated_by_email)
 values('61000000-0000-4000-8000-000000000003','Replacement order','confirmed','revision-3','other@test.local','test');
 if counters is distinct from private.stockflow_operations_summary('revision-ops@test.local',array['operations']) then raise exception 'Fixture counts changed';end if;
 after_ops:=private.stockflow_order_revision('revision-ops@test.local',array['operations']);
 if before_ops is not distinct from after_ops then raise exception 'Equal-count replacement missed';end if;
 if before_sales is not distinct from private.stockflow_order_revision('revision-sales@test.local',array['sales']) then raise exception 'Visible stage update missed';end if;
 update private.stockflow_orders set assigned_to_email='revision-ops@test.local',version=version+1 where id='61000000-0000-4000-8000-000000000001';
 if after_ops is not distinct from private.stockflow_order_revision('revision-ops@test.local',array['operations']) then raise exception 'Reassignment missed';end if;
 after_sales:=private.stockflow_order_revision('revision-sales@test.local',array['sales']);
 update private.stockflow_orders set archived_at=now() where id='61000000-0000-4000-8000-000000000001';
 if after_sales is not distinct from private.stockflow_order_revision('revision-sales@test.local',array['sales']) then raise exception 'Archive missed';end if;
 if private.stockflow_order_revision('revision-sales@test.local',array['sales','operations']) is distinct from private.stockflow_order_revision('revision-ops@test.local',array['operations']) then raise exception 'Combined role scope failed';end if;
 if has_function_privilege('authenticated','private.stockflow_order_revision(text,text[])','execute') then raise exception 'Private helper exposed';end if;
 begin
  perform public.stockflow_order_summary_gateway('wrong','revision-sales@test.local','get_order_summary');raise exception 'Wrong secret accepted';
 exception when insufficient_privilege then null;end;
 update public.stockflow_members set status='suspended' where email='revision-sales@test.local';
 begin
  perform public.stockflow_order_summary_gateway('revision-test-key','revision-sales@test.local','get_order_summary');raise exception 'Suspended member accepted';
 exception when insufficient_privilege then null;end;
end $$;
rollback;
