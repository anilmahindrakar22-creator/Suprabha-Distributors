begin;

-- An unresolved line already tied to a different instrument no longer marks this
-- instrument "Data incomplete"; lines with no target still flag every instrument
-- of the customer. The patch is exact-substring and fails closed.
do $migration$
declare
  v_old constant text := 'and v.company_id=f.company_id and v.customer_source_id=f.customer_source_id) has_unattributed';
  v_new constant text := 'and v.company_id=f.company_id and v.customer_source_id=f.customer_source_id and (r.target_id is null or r.target_id=f.id or exists(select 1 from private.stockflow_economic_group_members gm where gm.group_id=f.id and gm.placement_id=r.target_id))) has_unattributed';
  v_name text;
  v_signature regprocedure;
  v_def text;
  v_count integer;
begin
  foreach v_name in array array[
    'private.stockflow_economic_workspace_read(text[],boolean)',
    'private.stockflow_economic_workspace_detail(text[])'
  ] loop
    v_signature := v_name::regprocedure;
    v_def := pg_get_functiondef(v_signature);
    v_count := (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old);
    if v_count <> 1 then
      raise exception 'Expected exactly one has_unattributed expression in %, found %', v_name, v_count;
    end if;
    execute replace(v_def,v_old,v_new);
  end loop;
end $migration$;

revoke all on function private.stockflow_economic_workspace_read(text[],boolean) from public,anon,authenticated;
revoke all on function private.stockflow_economic_workspace_detail(text[]) from public,anon,authenticated;

commit;
