begin;
create function private.stockflow_import_economic_vouchers() returns trigger language plpgsql security definer
set search_path=pg_catalog,private,public,extensions as $$
declare doc jsonb; entry jsonb; line jsonb; vid uuid; previous jsonb; rejected integer:=0; from_date date; to_date date; latest_catalog private.stockflow_economic_item_catalogs%rowtype; catalog_seen_at timestamptz;
begin
 if new.id<>'suprabha' then return new;end if;
 if nullif(new.payload->>'economicSyncError','') is not null then
  insert into private.stockflow_economic_import_exceptions(company_id,reason,evidence)
  select new.payload->'economicEvidence'->>'companyId',new.payload->>'economicSyncError',jsonb_build_object('source','connector_sync')
  where not exists(select 1 from private.stockflow_economic_import_exceptions where reason=new.payload->>'economicSyncError' and recorded_at>now()-interval '1 hour');
 end if;
 new.payload:=new.payload-'economicSyncError';
 if new.payload->'economicEvidence' is null or new.payload->'economicEvidence'='null'::jsonb then new.payload:=new.payload-'economicEvidence';return new;end if;
 perform pg_advisory_xact_lock(hashtextextended('instrument-economics-v1',0));
 doc:=new.payload->'economicEvidence';
 if doc->>'schemaVersion' is distinct from '1' or jsonb_typeof(doc->'vouchers') is distinct from 'array' or jsonb_array_length(doc->'vouchers')>2000 or nullif(btrim(doc->>'companyId'),'') is null then
  raise exception 'Invalid or oversized economic evidence envelope' using errcode='22023';
 end if;
 if doc->'itemCatalog' is not null then
  begin
   perform private.stockflow_economic_validate_item_catalog(doc->'itemCatalog');
   catalog_seen_at:=null;catalog_seen_at:=(doc->>'sourceVersion')::timestamptz;
   if catalog_seen_at is null then raise exception 'Item-group catalog needs a source observation version';end if;
   select * into latest_catalog from private.stockflow_economic_item_catalogs c where c.company_id=doc->>'companyId' order by c.observed_at desc,c.id desc limit 1;
   if latest_catalog.id is not null and catalog_seen_at<latest_catalog.observed_at then raise exception 'Stale item-group catalog observation';end if;
   select content into previous from private.stockflow_economic_item_catalogs where company_id=doc->>'companyId' and source_version=doc->>'sourceVersion';
   if found and previous<>doc->'itemCatalog' then raise exception 'Item-group catalog version reused with different content';end if;
   if not found and (latest_catalog.content is distinct from doc->'itemCatalog' or not private.stockflow_economic_item_catalog_current(doc->>'companyId')) then
    insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content) values(doc->>'companyId',doc->>'sourceVersion',catalog_seen_at,doc->'itemCatalog');
   end if;
  exception when data_exception or check_violation or not_null_violation or unique_violation or raise_exception then
   insert into private.stockflow_economic_import_exceptions(company_id,reason,evidence,recorded_at) values(doc->>'companyId',sqlerrm,jsonb_build_object('kind','item_group_catalog','sourceVersion',doc->>'sourceVersion','observedAt',catalog_seen_at),clock_timestamp());
  end;
 end if;
 for entry in select value from jsonb_array_elements(doc->'vouchers') loop
  begin
   if nullif(btrim(entry->>'sourceId'),'') is null or jsonb_typeof(entry->'lines') is distinct from 'array' or jsonb_array_length(entry->'lines')>500
     or entry->>'amountStatus' is distinct from 'verified' then raise exception 'Incomplete voucher identity, lines or net economic values';end if;
   if entry->>'kind'='non_economic' then
    if jsonb_array_length(entry->'lines')<>0 or entry->>'classificationPolicy' is distinct from 'explicit_non_economic_v1'
      or length(btrim(coalesce(entry->>'voucherType','')))<1 or entry->>'voucherType' in ('Sales','GST SALE','Purchase','Credit Note') or length(btrim(coalesce(entry->>'exclusionReason','')))<3 then
     raise exception 'Non-economic document needs explicit classification evidence and no economic lines';end if;
    if exists(select 1 from private.stockflow_economic_source_vouchers where company_id=doc->>'companyId' and source_id=entry->>'sourceId' and kind<>'non_economic') then
     raise exception 'A previously economic voucher cannot be silently reclassified as non-economic';end if;
   elsif exists(select 1 from private.stockflow_economic_source_vouchers where company_id=doc->>'companyId' and source_id=entry->>'sourceId' and kind='non_economic') then
    -- A quotation can become an actual invoice in Tally while retaining its GUID.
    -- Admit only a newer native economic revision, never a config-only role change.
    if entry->>'classificationPolicy' is distinct from 'native_economic_v1'
      or not coalesce(((entry->>'kind'='sale' and entry->>'voucherType' in ('Sales','GST SALE')) or (entry->>'kind'='purchase' and entry->>'voucherType'='Purchase') or (entry->>'kind'='return' and entry->>'voucherType'='Credit Note')),false)
      or (entry->>'revision')::bigint<=(select max(source_revision) from private.stockflow_economic_source_vouchers where company_id=doc->>'companyId' and source_id=entry->>'sourceId' and kind='non_economic') then
     raise exception 'Excluded document promotion requires a newer native Tally economic voucher revision';end if;
   end if;
   select evidence into previous from private.stockflow_economic_source_vouchers where company_id=doc->>'companyId' and source_id=entry->>'sourceId' and source_revision=(entry->>'revision')::bigint;
   if found then
    -- Historical display names may change with master renames without a voucher
    -- revision. Canonical IDs and every economic component must still match.
    if (previous-'lines')<>(entry-'lines') or
      coalesce((select jsonb_agg(value-'label' order by ordinality) from jsonb_array_elements(previous->'lines') with ordinality),'[]'::jsonb)<>
      coalesce((select jsonb_agg(value-'label' order by ordinality) from jsonb_array_elements(entry->'lines') with ordinality),'[]'::jsonb) then raise exception 'Source revision identity reused with different content';end if;
    continue;
   end if;
   insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,site_id,kind,cancelled,evidence)
   values(doc->>'companyId',entry->>'sourceId',(entry->>'revision')::bigint,(entry->>'date')::date,nullif(entry->>'customerSourceId',''),nullif(entry->>'siteId',''),entry->>'kind',coalesce((entry->>'cancelled')::boolean,false),entry) returning id into vid;
   for line in select value from jsonb_array_elements(entry->'lines') loop
    if line->>'netSalesPaise' !~ '^-?[0-9]+$' or nullif(btrim(line->>'productId'),'') is null or nullif(btrim(line->>'lineKey'),'') is null then raise exception 'Invalid canonical product or net sales';end if;
    if entry->>'kind' in ('sale','purchase') and ((line->>'quantity')::numeric<0 or (line->>'netSalesPaise')::bigint<0) then raise exception 'Sales and purchases require normalized positive values';end if;
    if entry->>'kind' in ('credit','return') and ((line->>'quantity')::numeric>0 or (line->>'netSalesPaise')::bigint>0) then raise exception 'Credits and returns require normalized signed negative values';end if;
    if entry->>'kind'='credit' and (line->>'quantity')::numeric<>0 then raise exception 'Value credit cannot invent stock movement';end if;
    insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,gst_paise,discount_paise,batch_id,foc_reason,original_company_id,original_voucher_id,original_line_key,evidence)
    values(vid,line->>'lineKey',line->>'productId',(line->>'quantity')::numeric,line->>'unit',(line->>'netSalesPaise')::bigint,coalesce((line->>'gstPaise')::bigint,0),coalesce((line->>'discountPaise')::bigint,0),nullif(line->>'batchId',''),nullif(line->>'focReason',''),nullif(line->>'originalCompanyId',''),nullif(line->>'originalVoucherId',''),nullif(line->>'originalLineKey',''),line);
   end loop;
  exception when data_exception or check_violation or not_null_violation or unique_violation or raise_exception then
   rejected:=rejected+1;
   insert into private.stockflow_economic_import_exceptions(company_id,source_id,reason,evidence) values(doc->>'companyId',entry->>'sourceId',sqlerrm,entry);
  end;
 end loop;
 if coalesce((doc->>'completeWindow')::boolean,false) and rejected=0 then
  from_date:=(doc->>'windowFrom')::date;to_date:=(doc->>'windowTo')::date;
  if nullif(doc->>'sourceVersion','') is null then raise exception 'Complete evidence needs a source version';end if;
  -- An omitted voucher is never silently deleted. Complete-window uploads must
  -- explicitly include cancellation revisions for previously known vouchers.
  if exists(select 1 from private.stockflow_economic_source_vouchers v where v.company_id=doc->>'companyId' and v.kind<>'purchase' and v.business_date>=from_date and v.business_date<to_date
    and not exists(select 1 from jsonb_array_elements(doc->'vouchers') e where e->>'sourceId'=v.source_id)) then
   insert into private.stockflow_economic_import_exceptions(company_id,reason,evidence) values(doc->>'companyId','Complete window omitted known vouchers; supply cancellation revisions',doc-'vouchers');
  else
   insert into private.stockflow_economic_source_coverage(company_id,window_from,window_to,source_version) values(doc->>'companyId',from_date,to_date,doc->>'sourceVersion') on conflict(company_id,source_version) do nothing;
  end if;
 end if;
 if exists(select 1 from private.stockflow_economic_source_vouchers where imported_at=now()) or doc->'itemCatalog' is not null then perform private.stockflow_rebuild_instrument_economics('tally-sync');end if;
 new.payload:=new.payload-'economicEvidence';return new;
