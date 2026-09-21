import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// Test-only read-only migration evidence checker.
import { pricingReleasePreflight } from '../pricing-release-preflight.mjs';

const directory = new URL('../../supabase/migrations/', import.meta.url);
const original = JSON.parse(readFileSync(new URL('../../supabase/migration-history-map.json', import.meta.url), 'utf8'));
const source = new Map(readdirSync(fileURLToPath(directory)).filter((name) => name.endsWith('.sql')).map((name) => [name, readFileSync(new URL(name, directory), 'utf8')]));

describe('read-only pricing release preflight', () => {
  it('validates current evidence and lists only the twelve pending pricing migrations', () => {
    const result = pricingReleasePreflight(original, source);
    expect(result.pending).toHaveLength(12);
    expect(result.pending[0]).toBe('20260912193000_customer_pricing_engine.sql');
    expect(result.deployed).toHaveLength(65);
    const names = result.deployed.map((entry: { localFile: string }) => entry.localFile);
    expect(names.slice(0, 2)).toEqual([
      '20260829054025_create_stockflow_private_snapshots.sql',
      '20260830071657_create_stockflow_member_allowlist.sql',
    ]);
    expect(names.indexOf('20260902113000_equipment_installations.sql')).toBeLessThan(names.indexOf('20260902080651_harden_business_history.sql'));
    expect(result.pending.join(' ')).not.toMatch(/archive|reset|rotate/);
    expect(result.releaseReady).toBe(false);
    expect(result.liveHistoryRechecked).toBe(false);
  });
  it('accepts documented CRLF normalization without modifying source', () => {
    const crlf = new Map([...source].map(([name, sql]) => [name, sql.replace(/\r/g, '').replace(/\n/g, '\r\n')]));
    expect(pricingReleasePreflight(original, crlf).pending).toHaveLength(12);
  });
  it('rejects changed SQL including changes inside literals', () => {
    const files = new Map(source);
    const name = original.migrations[0].localFile;
    files.set(name, `${files.get(name)}\nselect 'changed';`);
    expect(() => pricingReleasePreflight(original, files)).toThrow('hash changed');
  });
  it('rejects missing or newly unmapped files', () => {
    const files = new Map(source);
    files.delete(original.migrations[0].localFile);
    expect(() => pricingReleasePreflight(original, files)).toThrow('Missing migration');
    files.set(original.migrations[0].localFile, source.get(original.migrations[0].localFile)!);
    files.set('20260916000000_unreviewed.sql', 'select 1;');
    expect(() => pricingReleasePreflight(original, files)).toThrow('Unmapped');
  });
  it('rejects historical migrations relabeled as pending', () => {
    const evidence = structuredClone(original);
    Object.assign(evidence.migrations[1], { status: 'not_deployed', remoteVersion: null, remoteSha256: null });
    expect(() => pricingReleasePreflight(evidence, source)).toThrow('Unreviewed pending');
  });
  it('rejects duplicate local entries and remote versions', () => {
    const evidence = structuredClone(original);
    evidence.migrations.push(evidence.migrations[0]);
    expect(() => pricingReleasePreflight(evidence, source)).toThrow('duplicate local');
    evidence.migrations.pop();
    evidence.migrations[1].remoteVersion = evidence.migrations[0].remoteVersion;
    expect(() => pricingReleasePreflight(evidence, source)).toThrow('duplicate remote');
  });
  it('rejects unreviewed statuses and inconsistent exact-match hashes', () => {
    const evidence = structuredClone(original);
    evidence.migrations[0].status = 'assumed_match';
    expect(() => pricingReleasePreflight(evidence, source)).toThrow('Unreviewed migration status');
    evidence.migrations[0].status = 'exact_normalized_match';
    evidence.migrations[0].remoteSha256 = '0'.repeat(64);
    expect(() => pricingReleasePreflight(evidence, source)).toThrow('Inconsistent exact match');
  });
  it('rejects evidence for another project', () => {
    expect(() => pricingReleasePreflight({ ...original, projectId: 'other' }, source)).toThrow('Unexpected evidence project');
  });
});
