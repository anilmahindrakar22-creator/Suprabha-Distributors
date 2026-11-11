begin;
create function pg_temp.catalog_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',message;end if;end$$;

create function pg_temp.old_catalog_current(p_company text) returns boolean
language sql stable set search_path=pg_catalog,private as $$
select exists(select 1 from private.stockflow_economic_item_catalogs c where c.company_id=p_company and not exists(select 1 from private.stockflow_economic_item_catalogs n where n.company_id=c.company_id and n.observed_at>c.observed_at) and not exists(select 1 from private.stockflow_economic_import_exceptions e where (e.company_id=p_company or e.company_id is null) and e.recorded_at>=c.imported_at and ((e.evidence->>'kind'='item_group_catalog' and coalesce((e.evidence->>'observedAt')::timestamptz>=c.observed_at,true)) or e.evidence->>'source'='connector_sync')))
$$;

-- C1: missing keys and JSON null retain SQL null semantics.
savepoint generated_values;
insert into private.stockflow_economic_import_exceptions(company_id,reason,evidence)
values ('catalog-test','C1','{}'),
 ('catalog-test','C1','{"source":"connector_sync"}'),
 ('catalog-test','C1','{"kind":"item_group_catalog","observedAt":"2026-07-01T00:00:00Z"}'),
 ('catalog-test','C1','{"source":null}');
select pg_temp.catalog_assert(count(*)=4 and bool_and(
 evidence_source is not distinct from evidence->>'source'
 and evidence_kind is not distinct from evidence->>'kind'
 and evidence_observed_at is not distinct from evidence->>'observedAt'), 'C1 generated values')
from private.stockflow_economic_import_exceptions where company_id='catalog-test' and reason='C1';
rollback to generated_values;

create function pg_temp.catalog_case(label text,expected boolean) returns void language plpgsql as $$
declare actual boolean:=private.stockflow_economic_item_catalog_current('catalog-test');
begin
 perform pg_temp.catalog_assert(actual=pg_temp.old_catalog_current('catalog-test'),label||' equivalence');
 perform pg_temp.catalog_assert(actual=expected,label||' expected value');
end$$;

-- C2: each exception case starts from the same clean catalog.
select pg_temp.catalog_case('C2.1 no catalog',false);
insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
values('catalog-test','fixture','2026-07-01T00:00:00Z',jsonb_build_object('groups',
 jsonb_build_array(jsonb_build_object('id','cg','name','Catalog group')),
 'products',jsonb_build_array(jsonb_build_object('id','product','name','Reagent','unit','pack','groupId','cg'))));
select pg_temp.catalog_case('C2.2 latest catalog',true);

savepoint exception_case;
insert into private.stockflow_economic_import_exceptions(company_id,reason,evidence,recorded_at)
select 'catalog-test','C2','{"source":"connector_sync"}',imported_at+interval '1 second'
from private.stockflow_economic_item_catalogs where company_id='catalog-test';
select pg_temp.catalog_case('C2.3 later sync',false);
rollback to exception_case;
insert into private.stockflow_economic_import_exceptions(company_id,reason,evidence,recorded_at)
select 'catalog-test','C2','{"source":"connector_sync"}',imported_at-interval '1 second'
from private.stockflow_economic_item_catalogs where company_id='catalog-test';
select pg_temp.catalog_case('C2.4 earlier sync',true);
rollback to exception_case;

insert into private.stockflow_economic_import_exceptions(company_id,reason,evidence,recorded_at)
select 'other-co','C2','{"source":"connector_sync"}',imported_at+interval '1 second'
from private.stockflow_economic_item_catalogs where company_id='catalog-test';
select pg_temp.catalog_case('C2.5 other company',true);
rollback to exception_case;
insert into private.stockflow_economic_import_exceptions(company_id,reason,evidence,recorded_at)
select null,'C2','{"source":"connector_sync"}',imported_at+interval '1 second'
from private.stockflow_economic_item_catalogs where company_id='catalog-test';
select pg_temp.catalog_case('C2.6 global sync',false);
rollback to exception_case;

insert into private.stockflow_economic_import_exceptions(company_id,reason,evidence,recorded_at)
select 'catalog-test','C2','{"kind":"item_group_catalog","observedAt":"2026-07-01T00:00:00Z"}',imported_at+interval '1 second'
from private.stockflow_economic_item_catalogs where company_id='catalog-test';
select pg_temp.catalog_case('C2.7 equal observation',false);
rollback to exception_case;
insert into private.stockflow_economic_import_exceptions(company_id,reason,evidence,recorded_at)
select 'catalog-test','C2','{"kind":"item_group_catalog","observedAt":"2026-07-02T00:00:00Z"}',imported_at+interval '1 second'
from private.stockflow_economic_item_catalogs where company_id='catalog-test';
select pg_temp.catalog_case('C2.7 later observation',false);
rollback to exception_case;
insert into private.stockflow_economic_import_exceptions(company_id,reason,evidence,recorded_at)
select 'catalog-test','C2','{"kind":"item_group_catalog","observedAt":"2026-06-30T00:00:00Z"}',imported_at+interval '1 second'
from private.stockflow_economic_item_catalogs where company_id='catalog-test';
select pg_temp.catalog_case('C2.8 earlier observation',true);
rollback to exception_case;
insert into private.stockflow_economic_import_exceptions(company_id,reason,evidence,recorded_at)
select 'catalog-test','C2','{"kind":"item_group_catalog"}',imported_at+interval '1 second'
from private.stockflow_economic_item_catalogs where company_id='catalog-test';
select pg_temp.catalog_case('C2.9 missing observation',false);
rollback to exception_case;

-- An exception invalidates the latest catalog but would leave the older one current.
savepoint older_catalog;
insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content,imported_at)
select company_id,'older-fixture',observed_at-interval '1 day',content,imported_at+interval '2 seconds'
from private.stockflow_economic_item_catalogs where company_id='catalog-test';
insert into private.stockflow_economic_import_exceptions(company_id,reason,evidence,recorded_at)
select 'catalog-test','C2','{"source":"connector_sync"}',imported_at+interval '1 second'
from private.stockflow_economic_item_catalogs where company_id='catalog-test' and source_version='fixture';
select pg_temp.catalog_case('C2.10 only latest counts',false);
rollback to older_catalog;

-- C3: unique, poorly compressible 8 KB notes force the old predicate to detoast.
insert into private.stockflow_economic_import_exceptions(company_id,reason,evidence,recorded_at)
select 'catalog-test','C3',jsonb_build_object('note',
 (select string_agg(md5(i::text||g::text),'') from generate_series(1,250) g)),
 c.imported_at+interval '1 second'
from generate_series(1,2000) i
cross join private.stockflow_economic_item_catalogs c where c.company_id='catalog-test';

do $$
declare started timestamptz; elapsed_ms numeric; actual boolean;
begin
 started:=clock_timestamp();
 for i in 1..200 loop
  actual:=private.stockflow_economic_item_catalog_current('catalog-test');
 end loop;
 elapsed_ms:=extract(epoch from clock_timestamp()-started)*1000;
 perform pg_temp.catalog_assert(elapsed_ms<2000,'C3 200 calls exceeded 2000 ms');
 perform pg_temp.catalog_assert(actual=pg_temp.old_catalog_current('catalog-test'),'C3 equivalence');
 perform pg_temp.catalog_assert(actual,'C3 catalog remains current');
 raise notice 'C3 catalog current columns elapsed ms: %',elapsed_ms;
 raise notice 'PASS catalog current columns C1-C3';
end$$;
rollback;
