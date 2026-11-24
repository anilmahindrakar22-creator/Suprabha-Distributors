begin;

-- Installed replay/production bodies, normalized only for CR.
do $guard$
declare actual text; expected record;
begin
 for expected in select * from (values
  ('private.stockflow_economic_workspace_read(text[],boolean)','a905a56040342ffa75d92713ba2d961d'),
  ('private.stockflow_economic_workspace_detail(text[])','a0f40fc9c3de4378643a259fe51439f3'),
  ('private.stockflow_economic_result_owned(uuid,uuid)','089ed11cc35532fab8a31e6a50ea26db')
 ) v(signature,body_md5) loop
  select md5(replace(p.prosrc,chr(13),'')) into actual from pg_proc p where p.oid=expected.signature::regprocedure;
  if actual is distinct from expected.body_md5 then
   raise exception 'Unexpected % body (md5 %)',expected.signature,actual;
  end if;
 end loop;
 if to_regprocedure('private.stockflow_economic_workspace_read_before_speed(text[],boolean)') is not null
 or to_regprocedure('private.stockflow_economic_workspace_detail_before_speed(text[])') is not null then
  raise exception 'Economics before_speed functions already exist';
 end if;
 if exists(select 1 from pg_attribute where attrelid='private.stockflow_economic_targets'::regclass
  and not attisdropped and attname in ('billing_current_now','acquisition_current_now','billed_recovery_now')) then
  raise exception 'Economics speed column name collision';
 end if;
end$guard$;

create function pg_temp.stockflow_economics_speed_patch(definition text,old_text text,new_text text,expected_count integer,label text)
returns text language plpgsql as $$
declare occurrences integer;
begin
 occurrences:=(length(definition)-length(replace(definition,old_text,'')))/length(old_text);
 if occurrences<>expected_count then
  raise exception 'Unexpected % seam (% matches, expected %)',label,occurrences,expected_count;
 end if;
 return replace(definition,old_text,new_text);
end$$;

