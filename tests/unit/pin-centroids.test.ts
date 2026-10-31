import { describe, expect, it } from 'vitest';
import { buildCentroids, centroid, filterOffices, haversine, median, parseCsv, renderOutputs } from '../../scripts/build-pin-centroids.mjs';

const header = 'circlename,regionname,divisionname,officename,pincode,officetype,delivery,district,statename,latitude,longitude';
const row = (lat: string | number, lng: string | number, district = 'Alpha', pin = '585102', state = 'Karnataka') =>
  `circle,region,division,"Office, with ""quotes""",${pin},SO,Delivery,${district},${state},${lat},${lng}`;
const fixture = (...rows: string[]) => parseCsv([header, ...rows].join('\r\n') + '\r\n');
const centre = (...rows: string[]) => centroid(filterOffices(fixture(...rows)).offices);

describe('PIN centroid builder', () => {
  it('parses quoted commas, escaped quotes, multiline fields and BOM without executing data', () => {
    const rows = parseCsv('\uFEFF' + [header, row(17.33, 76.85, '"District, North"')].join('\n'));
    expect(rows[0].officename).toBe('Office, with "quotes"');
    expect(rows[0].district).toBe('District, North');
    expect(fixture(row(17.33, 76.85, '"District\nNorth"'))[0].district).toBe('District\nNorth');
    expect(() => fixture(row(17.33, 76.85) + '"')).toThrow();
    expect(() => parseCsv(header + '\n"unterminated')).toThrow('Unterminated');
  });

  it('uses coordinate medians for odd and even counts without mutating input', () => {
    const values = [9, 1, 3];
    expect(median(values)).toBe(3);
    expect(values).toEqual([9, 1, 3]);
    expect(median([9, 1, 3, 5])).toBe(4);
    expect(centre(row(17.3, 76.8), row(17.32, 76.86), row(17.4, 76.82)).centre)
      .toMatchObject({ latitude: 17.32, longitude: 76.82, office_count: 3 });
    expect(centre(row(17.3, 76.8), row(17.4, 76.9)).centre)
      .toMatchObject({ latitude: 17.35, longitude: 76.85, office_count: 2 });
  });

  it('drops an office 40 km away, then recomputes the median and district from kept offices', () => {
    const latitude40km = 17.33 + 40 / 6371 * 180 / Math.PI;
    expect(haversine({ latitude: 17.33, longitude: 76.85 }, { latitude: latitude40km, longitude: 76.85 })).toBeCloseTo(40, 8);
    const result = centre(row(17.32, 76.85, 'Beta'), row(17.33, 76.85, 'Alpha'), row(latitude40km, 76.85, 'Zulu'));
    expect(result.outliers).toBe(1);
    expect(result.centre).toMatchObject({ latitude: 17.325, longitude: 76.85, office_count: 2, district: 'Alpha' });
  });

  it('rejects zero, blank, NA, nonnumeric and out-of-box coordinates on either axis', () => {
    const invalid = ['0', '', '  ', 'NA', 'Infinity', '0x10', '17oops'];
    const rows = fixture(...invalid.flatMap((v) => [row(v, 76.85), row(17.33, v)]),
      row(11.49, 76.85), row(18.51, 76.85), row(17.33, 73.99), row(17.33, 78.61));
    expect(filterOffices(rows)).toEqual({ offices: [], rejected: rows.length });
    expect(filterOffices(fixture(row(11.5, 74), row(18.5, 78.6))).offices).toHaveLength(2);
  });

  it('ignores other states, trims Karnataka case-insensitively and rejects invalid PINs', () => {
    const rows = fixture(row(17.33, 76.85, 'Alpha', '585102', 'Maharashtra'),
      row('NA', 'NA', 'Alpha', 'bad', 'Kerala'),
      ...['085102', '58510', '5851027', 'abc', '585 102', ' 585102 '].map((pin) => row(17.33, 76.85, 'Alpha', pin)),
      row(17.33, 76.85, 'Alpha', '585102', ' kArNaTaKa '));
    const result = filterOffices(rows);
    expect(result.rejected).toBe(6);
    expect(result.offices).toHaveLength(1);
    expect(result.offices[0]).toMatchObject({ pin_code: '585102', state: 'Karnataka' });
  });

  it('chooses the most frequent district and breaks ties alphabetically', () => {
    expect(centre(row(17.33, 76.85, 'Beta'), row(17.33, 76.85, 'Alpha')).centre?.district).toBe('Alpha');
    expect(centre(row(17.33, 76.85, 'Beta'), row(17.33, 76.85, 'Alpha'), row(17.33, 76.85, 'Beta')).centre?.district).toBe('Beta');
  });

  it('omits PINs with no offices remaining and counts all their outliers', () => {
    expect(centre(row(12, 75), row(18, 78))).toEqual({ centre: null, outliers: 2 });
    expect(centroid([])).toEqual({ centre: null, outliers: 0 });
  });

  it('rounds to six decimals and renders sorted CSV and one escaped SQL values list', () => {
    const result = buildCentroids(fixture(row(17.12345678, 76.98765432, '"O\'Brien, North"'), row(12, 75, 'South', '560001')));
    expect(result).toMatchObject({ offices: 2, rejected: 0, outliers: 0 });
    expect(result.centres.map((c) => c.pin_code)).toEqual(['560001', '585102']);
    expect(result.centres[1]).toMatchObject({ latitude: 17.123457, longitude: 76.987654 });
    const { csv, migration } = renderOutputs(result.centres, 'a'.repeat(64), '2026-10-31');
    expect(csv).toContain('585102,17.123457,76.987654,"O\'Brien, North",Karnataka,1');
    expect(migration).toContain("O''Brien, North");
    expect(migration).toContain('as v(pin_code, latitude, longitude, district, state, office_count)');
    expect(migration.match(/\nfrom \(values\n/g)).toHaveLength(1);
    expect(migration).toContain('revoke all on private.stockflow_pin_centroids from public, anon, authenticated;');
    expect(migration).toContain('fetched 2026-10-31, sha256 ' + 'a'.repeat(64));
  });
});
