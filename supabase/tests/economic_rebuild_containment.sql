begin;
create function pg_temp.containment_upload(revision integer) returns void language plpgsql as $$
begin
 perform public.stockflow_sync_snapshot(jsonb_build_object('company','SUPRABHA DISTRIBUTORS','fetchedAtIso',clock_timestamp(),
  'rows','[]'::jsonb,'groups','[]'::jsonb,'catalog',jsonb_build_object('testRevision',revision),
  'economicEvidence',jsonb_build_object('schemaVersion',1,'companyId','containment-test','sourceVersion',clock_timestamp(),
   'vouchers',jsonb_build_array(jsonb_build_object('sourceId','containment-sale','revision',revision,'date','2026-07-10',
    'kind','sale','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','containment-product',
     'quantity',1,'unit','Nos','netSalesPaise',100,'gstPaise',18)))))));
end$$;

do $test$
declare original text; anchor text:='>10000 then raise exception'; before_results jsonb; after_results jsonb;
 exceptions_before bigint; paused_since timestamptz; saved_payload jsonb; failed boolean:=false;
begin
 -- CASE P1.1: establish published results before lowering the unchanged guard.
 perform pg_temp.containment_upload(1);
 select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) into before_results from private.stockflow_economic_results r;
 if jsonb_array_length(before_results)=0 then raise exception 'Fixture did not publish results';end if;
 select count(*) into exceptions_before from private.stockflow_economic_import_exceptions;
 original:=pg_get_functiondef('private.stockflow_rebuild_instrument_economics(text)'::regprocedure);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'Expected exactly one test guard';end if;
 execute replace(original,anchor,'>-1 then raise exception');
 -- CASE P1.2: 54000 preserves all published result bytes and non-economic payload.
 perform pg_temp.containment_upload(2);
 select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) into after_results from private.stockflow_economic_results r;
 if before_results is distinct from after_results then raise exception 'Paused rebuild changed published results';end if;
 if (select payload->'catalog'->>'testRevision' from public.stockflow_snapshots where id='suprabha') is distinct from '2' then raise exception 'Snapshot did not commit';end if;
 select since into paused_since from private.stockflow_economic_rebuild_status where company_id='containment-test' and state='paused' and reason is not null;
 if paused_since is null then raise exception 'Pause not recorded';end if;
 if (select count(*) from private.stockflow_economic_import_exceptions)<>exceptions_before then raise exception 'Pause created an import exception';end if;
 -- CASE P1.3: repeated pauses retain the original start time.
 perform pg_temp.containment_upload(3);
 if (select since from private.stockflow_economic_rebuild_status where company_id='containment-test') is distinct from paused_since then raise exception 'Pause since changed';end if;
 -- CASE P1.4: next successful publication clears the pause.
 execute original;
 perform pg_temp.containment_upload(4);
 if not exists(select 1 from private.stockflow_economic_rebuild_status where company_id='containment-test' and state='ok' and since is null and reason is null) then raise exception 'Successful rebuild did not clear pause';end if;
 -- CASE P1.5: any other SQLSTATE aborts the entire upload.
 execute replace(replace(original,anchor,'>-1 then raise exception'),$$errcode='54000'$$,$$errcode='22023'$$);
 select payload into saved_payload from public.stockflow_snapshots where id='suprabha';
 begin
  perform pg_temp.containment_upload(5);
 exception when sqlstate '22023' then failed:=true;
 end;
 if not failed then raise exception 'Non-54000 error was swallowed';end if;
 if (select payload from public.stockflow_snapshots where id='suprabha') is distinct from saved_payload then raise exception 'Failed upload changed snapshot';end if;
 if exists(select 1 from private.stockflow_economic_source_vouchers where company_id='containment-test' and source_revision=5) then raise exception 'Failed upload admitted source';end if;
 execute original;
end$test$;
rollback;
