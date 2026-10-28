-- Patch the live delivery gateway, including the combined-role changes from
-- 20261004073444_combined_role_operational_gateways.sql.
do $patch$
declare definition text; anchor text; replacement text;
begin
  definition := replace(pg_get_functiondef('public.stockflow_delivery_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
  anchor := $old$    if char_length(coalesce(v_courier,'')) not between 2 and 160
       or char_length(coalesce(v_tracking,'')) not between 2 and 160
       or v_dispatch_date is null or v_dispatch_date > current_date then
      raise exception 'Valid dispatch date, transporter and tracking number are required' using errcode = '22023';
    end if;$old$;
  replacement := $new$    if v_dispatch_date is null or v_dispatch_date > (now() at time zone 'Asia/Kolkata')::date then
      raise exception 'Dispatch date must be today or earlier (India date)' using errcode = '22023';
    end if;
    if char_length(coalesce(v_courier,'')) not between 2 and 160 then
      raise exception 'Choose a transporter or Local delivery' using errcode = '22023';
    end if;
    if char_length(coalesce(v_tracking,'')) not between 2 and 160 then
      raise exception 'Enter a tracking or LR number' using errcode = '22023';
    end if;$new$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'IST dispatch validation anchor changed';
  end if;
  definition := replace(definition,anchor,replacement);
  execute definition;
end $patch$;
