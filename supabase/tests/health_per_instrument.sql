begin;

-- Source-text checks on the patched functions (no economics fixture needed).
do $test$
declare
  v_name text;
  v_def text;
  v_new constant text := 'r.target_id is null or r.target_id=f.id';
  v_old constant text := 'v.customer_source_id=f.customer_source_id) has_unattributed';
begin
  foreach v_name in array array[
    'private.stockflow_economic_workspace_read(text[],boolean)',
    'private.stockflow_economic_workspace_detail(text[])'
  ] loop
    v_def := pg_get_functiondef(v_name::regprocedure);
    if (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new) <> 1 then
      raise exception 'Health per instrument: % must contain the target clause exactly once', v_name;
    end if;
    if position(v_old in v_def) > 0 then
      raise exception 'Health per instrument: % still has the unscoped has_unattributed expression', v_name;
    end if;
    if position('gm.group_id=f.id and gm.placement_id=r.target_id' in v_def) = 0 then
      raise exception 'Health per instrument: % lost the group-member clause', v_name;
    end if;
    raise notice 'PASS health per instrument: % scopes has_unattributed to its own or untargeted lines', v_name;
  end loop;
end $test$;

rollback;
