begin;

create function pg_temp.p_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Growth paise assertion: %',label;end if;end$$;

do $$
declare
 sample jsonb:='{"paiseToThreshold":12.5,"paise":-3.5,"aPaise":1234.5,"bPaise":-0.5,"cPaise":10,"dPaise":null,"quantity":2.5,"marginPct":12.34,"nested":{"rows":[{"unitPricePaise":99.4999},{"unitPricePaise":99.5}],"name":"x"},"list":[],"textPaise":"7"}';
 x jsonb; f text; anchor text; name text; kv jsonb;
begin
 x:=private.stockflow_growth_integer_paise(sample);
 perform pg_temp.p_assert(x='{"paiseToThreshold":13,"paise":-4,"aPaise":1235,"bPaise":-1,"cPaise":10,"dPaise":null,"quantity":2.5,"marginPct":12.34,"nested":{"rows":[{"unitPricePaise":99},{"unitPricePaise":100}],"name":"x"},"list":[],"textPaise":"7"}'::jsonb,'P1 recursive rounding');
 perform pg_temp.p_assert(private.stockflow_growth_integer_paise(null) is null
  and private.stockflow_growth_integer_paise('[]')='[]'::jsonb
  and private.stockflow_growth_integer_paise('"s"')='"s"'::jsonb,'P2 null, empty array and scalar');
 f:=pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure);
 foreach name in array array['stockflow_growth_margin_read','stockflow_growth_margin_detail','stockflow_growth_billed_below'] loop
  anchor:='return private.stockflow_growth_integer_paise(private.'||name||$call$((now() at time zone 'Asia/Kolkata')::date,p_payload));$call$;
  perform pg_temp.p_assert((length(f)-length(replace(f,anchor,'')))/length(anchor)=1,'P3 wrapped '||name);
 end loop;
 perform pg_temp.p_assert(position('return private.stockflow_growth_margin_read(' in f)=0,'P3 no unwrapped margin read');
 -- Strict keyvalue() accepts objects only; recursive descent also visits scalars.
 for kv in select jsonb_path_query(x,'strict $.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "Paise$")') loop
  if jsonb_typeof(kv->'value')='number' then
   perform pg_temp.p_assert((kv->>'value')::numeric=trunc((kv->>'value')::numeric),'P4 integral '||(kv->>'key'));
  end if;
 end loop;
 raise notice 'PASS growth paise P1-P4';
end$$;

rollback;