end$$;
revoke all on function private.stockflow_import_economic_vouchers() from public,anon,authenticated;
create trigger stockflow_import_economic_vouchers before insert or update of payload on public.stockflow_snapshots for each row execute function private.stockflow_import_economic_vouchers();

create function private.stockflow_rebuild_instrument_economics(p_actor text) returns uuid language plpgsql
set search_path=pg_catalog,private,public,extensions as $$
declare run uuid; row record; candidate record; shares jsonb; ids uuid[]; groups uuid[]; group_id uuid; allocations integer; cost bigint; original record; error_reason text; mapping_effect text; result_status text; returned_qty numeric; returned_cost numeric; original_cost numeric; candidate_count integer; excluded_count integer; billing private.stockflow_economic_instrument_billings%rowtype; billing_sale record; billing_target uuid; recovery_origin date;
begin
 perform pg_advisory_xact_lock(hashtextextended('instrument-economics-v1',0));
 if (select count(*) from private.stockflow_economic_source_lines)>10000 then raise exception 'Economic rebuild exceeds V1 limit; narrow source window' using errcode='54000';end if;
 insert into private.stockflow_economic_runs(actor) values(p_actor) returning id into run;
 -- Reverse prior GP postings once, retaining their original effective dates.
 insert into private.stockflow_economic_events(target_id,kind,amount_paise,effective_date,reverses_id,request_id,actor,reason)
 select e.target_id,'reversal',-e.amount_paise,e.effective_date,e.id,run::text||':reverse:'||e.id,p_actor,'Economic generation restatement'
 from private.stockflow_economic_events e where (e.kind='gp' or (e.kind='contribution' and e.source_result_id is not null)) and not exists(select 1 from private.stockflow_economic_events r where r.reverses_id=e.id);
 for row in
  select l.id,l.voucher_id,l.line_key,l.product_id,l.quantity,l.unit,l.net_sales_paise,l.batch_id,
   coalesce(review.foc_reason,l.foc_reason) foc_reason,coalesce(ov.company_id,l.original_company_id) original_company_id,
   coalesce(ov.source_id,l.original_voucher_id) original_voucher_id,coalesce(ol.line_key,l.original_line_key) original_line_key,
   v.company_id,v.customer_source_id,v.site_id,v.business_date,v.kind,v.source_id
  from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
  left join lateral(select * from private.stockflow_economic_line_reviews d where d.source_line_id=l.id order by recorded_at desc,id desc limit 1) review on true
  left join private.stockflow_economic_source_lines ol on ol.id=review.original_sale_line_id left join private.stockflow_economic_source_vouchers ov on ov.id=ol.voucher_id
  where v.kind<>'purchase' and not v.cancelled and not exists(select 1 from private.stockflow_economic_source_vouchers newer where newer.company_id=v.company_id and newer.source_id=v.source_id and newer.source_revision>v.source_revision)
  order by v.business_date,case when v.kind='sale' then 0 else 1 end,l.id
 loop
  recovery_origin:=row.business_date;shares:=null;ids:=array[]::uuid[];groups:=array[]::uuid[];cost:=null;error_reason:=null;result_status:='unattributed';candidate_count:=0;excluded_count:=0;
  select * into billing from private.stockflow_economic_instrument_billings b where b.company_id=row.company_id and
   ((row.kind='sale' and b.source_id=row.source_id and b.line_key=row.line_key)
    or (row.kind in ('return','credit') and coalesce(row.original_company_id,row.company_id)=b.company_id and b.source_id=row.original_voucher_id and b.line_key=row.original_line_key));
  if found then
   select l.*,v.business_date,v.company_id,v.customer_source_id into billing_sale from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
    where v.company_id=billing.company_id and v.source_id=billing.source_id and l.line_key=billing.line_key and v.kind='sale' and not v.cancelled and not exists(select 1 from private.stockflow_economic_source_vouchers n where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision);
   if not found then error_reason:='instrument_billing_original_sale_unavailable';
   else
    select l.* into original from private.stockflow_economic_source_lines l where l.id=billing.source_line_id;
    if billing_sale.product_id<>original.product_id or billing_sale.unit<>original.unit or billing_sale.quantity<>1 or billing_sale.net_sales_paise<0 or billing_sale.business_date>private.stockflow_economic_business_date() or billing_sale.business_date<(select pv.business_date from private.stockflow_economic_acquisition_links a join private.stockflow_economic_source_lines pl on pl.id=a.purchase_line_id join private.stockflow_economic_source_vouchers pv on pv.id=pl.voucher_id where a.target_id=billing.target_id) or row.customer_source_id is distinct from billing_sale.customer_source_id or row.customer_source_id is distinct from (select customer_source_id from private.stockflow_economic_targets where id=billing.target_id) or row.product_id<>original.product_id or row.unit<>original.unit or row.business_date<billing_sale.business_date then error_reason:='instrument_billing_identity_or_date_changed';end if;
   end if;
   if error_reason is null and row.kind in ('return','credit') then
    select coalesce(sum(abs(r.quantity)) filter(where v.kind='return'),0),coalesce(sum(-r.revenue_paise),0) into returned_qty,returned_cost
     from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
     left join lateral(select d.original_sale_line_id from private.stockflow_economic_line_reviews d where d.source_line_id=l.id order by recorded_at desc,id desc limit 1) review on true
     left join private.stockflow_economic_source_lines ol on ol.id=review.original_sale_line_id left join private.stockflow_economic_source_vouchers ov on ov.id=ol.voucher_id
     where r.run_id=run and r.status='instrument_billing' and v.kind in ('return','credit') and v.company_id=billing.company_id and coalesce(ov.source_id,l.original_voucher_id)=billing.source_id and coalesce(ol.line_key,l.original_line_key)=billing.line_key;
    if returned_qty+(case when row.kind='return' then abs(row.quantity) else 0 end)>1 or returned_cost-row.net_sales_paise>billing_sale.net_sales_paise then error_reason:='instrument_billing_adjustments_exceed_original';end if;
   end if;
   if error_reason is not null then
    insert into private.stockflow_economic_results(run_id,source_line_id,status,reason,share_bps,quantity,revenue_paise) values(run,row.id,'unattributed',error_reason,10000,row.quantity,row.net_sales_paise);
   else
    select gm.group_id into billing_target from private.stockflow_economic_group_members gm join private.stockflow_economic_targets g on g.id=gm.group_id where gm.placement_id=billing.target_id and g.approval='approved' and gm.effective_from<=private.stockflow_economic_business_date() and g.effective_from<=private.stockflow_economic_business_date() order by gm.effective_from desc,g.id limit 1;
    insert into private.stockflow_economic_results(run_id,source_line_id,target_id,status,reason,share_bps,quantity,revenue_paise) values(run,row.id,coalesce(billing_target,billing.target_id),'instrument_billing','Verified upfront instrument billing; excludes GST; billed recovery, not cash receipt',10000,row.quantity,row.net_sales_paise);
   end if;
   continue;
  end if;
  if row.kind in ('return','credit') then
   select l.*,v.business_date,v.company_id,v.customer_source_id into original from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
   where v.company_id=coalesce(row.original_company_id,row.company_id) and v.source_id=row.original_voucher_id and l.line_key=row.original_line_key and v.kind='sale' and not v.cancelled
    and not exists(select 1 from private.stockflow_economic_source_vouchers n where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision) limit 1;
   if not found or original.company_id<>row.company_id or original.customer_source_id is distinct from row.customer_source_id or original.product_id<>row.product_id or original.unit<>row.unit or original.business_date>row.business_date then error_reason:='unlinked_or_invalid_adjustment';
   else
    recovery_origin:=original.business_date;
    select jsonb_agg(jsonb_build_object('targetId',r.target_id,'basisPoints',r.share_bps)) into shares from private.stockflow_economic_results r where r.run_id=run and r.source_line_id=original.id and r.target_id is not null;
    if shares is null then error_reason:='original_attribution_unavailable';
    elsif row.kind='credit' then cost:=0;
    else
     select coalesce(sum(abs(r.quantity)),0),coalesce(sum(r.cost_paise),0) into returned_qty,returned_cost
      from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
      left join lateral(select d.original_sale_line_id from private.stockflow_economic_line_reviews d where d.source_line_id=l.id order by recorded_at desc,id desc limit 1) review on true
      left join private.stockflow_economic_source_lines ol on ol.id=review.original_sale_line_id left join private.stockflow_economic_source_vouchers ov on ov.id=ol.voucher_id
      where r.run_id=run and r.target_id is not null and v.kind='return' and v.company_id=row.company_id and coalesce(ov.source_id,l.original_voucher_id)=row.original_voucher_id and coalesce(ol.line_key,l.original_line_key)=row.original_line_key;
     if original.quantity<=0 or returned_qty+abs(row.quantity)>original.quantity then error_reason:='cumulative_return_quantity_exceeds_original';
     else
      select case when count(*) filter(where cost_paise is null)=0 then sum(cost_paise) else null end into original_cost from private.stockflow_economic_results where run_id=run and source_line_id=original.id;
      cost:=case when original_cost is null then null else (-round(original_cost*(returned_qty+abs(row.quantity))/original.quantity)-returned_cost)::bigint end;
     end if;
    end if;
   end if;
  else
   for candidate in select t.* from private.stockflow_economic_targets t where t.kind='placement' and t.approval='approved' and t.company_id=row.company_id and t.customer_source_id=row.customer_source_id
    and (t.site_id=row.site_id or (row.site_id is null and 1=(select count(distinct p.site_id) from private.stockflow_economic_targets p where p.company_id=row.company_id and p.customer_source_id=row.customer_source_id and p.approval='approved' and p.effective_from<=row.business_date and (p.effective_to is null or p.effective_to>row.business_date))))
    and t.effective_from<=row.business_date and (t.effective_to is null or t.effective_to>row.business_date)
   loop
    candidate_count:=candidate_count+1;mapping_effect:=null;
    mapping_effect:=private.stockflow_economic_mapping_effect(candidate.company_id,candidate.model_id,candidate.id,row.product_id,row.business_date);
    if mapping_effect='exclude' then excluded_count:=excluded_count+1;end if;
    if mapping_effect='include' then
     ids:=array_append(ids,candidate.id);
     select gm.group_id into group_id from private.stockflow_economic_group_members gm join private.stockflow_economic_targets g on g.id=gm.group_id
      where gm.placement_id=candidate.id and gm.effective_from<=row.business_date and (gm.effective_to is null or gm.effective_to>row.business_date)
       and g.approval='approved' and g.effective_from<=row.business_date and (g.effective_to is null or g.effective_to>row.business_date) limit 1;
     groups:=array_append(groups,group_id);
    end if;
   end loop;
   if cardinality(ids)=1 then shares:=jsonb_build_array(jsonb_build_object('targetId',coalesce(groups[1],ids[1]),'basisPoints',10000));
   elsif cardinality(ids)>1 and array_position(groups,null) is null and (select count(distinct g) from unnest(groups) g)=1 then
    shares:=jsonb_build_array(jsonb_build_object('targetId',groups[1],'basisPoints',10000));
   elsif cardinality(ids)>1 then
    select count(*) into allocations from private.stockflow_economic_allocations a where a.company_id=row.company_id and a.customer_source_id=row.customer_source_id and a.site_id=coalesce(row.site_id,(select site_id from private.stockflow_economic_targets where id=ids[1])) and a.product_id=row.product_id and a.effective_from<=row.business_date and (a.effective_to is null or a.effective_to>row.business_date);
    if allocations=1 then
     select a.shares into shares from private.stockflow_economic_allocations a where a.company_id=row.company_id and a.customer_source_id=row.customer_source_id and a.site_id=coalesce(row.site_id,(select site_id from private.stockflow_economic_targets where id=ids[1])) and a.product_id=row.product_id and a.effective_from<=row.business_date and (a.effective_to is null or a.effective_to>row.business_date);
     if jsonb_array_length(shares)<>cardinality(ids) or exists(select 1 from jsonb_array_elements(shares) s where not ((s->>'targetId')::uuid=any(ids))) then shares:=null;end if;
    end if;
   end if;
   if shares is null then error_reason:=case when candidate_count>0 and excluded_count=candidate_count then 'explicit_product_exclusion' when cardinality(ids)=0 then 'no_verified_compatible_placement' else 'ambiguous_placements' end;if error_reason='explicit_product_exclusion' then result_status:='excluded';end if;end if;
   select case when coalesce(sum(c.quantity),0)=row.quantity and row.quantity>0 then sum(c.cost_paise)::bigint else null end into cost
   from private.stockflow_economic_cost_links c join private.stockflow_economic_source_lines pl on pl.id=c.purchase_line_id join private.stockflow_economic_source_vouchers pv on pv.id=pl.voucher_id
   where c.sale_line_id=row.id and c.verification_id=(select id from private.stockflow_economic_cost_verifications cv where cv.sale_line_id=row.id order by cv.revision desc limit 1) and not pv.cancelled and not exists(select 1 from private.stockflow_economic_source_vouchers nv where nv.company_id=pv.company_id and nv.source_id=pv.source_id and nv.source_revision>pv.source_revision);
  end if;
  if error_reason is not null or shares is null then
   insert into private.stockflow_economic_results(run_id,source_line_id,status,reason,share_bps,quantity,revenue_paise) values(run,row.id,result_status,coalesce(error_reason,'ambiguous_placements'),10000,row.quantity,row.net_sales_paise);
   continue;
  end if;
  -- Largest-remainder allocation conserves signed paise independently for revenue and cost.
  with weights as(select (s->>'targetId')::uuid target_id,(s->>'basisPoints')::integer bps from jsonb_array_elements(shares) s),
  parts as(select *,floor(abs(row.net_sales_paise::numeric)*bps/10000) rp,mod(abs(row.net_sales_paise::numeric)*bps,10000) rr,
   floor(abs(cost::numeric)*bps/10000) cp,mod(abs(cost::numeric)*bps,10000) cr,
   floor(abs(row.quantity)*1000000*bps/10000) qp,mod(abs(row.quantity)*1000000*bps,10000) qr from weights),
  ranked as(select *,row_number() over(order by rr desc,target_id) rn,row_number() over(order by cr desc,target_id) cn,
   row_number() over(order by qr desc,target_id) qn,abs(row.quantity)*1000000-sum(qp) over() remain_q,
   abs(row.net_sales_paise::numeric)-sum(rp) over() remain_r,abs(cost::numeric)-sum(cp) over() remain_c from parts),
  amounts as(select *,((rp+case when rn<=remain_r then 1 else 0 end)*sign(row.net_sales_paise))::bigint revenue,
   case when cost is null then null else ((cp+case when cn<=remain_c then 1 else 0 end)*sign(cost))::bigint end purchase_cost from ranked)
  insert into private.stockflow_economic_results(run_id,source_line_id,target_id,status,reason,share_bps,quantity,revenue_paise,cost_paise,gp_paise,recovery_origin_date)
  select run,row.id,target_id,case when purchase_cost is null then 'cost_unavailable' when row.net_sales_paise=0 and row.quantity>0 and coalesce(row.foc_reason,'') not in ('installation','training','quality_control','replacement','commercial_support','other') then 'foc_unclassified' else 'verified' end,
   case when purchase_cost is null then 'Historical purchase linkage unavailable' when row.net_sales_paise=0 and row.quantity>0 then 'FOC: '||case when row.foc_reason in ('installation','training','quality_control','replacement','commercial_support','other') then row.foc_reason else 'UNKNOWN' end else 'Verified attribution and purchase evidence' end,
   bps,(qp+case when qn<=remain_q then 1 else 0 end)*sign(row.quantity)/1000000,revenue,purchase_cost,revenue-purchase_cost,recovery_origin from amounts;
 end loop;
 insert into private.stockflow_economic_events(target_id,kind,amount_paise,effective_date,source_result_id,request_id,actor,reason)
 select r.target_id,'gp',r.gp_paise,v.business_date,r.id,run::text||':gp:'||r.id,p_actor,r.reason from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and r.gp_paise is not null;
 insert into private.stockflow_economic_events(target_id,kind,amount_paise,effective_date,source_result_id,request_id,actor,reason)
 select r.target_id,'contribution',r.revenue_paise,v.business_date,r.id,run::text||':instrument-billing:'||r.id,p_actor,r.reason from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and r.status='instrument_billing';
 update private.stockflow_economic_runs set active=false where active;
 update private.stockflow_economic_runs set active=true where id=run;
 return run;
end$$;
revoke all on function private.stockflow_rebuild_instrument_economics(text) from public,anon,authenticated;
commit;
