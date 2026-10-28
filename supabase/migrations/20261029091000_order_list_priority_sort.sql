begin;

do $migration$
declare
  f text;
  updated text;
  old_fragment text;
  new_fragment text;
  match_count integer;
begin
  select pg_get_functiondef('public.stockflow_order_list_gateway(text,text,text,jsonb)'::regprocedure) into f;

  old_fragment := 'order by candidate.created_at desc';
  new_fragment := $sort$order by
        case when v_status = 'cancelled' then 0 else
          case candidate.priority when 'urgent' then 0 when 'high' then 1 else 2 end
        end,
        candidate.created_at desc, candidate.id desc$sort$;
  match_count := (length(f)-length(replace(f,old_fragment,'')))/length(old_fragment);
  if match_count <> 1 then
    raise exception 'Expected exactly one candidate order for priority sorting, found %', match_count;
  end if;
  updated := replace(f,old_fragment,new_fragment);
  f := updated;

  old_fragment := 'select o.created_at, jsonb_build_object(';
  new_fragment := 'select o.created_at, o.priority, o.id, jsonb_build_object(';
  match_count := (length(f)-length(replace(f,old_fragment,'')))/length(old_fragment);
  if match_count <> 1 then
    raise exception 'Expected exactly one projected order sort tuple, found %', match_count;
  end if;
  f := replace(f,old_fragment,new_fragment);

  old_fragment := 'jsonb_agg(order_json order by created_at desc)';
  new_fragment := $sort$jsonb_agg(order_json order by
      case when v_status = 'cancelled' then 0 else
        case priority when 'urgent' then 0 when 'high' then 1 else 2 end
      end,
      created_at desc, id desc)$sort$;
  match_count := (length(f)-length(replace(f,old_fragment,'')))/length(old_fragment);
  if match_count <> 1 then
    raise exception 'Expected exactly one outer order aggregation, found %', match_count;
  end if;
  execute replace(f,old_fragment,new_fragment);
end $migration$;

revoke all on function public.stockflow_order_list_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_list_gateway(text,text,text,jsonb) to service_role;

commit;
