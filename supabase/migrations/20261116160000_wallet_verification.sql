begin;

create table private.stockflow_wallet_verifications (
 id uuid primary key default gen_random_uuid(),
 snapshot_id uuid not null unique references private.stockflow_wallet_snapshots(id) on delete restrict,
 verified_by text not null,
 verified_at timestamptz not null default now(),
 note text not null check (char_length(btrim(note)) between 3 and 500),
 request_id text
);
alter table private.stockflow_wallet_verifications enable row level security;
revoke all on private.stockflow_wallet_verifications from public,anon,authenticated,service_role;
create trigger stockflow_wallet_verifications_no_delete before delete on private.stockflow_wallet_verifications
 for each row execute function private.prevent_business_delete();
create trigger stockflow_wallet_verifications_immutable before update on private.stockflow_wallet_verifications
 for each row execute function private.prevent_immutable_pricing_update();

-- Patch the replayed definitions, preserving earlier wallet and lab-size changes.
do $patch$
declare definition text; old_text text; new_text text;
begin
 definition:=replace(pg_get_functiondef('public.stockflow_wallet_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
 for old_text,new_text in select * from (values
 ($old$not in ('record_wallet_snapshot','set_wallet_policy')$old$,
  $new$not in ('record_wallet_snapshot','set_wallet_policy','verify_wallet_snapshot')$new$),
 ($old$  result:=jsonb_build_object('ok',true,'snapshotId',entity);
 else
  perform pg_advisory_xact_lock(hashtextextended('wallet-policy',0));$old$,
  $new$  result:=jsonb_build_object('ok',true,'snapshotId',entity);
 elsif p_action='verify_wallet_snapshot' then
  select * into current_snapshot from private.stockflow_wallet_snapshots where id=(p_payload->>'snapshotId')::uuid;
  if not found then raise exception 'Estimate not found' using errcode='22023';end if;
  customer:=current_snapshot.customer_id;
  perform pg_advisory_xact_lock(hashtextextended('wallet:'||customer,0));
  select * into current_snapshot from private.stockflow_wallet_snapshots
   where customer_id=customer order by as_of desc,entered_at desc,id desc limit 1;
  if current_snapshot.id is distinct from (p_payload->>'snapshotId')::uuid then
   raise exception 'Only the current estimate can be verified' using errcode='22023';
  end if;
  if lower(current_snapshot.entered_by)=lower(actor) then
   raise exception 'Someone other than the person who entered it must verify' using errcode='22023';
  end if;
  if exists(select 1 from private.stockflow_wallet_verifications where snapshot_id=current_snapshot.id) then
   raise exception 'Estimate is already verified' using errcode='PT409';
  end if;
  insert into private.stockflow_wallet_verifications(snapshot_id,verified_by,note,request_id)
  values(current_snapshot.id,actor,btrim(p_payload->>'note'),key)
  returning id,jsonb_build_object('ok',true,'snapshotId',snapshot_id,'verifiedBy',verified_by,'verifiedAt',verified_at)
   into entity,result;
 else
  perform pg_advisory_xact_lock(hashtextextended('wallet-policy',0));$new$)
 ) patches(old_text,new_text) loop
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
   raise exception 'Unexpected wallet verification gateway anchor: %',old_text;
  end if;
  definition:=replace(definition,old_text,new_text);
  if position(old_text in definition)>0 then raise exception 'Legacy wallet verification gateway anchor remains';end if;
 end loop;
 -- The existing begin/finish command calls and audit insert serve this branch too.
 execute definition;

 definition:=replace(pg_get_functiondef('private.stockflow_wallet_read(date)'::regprocedure),chr(13),'');
 -- current_snapshots selects *, so s.id is already available for the join.
 for old_text,new_text in select * from (values
 ($old$select c.id,c.name,c.city,s.monthly_wallet_paise wallet,s.confidence,s.as_of,$old$,
  $new$select c.id,c.name,c.city,s.monthly_wallet_paise wallet,s.confidence,v.snapshot_id is not null verified,s.as_of,$new$),
 ($old$from private.stockflow_customers c left join current_snapshots s on s.customer_id=c.id left join sales a on a.customer_id=c.id$old$,
  $new$from private.stockflow_customers c left join current_snapshots s on s.customer_id=c.id
   left join private.stockflow_wallet_verifications v on v.snapshot_id=s.id left join sales a on a.customer_id=c.id$new$),
 ($old$'verified',false$old$,$new$'verified',verified$new$)
 ) patches(old_text,new_text) loop
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
   raise exception 'Unexpected wallet verification workspace anchor: %',old_text;
  end if;
  definition:=replace(definition,old_text,new_text);
  if position(old_text in definition)>0 then raise exception 'Legacy wallet verification workspace anchor remains';end if;
 end loop;
 execute definition;

 definition:=replace(pg_get_functiondef('private.stockflow_wallet_account_read(date,uuid)'::regprocedure),chr(13),'');
 old_text:=$old$'verifiedBy',s.verified_by,$old$;
 new_text:=$new$'verifiedBy',(select v.verified_by from private.stockflow_wallet_verifications v where v.snapshot_id=s.id),
  'verifiedAt',(select v.verified_at from private.stockflow_wallet_verifications v where v.snapshot_id=s.id),
  'verificationNote',(select v.note from private.stockflow_wallet_verifications v where v.snapshot_id=s.id),$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
  raise exception 'Unexpected wallet verification account anchor';
 end if;
 definition:=replace(definition,old_text,new_text);
 if position(old_text in definition)>0 then raise exception 'Legacy wallet verification account anchor remains';end if;
 execute definition;
end $patch$;

commit;
