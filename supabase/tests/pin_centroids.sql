begin;

do $test$
declare v_row record; v_distance double precision;
begin
  if to_regclass('private.stockflow_pin_centroids') is null then raise exception 'PC1 table missing'; end if;
  if (select count(*) from private.stockflow_pin_centroids) <= 1000 then raise exception 'PC1 insufficient rows'; end if;
  if exists(select 1 from private.stockflow_pin_centroids
    where pin_code !~ '^[1-9][0-9]{5}$' or latitude is null or longitude is null
      or latitude not between 11.5 and 18.5 or longitude not between 74.0 and 78.6
      or state is distinct from 'Karnataka' or office_count is null or office_count <= 0
      or source_version is null or source_version <> 'data.gov.in All India Pincode Directory till last month (Department of Posts, GODL-India), fetched 2026-10-31, sha256 701ee84ba125a914e7ffc979c0308b3a041b8adffa85ec9d5f4e0579ecf062e5') then
    raise exception 'PC1 invalid reference row';
  end if;
  raise notice 'PASS: PC1 table exists, more than 1000 rows, all reference checks hold';

  select * into strict v_row from private.stockflow_pin_centroids where pin_code='585102';
  v_distance := 2 * 6371 * asin(sqrt(
    power(sin(radians(v_row.latitude::double precision - 17.33) / 2), 2)
    + cos(radians(17.33)) * cos(radians(v_row.latitude::double precision))
    * power(sin(radians(v_row.longitude::double precision - 76.85) / 2), 2)));
  if v_distance > 10 then raise exception 'PC2 585102 is % km from Kalaburagi',v_distance; end if;
  raise notice 'PASS: PC2 585102 within 10 km of 17.33, 76.85';
end $test$;

-- Exercise real SELECT attempts under both client roles, including schema denial.
set local role anon;
do $test$
begin
  begin
    perform 1 from private.stockflow_pin_centroids limit 1;
    raise exception 'PC3 anon could select';
  exception when insufficient_privilege then null;
  end;
end $test$;
reset role;
set local role authenticated;
do $test$
begin
  begin
    perform 1 from private.stockflow_pin_centroids limit 1;
    raise exception 'PC3 authenticated could select';
  exception when insufficient_privilege then null;
  end;
end $test$;
reset role;
do $test$
begin
  if has_table_privilege('anon','private.stockflow_pin_centroids','SELECT')
    or has_table_privilege('authenticated','private.stockflow_pin_centroids','SELECT') then
    raise exception 'PC3 client SELECT privilege exists';
  end if;
  raise notice 'PASS: PC3 anon and authenticated cannot select';
end $test$;

rollback;
