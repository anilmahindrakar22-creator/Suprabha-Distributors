begin;

-- Older installed equipment is a real asset, even when no OMS order exists.
-- Keep it in the existing register; never manufacture an order for onboarding.
alter table private.stockflow_equipment_installations alter column order_id drop not null;
alter table private.stockflow_equipment_installations
 add column customer_id uuid references private.stockflow_customers(id),
 add column historical_sale_line_id uuid references private.stockflow_economic_source_lines(id),
 add column installed_on date,
 add constraint stockflow_installation_origin check (
  (order_id is not null and customer_id is null and historical_sale_line_id is null and installed_on is null)
  or (order_id is null and customer_id is not null and historical_sale_line_id is not null and installed_on is not null and status='completed')
 );
create unique index stockflow_historical_installation_invoice on private.stockflow_equipment_installations(tally_key) where order_id is null;
alter table private.stockflow_service_tickets alter column order_id drop not null;

create function private.stockflow_register_historical_instrument(p_actor text,p_payload jsonb)
returns uuid language plpgsql set search_path=pg_catalog,private,public,extensions as $$
declare sale record;customer uuid;day date;serial text;reference text;entity uuid;
begin
 customer:=(p_payload->>'customerId')::uuid;day:=(p_payload->>'installedOn')::date;
 serial:=btrim(coalesce(p_payload->>'serialNumber',''));reference:=btrim(coalesce(p_payload->>'reason',''));
 if day is null or day>private.stockflow_economic_business_date() or length(serial) not between 2 and 100 or length(reference) not between 3 and 1000 then raise exception 'Confirmed installation date, serial and evidence are required' using errcode='22023';end if;
 if not exists(select 1 from private.stockflow_customers where id=customer and active) then raise exception 'Select an active canonical customer' using errcode='22023';end if;
 select l.*,v.company_id,v.source_id,v.source_revision,v.business_date,v.kind,v.cancelled,v.customer_source_id,v.evidence as voucher_evidence into sale
 from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where l.id=(p_payload->>'sourceLineId')::uuid;
 if not found or sale.kind<>'sale' or sale.cancelled or sale.quantity<>1 or sale.net_sales_paise<=0 or sale.business_date>day or sale.customer_source_id is null then raise exception 'Installation needs one billed instrument dated on or before installation' using errcode='22023';end if;
 if p_payload->>'expectedSourceRevision' is distinct from sale.source_revision::text or private.stockflow_economic_source_unresolved(sale.company_id,sale.source_id)
  or exists(select 1 from private.stockflow_economic_source_vouchers v where v.company_id=sale.company_id and v.source_id=sale.source_id and v.source_revision>sale.source_revision) then raise exception 'Instrument invoice changed; refresh before registration' using errcode='PT409';end if;
 if sale.batch_id is not null and sale.batch_id<>serial then raise exception 'Serial must match the instrument invoice batch evidence' using errcode='22023';end if;
 if exists(select 1 from private.stockflow_equipment_installations i left join private.stockflow_orders o on o.id=i.order_id where coalesce(i.customer_id,o.customer_id)=customer and i.serial_number=serial)
  or exists(select 1 from private.stockflow_equipment_installations where tally_key=sale.company_id||':'||sale.source_id||':'||sale.line_key and order_id is null) then raise exception 'Instrument is already registered' using errcode='PT409';end if;
 insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by) values(sale.company_id,sale.customer_source_id,customer,p_actor) on conflict do nothing;
 if not exists(select 1 from private.stockflow_economic_customer_identities where company_id=sale.company_id and source_id=sale.customer_source_id and customer_id=customer) then raise exception 'Canonical customer identity conflicts with existing verification' using errcode='22023';end if;
 insert into private.stockflow_equipment_installations(customer_id,historical_sale_line_id,installed_on,tally_key,item_name,status,scheduled_date,serial_number,commissioning_notes,created_by_email,completed_by_email,completed_at)
 values(customer,sale.id,day,sale.company_id||':'||sale.source_id||':'||sale.line_key,coalesce(nullif(sale.evidence->>'label',''),sale.product_id),'completed',day,serial,reference,p_actor,p_actor,now()) returning id into entity;
 return entity;
end$$;
revoke all on function private.stockflow_register_historical_instrument(text,jsonb) from public,anon,authenticated,service_role;