do $patch$
declare definition text; spec record;
begin
 for spec in select * from (values
  ('private.stockflow_economic_workspace_read(text[],boolean)','stockflow_economic_workspace_read_before_speed'),
  ('private.stockflow_economic_workspace_detail(text[])','stockflow_economic_workspace_detail_before_speed')
 ) v(signature,old_name) loop
  definition:=replace(pg_get_functiondef(spec.signature::regprocedure),chr(13),'');
  definition:=pg_temp.stockflow_economics_speed_patch(definition,
   $old$with facts as($old$,
   $new$with owned as(
select r.id result_id,r.target_id owner_id from private.stockflow_economic_results r
 join private.stockflow_economic_source_lines l on l.id=r.source_line_id
 join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
 where r.run_id=run and r.status<>'instrument_billing' and r.target_id is not null
union
select r.id,gm.group_id from private.stockflow_economic_results r
 join private.stockflow_economic_source_lines l on l.id=r.source_line_id
 join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
 join private.stockflow_economic_group_members gm on gm.placement_id=r.target_id
 join private.stockflow_economic_targets g on g.id=gm.group_id and g.approval='approved'
 where r.run_id=run and r.status<>'instrument_billing' and r.target_id is not null
 and gm.effective_from<=private.stockflow_economic_business_date()
 and r.recovery_origin_date<gm.effective_from and v.business_date>=gm.effective_from
), owned_totals as(
select o.owner_id,
 sum(r.revenue_paise) filter(where v.business_date>=period_from and v.business_date<period_to) revenue,
 sum(r.gp_paise) filter(where v.business_date>=period_from and v.business_date<period_to) gp,
 count(*) filter(where r.cost_paise is null) missing_cost,
 count(*) filter(where v.business_date>=period_from and v.business_date<period_to) lines
 from owned o join private.stockflow_economic_results r on r.id=o.result_id
 join private.stockflow_economic_source_lines l on l.id=r.source_line_id
 join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
 group by o.owner_id
), window_events as(
select e.id,e.target_id,e.amount_paise,coalesce(e.source_result_id,(select parent.source_result_id from private.stockflow_economic_events parent where parent.id=e.reverses_id)) src
 from private.stockflow_economic_events e where (e.kind='gp' or (e.kind='reversal' and exists(select 1 from private.stockflow_economic_events original_event where original_event.id=e.reverses_id and original_event.kind='gp'))) and e.effective_date>=period_to-make_interval(months=>policy.forecast_window_months) and e.effective_date<period_to
), event_owners as(
select we.id event_id,we.target_id owner_id,we.amount_paise from window_events we where we.target_id is not null
union
select we.id,r.target_id,we.amount_paise from window_events we
 join private.stockflow_economic_results r on r.id=we.src
 join private.stockflow_economic_source_lines l on l.id=r.source_line_id
 join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.target_id is not null
union
select we.id,gm.group_id,we.amount_paise from window_events we
 join private.stockflow_economic_results r on r.id=we.src
 join private.stockflow_economic_source_lines l on l.id=r.source_line_id
 join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
 join private.stockflow_economic_group_members gm on gm.placement_id=r.target_id
 join private.stockflow_economic_targets g on g.id=gm.group_id and g.approval='approved'
 where r.target_id is not null and gm.effective_from<=private.stockflow_economic_business_date()
 and r.recovery_origin_date<gm.effective_from and v.business_date>=gm.effective_from
), trailing_totals as(
select owner_id,sum(amount_paise)::numeric/policy.forecast_window_months trailing_gp from event_owners group by owner_id
), facts as materialized($new$,1,'P1/P9 ownership and trailing sets');
  definition:=pg_temp.stockflow_economics_speed_patch(definition,
   $old$   coalesce((select sum(r.revenue_paise) from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and r.status<>'instrument_billing' and r.target_id is not null and private.stockflow_economic_result_owned(r.id,t.id) and v.business_date>=period_from and v.business_date<period_to),0) revenue,$old$,
   $new$   coalesce(ot.revenue,0) revenue,$new$,1,'P2 revenue');
  definition:=pg_temp.stockflow_economics_speed_patch(definition,
   $old$   coalesce((select sum(r.gp_paise) from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and r.status<>'instrument_billing' and r.target_id is not null and private.stockflow_economic_result_owned(r.id,t.id) and v.business_date>=period_from and v.business_date<period_to),0) gp,$old$,
   $new$   coalesce(ot.gp,0) gp,$new$,1,'P2 gp');
  definition:=pg_temp.stockflow_economics_speed_patch(definition,
   $old$   (select count(*) from private.stockflow_economic_results r where r.run_id=run and r.status<>'instrument_billing' and r.target_id is not null and private.stockflow_economic_result_owned(r.id,t.id) and r.cost_paise is null) missing_cost,$old$,
   $new$   coalesce(ot.missing_cost,0) missing_cost,$new$,1,'P2 missing_cost');
  definition:=pg_temp.stockflow_economics_speed_patch(definition,
   $old$   (select count(*) from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and r.status<>'instrument_billing' and r.target_id is not null and private.stockflow_economic_result_owned(r.id,t.id) and v.business_date>=period_from and v.business_date<period_to) lines$old$,
   $new$   coalesce(ot.lines,0) lines$new$,1,'P2 lines');
  if strpos(definition,'stockflow_economic_result_owned(r.id,t.id)')>0 then raise exception 'P2 result ownership call remains';end if;
  definition:=pg_temp.stockflow_economics_speed_patch(definition,
   $old$from private.stockflow_economic_targets t join private.stockflow_customers c on c.id=t.customer_id$old$,
   $new$from private.stockflow_economic_targets t join private.stockflow_customers c on c.id=t.customer_id left join owned_totals ot on ot.owner_id=t.id$new$,1,'P3 facts join');
  definition:=pg_temp.stockflow_economics_speed_patch(definition,
   $old$), enriched as($old$,
   $new$), enriched as materialized($new$,1,'P4 enriched');
  definition:=pg_temp.stockflow_economics_speed_patch(definition,
   $old$(select min(private.stockflow_economic_sales_from(p.id)) from private.stockflow_economic_group_members gm join private.stockflow_economic_targets p on p.id=gm.placement_id where gm.group_id=f.id)$old$,
   $new$(select min(p.sales_from) from private.stockflow_economic_group_members gm join facts p on p.id=gm.placement_id where gm.group_id=f.id)$new$,1,'P5 sales from facts');
  definition:=pg_temp.stockflow_economics_speed_patch(definition,
   $old$private.stockflow_economic_billing_current(id)$old$,
   $new$billing_current_now$new$,3,'P6 billing_current');
  definition:=pg_temp.stockflow_economics_speed_patch(definition,
   $old$private.stockflow_economic_acquisition_current(id)$old$,
   $new$acquisition_current_now$new$,3,'P6 acquisition_current');
  definition:=pg_temp.stockflow_economics_speed_patch(definition,
   $old$private.stockflow_economic_billed_recovery(id)$old$,
   $new$billed_recovery_now$new$,2,'P6 billed_recovery');
  definition:=pg_temp.stockflow_economics_speed_patch(definition,
   $old$reviewed as(select enriched.*,$old$,
   $new$reviewed as materialized(select enriched.*,private.stockflow_economic_billing_current(id) billing_current_now,private.stockflow_economic_acquisition_current(id) acquisition_current_now,private.stockflow_economic_billed_recovery(id) billed_recovery_now,$new$,1,'P7 reviewed');
  definition:=pg_temp.stockflow_economics_speed_patch(definition,
   $old$private.stockflow_economic_result_owned(r.id,enriched.id)$old$,
   $new$r.id in(select o.result_id from owned o where o.owner_id=enriched.id)$new$,1,'P8 item breakdown');
  definition:=pg_temp.stockflow_economics_speed_patch(definition,
   $old$   coalesce((select sum(e.amount_paise)::numeric/policy.forecast_window_months from private.stockflow_economic_events e where (e.target_id=f.id or private.stockflow_economic_result_owned(coalesce(e.source_result_id,(select parent.source_result_id from private.stockflow_economic_events parent where parent.id=e.reverses_id)),f.id)) and (e.kind='gp' or (e.kind='reversal' and exists(select 1 from private.stockflow_economic_events original_event where original_event.id=e.reverses_id and original_event.kind='gp'))) and e.effective_date>=period_to-make_interval(months=>policy.forecast_window_months) and e.effective_date<period_to),0) trailing_gp,$old$,
   $new$   coalesce(tt.trailing_gp,0) trailing_gp,$new$,1,'P9 trailing gp');
  definition:=pg_temp.stockflow_economics_speed_patch(definition,
   $old$from facts f left join lateral($old$,
   $new$from facts f left join trailing_totals tt on tt.owner_id=f.id left join lateral($new$,1,'P9 trailing join');
  definition:=pg_temp.stockflow_economics_speed_patch(definition,
   $old$) order by name),'[]'::jsonb)) into result from projected enriched;$old$,
   $new$) order by name,id),'[]'::jsonb)) into result from projected enriched;$new$,1,'P10 deterministic order');
  if strpos(definition,'stockflow_economic_result_owned')>0 then raise exception 'Result ownership call remains';end if;
  execute format('alter function %s rename to %I',spec.signature,spec.old_name);
  execute definition;
  execute format('revoke all on function %s from public, anon, authenticated, service_role',spec.signature);
 end loop;
end$patch$;

commit;
