begin;

create table private.stockflow_economic_received_entries (
 company_id text not null, source_id text not null, source_revision bigint not null,
 entry jsonb not null, received_at timestamptz not null default now(), primary key(company_id,source_id)
);
create table private.stockflow_economic_received_versions (
 company_id text primary key, source_version text not null, window_from date not null,
 window_to date not null, received_at timestamptz not null default now()
);
revoke all on private.stockflow_economic_received_entries,private.stockflow_economic_received_versions from public,anon,authenticated,service_role;

create function private.stockflow_expand_economic_delta() returns trigger
language plpgsql security definer set search_path=pg_catalog,private,extensions as $$
declare doc jsonb; company text; expanded jsonb; ids jsonb;
begin
 if new.id<>'suprabha' or new.payload->'economicEvidence' is null or new.payload->'economicEvidence'='null'::jsonb then return new;end if;
 doc:=new.payload->'economicEvidence';
 doc:=doc-'expandedDelta'-'windowSourceIds';
 company:=doc->>'companyId';
 perform pg_advisory_xact_lock(hashtextextended('instrument-economics-v1',0));
 if doc->>'schemaVersion'='1' then
  if jsonb_typeof(doc->'vouchers')='array' then
   select coalesce(jsonb_agg(e->'sourceId' order by n),'[]'::jsonb) into ids from jsonb_array_elements(doc->'vouchers') with ordinality t(e,n);
   doc:=doc||jsonb_build_object('windowSourceIds',ids);
   if doc->>'completeWindow'='true' and doc->>'purpose' is distinct from 'sales_coverage' and not (doc ? 'backfillEntry') and jsonb_array_length(doc->'vouchers')<=2000 then
    begin
     delete from private.stockflow_economic_received_entries where company_id=company;
     insert into private.stockflow_economic_received_entries(company_id,source_id,source_revision,entry)
      select company,e->>'sourceId',(e->>'revision')::bigint,e from (
       select distinct on (e->>'sourceId') e,n from jsonb_array_elements(doc->'vouchers') with ordinality t(e,n)
       where nullif(btrim(e->>'sourceId'),'') is not null and e->>'revision' ~ '^[0-9]+$'
       order by e->>'sourceId',n desc
      ) last_entry;
     insert into private.stockflow_economic_received_versions(company_id,source_version,window_from,window_to)
      values(company,doc->>'sourceVersion',(doc->>'windowFrom')::date,(doc->>'windowTo')::date)
      on conflict(company_id) do update set source_version=excluded.source_version,window_from=excluded.window_from,window_to=excluded.window_to,received_at=now();
    exception when data_exception or integrity_constraint_violation then
     insert into private.stockflow_economic_import_exceptions(company_id,reason,evidence)
      values(company,'Received evidence store not updated',jsonb_build_object('kind','economic_delta'));
     delete from private.stockflow_economic_received_versions where company_id=company;
    end;
   end if;
  end if;
 elsif doc->>'schemaVersion'='2' then
  if nullif(btrim(company),'') is null or doc->>'completeWindow' is distinct from 'true'
   or doc->>'purpose'='sales_coverage' or doc ? 'backfillEntry'
   or jsonb_typeof(doc->'baseVersion') is distinct from 'string' or nullif(btrim(doc->>'baseVersion'),'') is null
   or jsonb_typeof(doc->'manifest') is distinct from 'array' or jsonb_typeof(doc->'vouchers') is distinct from 'array' then
   raise exception 'Invalid economic delta envelope' using errcode='22023';
  end if;
  if jsonb_array_length(doc->'manifest')>10000 or jsonb_array_length(doc->'vouchers')>2000
   or exists(select 1 from jsonb_array_elements(doc->'manifest') t(m) where
    case when jsonb_typeof(m)='array' then jsonb_array_length(m)<>2 else true end
    or jsonb_typeof(m->0) is distinct from 'string' or nullif(btrim(m->>0),'') is null
    or jsonb_typeof(m->1) is distinct from 'string' or (m->>1) !~ '^[0-9]+$') then
   raise exception 'Invalid economic delta envelope' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(doc->'manifest') t(m) group by m->>0 having count(*)>1)
   or exists(select 1 from jsonb_array_elements(doc->'vouchers') t(e) where not exists(
    select 1 from jsonb_array_elements(doc->'manifest') t(m) where m->>0=e->>'sourceId' and m->>1=e->>'revision')) then
   raise exception 'Invalid economic delta envelope' using errcode='22023';
  end if;
  if not exists(select 1 from private.stockflow_economic_received_versions where company_id=company and source_version=doc->>'baseVersion') then
   raise exception 'Economic delta base mismatch; full upload required' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(doc->'manifest') t(m)
   where not exists(select 1 from jsonb_array_elements(doc->'vouchers') t(e) where e->>'sourceId'=m->>0 and e->>'revision'=m->>1)
   and not exists(select 1 from private.stockflow_economic_received_entries r where r.company_id=company and r.source_id=m->>0 and r.source_revision::numeric=(m->>1)::numeric)) then
   raise exception 'Economic delta manifest mismatch; full upload required' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(coalesce(d.e,r.entry) order by m.n,d.n) filter(where d.e is not null or v.id is null),'[]'::jsonb)
   into expanded from jsonb_array_elements(doc->'manifest') with ordinality m(pair,n)
   left join jsonb_array_elements(doc->'vouchers') with ordinality d(e,n) on d.e->>'sourceId'=m.pair->>0 and d.e->>'revision'=m.pair->>1
   left join private.stockflow_economic_received_entries r on r.company_id=company and r.source_id=m.pair->>0 and r.source_revision::numeric=(m.pair->>1)::numeric
   left join private.stockflow_economic_source_vouchers v on v.company_id=company and v.source_id=r.source_id and v.source_revision=r.source_revision and v.evidence=r.entry;
  insert into private.stockflow_economic_received_entries(company_id,source_id,source_revision,entry)
   select company,e->>'sourceId',(e->>'revision')::bigint,e from (
    select distinct on (e->>'sourceId') e,n from jsonb_array_elements(doc->'vouchers') with ordinality t(e,n) order by e->>'sourceId',n desc
   ) last_entry on conflict(company_id,source_id) do update set source_revision=excluded.source_revision,entry=excluded.entry,received_at=now();
  delete from private.stockflow_economic_received_entries r where r.company_id=company
   and not (r.source_id=any(array(select m->>0 from jsonb_array_elements(doc->'manifest') t(m))));
  insert into private.stockflow_economic_received_versions(company_id,source_version,window_from,window_to)
   values(company,doc->>'sourceVersion',(doc->>'windowFrom')::date,(doc->>'windowTo')::date)
   on conflict(company_id) do update set source_version=excluded.source_version,window_from=excluded.window_from,window_to=excluded.window_to,received_at=now();
  select coalesce(jsonb_agg(m->0 order by n),'[]'::jsonb) into ids from jsonb_array_elements(doc->'manifest') with ordinality t(m,n);
  doc:=(doc-'manifest'-'baseVersion')||jsonb_build_object('schemaVersion','1','vouchers',expanded,'windowSourceIds',ids,'expandedDelta',true);
 end if;
 new.payload:=jsonb_set(new.payload,'{economicEvidence}',doc);return new;