create function private.stockflow_service_ticket_installation_order() returns trigger language plpgsql set search_path=pg_catalog,private as $$
begin
 if not exists(select 1 from private.stockflow_equipment_installations i where i.id=new.installation_id and i.order_id is not distinct from new.order_id) then raise exception 'Service ticket order must match its installation' using errcode='22023';end if;
 return new;
end$$;
revoke all on function private.stockflow_service_ticket_installation_order() from public,anon,authenticated,service_role;
create trigger stockflow_service_ticket_installation_order before insert or update of installation_id,order_id on private.stockflow_service_tickets for each row execute function private.stockflow_service_ticket_installation_order();

-- Fail closed if deployed function seams differ. Preserve the existing gateway's
-- roles, locks, immutable audit and original-request idempotency implementation.
do $upgrade$
declare definition text;anchor text;
begin
 definition:=replace(pg_get_functiondef('public.stockflow_economics_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
 anchor:='if p_action=''create_target'' then';
 if position(anchor in definition)=0 or position('''recover_economic_command''' in definition)=0 then raise exception 'Unexpected economics gateway registration seam';end if;
 definition:=replace(definition,'''create_target'', ''set_mapping''','''register_historical_instrument'',''create_target'', ''set_mapping''');
 definition:=replace(definition,'''create_target'',''set_mapping''','''register_historical_instrument'',''create_target'',''set_mapping''');
 definition:=replace(definition,anchor,'if p_action=''register_historical_instrument'' then entity:=private.stockflow_register_historical_instrument(actor,p_payload); elsif p_action=''create_target'' then');
 anchor:='o.customer_id=(p_payload->>''customerId'')::uuid';
 if position(anchor in definition)=0 then raise exception 'Unexpected installation/customer validation seam';end if;
 definition:=replace(definition,'join private.stockflow_orders o on o.id=i.order_id where i.id=(p_payload->>''installationId'')::uuid and '||anchor,'left join private.stockflow_orders o on o.id=i.order_id where i.id=(p_payload->>''installationId'')::uuid and coalesce(i.customer_id,o.customer_id)=(p_payload->>''customerId'')::uuid');
 execute definition;

 definition:=replace(pg_get_functiondef('private.stockflow_economic_workspace(text[])'::regprocedure),chr(13),'');
 anchor:='''customerName'',o.customer_name';
 if position(anchor in definition)=0 then raise exception 'Unexpected economics installation read seam';end if;
 definition:=replace(definition,anchor,'''customerName'',coalesce(o.customer_name,historical_customer.name)');
 definition:=replace(definition,'join private.stockflow_orders o on o.id=i.order_id where i.status=''completed''','left join private.stockflow_orders o on o.id=i.order_id left join private.stockflow_customers historical_customer on historical_customer.id=i.customer_id where i.status=''completed''');
 execute definition;

 definition:=replace(pg_get_functiondef('public.stockflow_service_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
 anchor:='''customerName'', o.customer_name, ''customerPhone'', o.customer_phone';
 if position(anchor in definition)=0 or position('''installedAt'', i.completed_at' in definition)=0 then raise exception 'Unexpected service asset read seam';end if;
 definition:=replace(definition,anchor,'''customerName'', coalesce(o.customer_name,historical_customer.name), ''customerPhone'', coalesce(o.customer_phone,historical_customer.phone)');
 definition:=replace(definition,'''orderNumber'', o.order_number','''orderNumber'', coalesce(o.order_number,''Tally ''||(historical_voucher.evidence->>''sourceReference''))');
 definition:=replace(definition,'''installedAt'', i.completed_at','''installedAt'', coalesce(i.installed_on::text,i.completed_at::text)');
 definition:=replace(definition,'join private.stockflow_orders o on o.id=i.order_id where i.status=''completed''','left join private.stockflow_orders o on o.id=i.order_id left join private.stockflow_customers historical_customer on historical_customer.id=i.customer_id left join private.stockflow_economic_source_lines historical_line on historical_line.id=i.historical_sale_line_id left join private.stockflow_economic_source_vouchers historical_voucher on historical_voucher.id=historical_line.voucher_id where i.status=''completed''');
 execute definition;
end$upgrade$;
commit;
