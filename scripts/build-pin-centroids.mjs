import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// CSV data is never evaluated. Support quoted commas, newlines and escaped quotes.
export function parseCsv(text) {
  const records = [];
  let record = [], field = '', quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === ',' || c === '\n' || c === '\r') {
      record.push(field); field = ''; closed = false;
      if (c !== ',') {
        if (record.some((value) => value !== '')) records.push(record);
        record = [];
        if (c === '\r' && text[i + 1] === '\n') i++;
      }
    } else if (c === '"' && field === '' && !closed) quoted = true;
    else {
      if (closed || c === '"') throw new Error('Malformed CSV quote');
      field += c;
    }
  }
  if (quoted) throw new Error('Unterminated CSV quote');
  record.push(field);
  if (record.some((value) => value !== '')) records.push(record);
  if (!records.length) throw new Error('CSV has no header');
  const headers = records.shift().map((value) => value.trim().toLowerCase());
  for (const name of ['pincode', 'statename', 'district', 'latitude', 'longitude']) {
    if (!headers.includes(name)) throw new Error(`Missing CSV column: ${name}`);
  }
  return records.map((values) => {
    if (values.length !== headers.length) throw new Error('CSV column count mismatch');
    return Object.fromEntries(headers.map((name, index) => [name, values[index]]));
  });
}

const coordinate = (value) => {
  const text = String(value ?? '').trim();
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? Number(text) : NaN;
};

export function filterOffices(rows) {
  const offices = [];
  let rejected = 0;
  for (const row of rows) {
    if (row.statename.trim().toLowerCase() !== 'karnataka') continue;
    const pin_code = row.pincode;
    const latitude = coordinate(row.latitude), longitude = coordinate(row.longitude);
    if (!/^[1-9]\d{5}$/.test(pin_code) || !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude === 0 || longitude === 0 || latitude < 11.5 || latitude > 18.5
      || longitude < 74 || longitude > 78.6) { rejected++; continue; }
    offices.push({ pin_code, latitude, longitude, district: row.district.trim(), state: 'Karnataka' });
  }
  return { offices, rejected };
}

export function median(values) {
  if (!values.length) throw new Error('Median requires values');
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function haversine(a, b) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const h = Math.sin(radians(b.latitude - a.latitude) / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude))
    * Math.sin(radians(b.longitude - a.longitude) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export function centroid(offices) {
  if (!offices.length) return { centre: null, outliers: 0 };
  const midpoint = (rows) => ({ latitude: median(rows.map((r) => r.latitude)), longitude: median(rows.map((r) => r.longitude)) });
  const initial = midpoint(offices);
  const kept = offices.filter((office) => haversine(initial, office) <= 25);
  const outliers = offices.length - kept.length;
  if (!kept.length) return { centre: null, outliers };
  const counts = new Map();
  for (const office of kept) counts.set(office.district, (counts.get(office.district) ?? 0) + 1);
  // Code-point order is deterministic across host locales.
  const district = [...counts.keys()].sort().sort((a, b) => counts.get(b) - counts.get(a))[0];
  const point = midpoint(kept);
  return { centre: {
    pin_code: kept[0].pin_code,
    latitude: Number(point.latitude.toFixed(6)), longitude: Number(point.longitude.toFixed(6)),
    district, state: 'Karnataka', office_count: kept.length,
  }, outliers };
}

export function buildCentroids(rows) {
  const { offices, rejected } = filterOffices(rows);
  const groups = new Map();
  for (const office of offices) {
    if (!groups.has(office.pin_code)) groups.set(office.pin_code, []);
    groups.get(office.pin_code).push(office);
  }
  const centres = [];
  let outliers = 0;
  for (const pin of [...groups.keys()].sort()) {
    const result = centroid(groups.get(pin));
    outliers += result.outliers;
    if (result.centre) centres.push(result.centre);
  }
  return { centres, offices: offices.length, rejected, outliers };
}

export function renderOutputs(centres, sourceHash, fetched) {
  const csvField = (value) => /[",\r\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value);
  const columns = ['pin_code', 'latitude', 'longitude', 'district', 'state', 'office_count'];
  const csv = columns.join(',') + '\n' + centres.map((row) => columns.map((key) => csvField(
    key === 'latitude' || key === 'longitude' ? row[key].toFixed(6) : row[key],
  )).join(',')).join('\n') + '\n';
  const sqlText = (value) => "'" + String(value).replaceAll("'", "''") + "'";
  const sourceVersion = `data.gov.in All India Pincode Directory till last month (Department of Posts, GODL-India), fetched ${fetched}, sha256 ${sourceHash}`;
  const values = centres.map((row) => `  (${sqlText(row.pin_code)}, ${row.latitude.toFixed(6)}, ${row.longitude.toFixed(6)}, ${sqlText(row.district)}, ${sqlText(row.state)}, ${row.office_count})`).join(',\n');
  if (!values) throw new Error('No Karnataka PIN centres found');
  const migration = `begin;

-- Generated by scripts/build-pin-centroids.mjs. Source: Department of Posts, GODL-India.
create table private.stockflow_pin_centroids (
  pin_code text primary key check (pin_code ~ '^[1-9][0-9]{5}$'),
  latitude numeric(9,6) not null,
  longitude numeric(9,6) not null,
  district text,
  state text not null,
  office_count int not null check (office_count > 0),
  source_version text not null
);

insert into private.stockflow_pin_centroids
  (pin_code, latitude, longitude, district, state, office_count, source_version)
select v.pin_code, v.latitude, v.longitude, v.district, v.state, v.office_count, ${sqlText(sourceVersion)}
from (values
${values}
) as v(pin_code, latitude, longitude, district, state, office_count);

revoke all on private.stockflow_pin_centroids from public, anon, authenticated;

commit;
`;
  return { csv, migration };
}

export function main(args = process.argv.slice(2), write = writeFileSync) {
  if (!(args.length === 1 || (args.length === 3 && args[1] === '--fetched'))) {
    throw new Error('Usage: node scripts/build-pin-centroids.mjs <csvPath> [--fetched 2026-10-31]');
  }
  const fetched = args[2] ?? '2026-10-31';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fetched) || !Number.isFinite(Date.parse(fetched))
    || new Date(fetched).toISOString().slice(0, 10) !== fetched) throw new Error('Invalid fetched date');
  const source = readFileSync(args[0]);
  const sourceHash = createHash('sha256').update(source).digest('hex');
  const result = buildCentroids(parseCsv(source.toString('utf8')));
  const { csv, migration } = renderOutputs(result.centres, sourceHash, fetched);
  const root = fileURLToPath(new URL('../', import.meta.url));
  for (const [path, data] of [
    ['supabase/seed-data/pin-centroids-karnataka.csv', csv],
    ['supabase/migrations/20261102140000_pin_centroids.sql', migration],
  ]) {
    const target = resolve(root, path);
    if (write === writeFileSync) mkdirSync(dirname(target), { recursive: true });
    write(target, data, 'utf8');
  }
  console.log(`offices=${result.offices} rejected=${result.rejected} outliers=${result.outliers} pins=${result.centres.length}`);
  console.log(`source_sha256=${sourceHash}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