end $$;
revoke all on function private.stockflow_expand_economic_delta() from public,anon,authenticated;
create trigger stockflow_00_expand_economic_delta before insert or update of payload on public.stockflow_snapshots
 for each row execute function private.stockflow_expand_economic_delta();

do $patch$
declare definition text; old_text text; new_text text;
begin
 definition:=replace(pg_get_functiondef('private.stockflow_import_economic_vouchers()'::regprocedure),chr(13),'');
 old_text:=$old$jsonb_array_length(doc->'vouchers')>2000$old$;
 new_text:=$new$jsonb_array_length(doc->'vouchers')>(case when doc->>'expandedDelta'='true' then 10000 else 2000 end)$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
  raise exception 'Expected one evidence cap anchor';
 end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old$not exists(select 1 from jsonb_array_elements(doc->'vouchers') e where e->>'sourceId'=v.source_id)$old$;
 new_text:=$new$not (v.source_id = any(array(select jsonb_array_elements_text(coalesce(doc->'windowSourceIds',(select coalesce(jsonb_agg(e->'sourceId'),'[]'::jsonb) from jsonb_array_elements(doc->'vouchers') e))))))$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>2 then
  raise exception 'Expected two complete-window omission id anchors';
 end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;
end $patch$;
revoke all on function private.stockflow_import_economic_vouchers() from public,anon,authenticated;

commit;
