import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// Test-only read-only migration evidence checker.
import { pricingReleasePreflight } from '../pricing-release-preflight.mjs';

const directory = new URL('../../supabase/migrations/', import.meta.url);
const original = JSON.parse(readFileSync(new URL('../../supabase/migration-history-map.json', import.meta.url), 'utf8'));
const source = new Map(readdirSync(fileURLToPath(directory)).filter((name) => name.endsWith('.sql')).map((name) => [name, readFileSync(new URL(name, directory), 'utf8')]));

describe('read-only pricing release preflight', () => {
  it('validates the saved production evidence after deployment', () => {
    const result = pricingReleasePreflight(original, source);
    expect(result.pending).toEqual([
      '20261007180000_instrument_economics_foundation.sql',
      '20261007181000_instrument_economic_import_and_rebuild.sql',
      '20261007182000_instrument_economics_workspace.sql',
      '20261007183000_instrument_economics_commands.sql',
      '20261010071925_historical_instrument_registration.sql',
      '20261010170000_instrument_actuals_without_plan.sql',
      '20261010172000_optional_plan_health.sql',
      '20261010200000_source_voucher_number.sql',
      '20261010210000_automatic_purchase_cost.sql',
      '20261010220000_auto_cost_batch_fallback.sql',
      '20261010230000_auto_cost_one_year_lookback.sql',
      '20261010240000_unmapped_items_not_unresolved.sql',
      '20261011000000_instrument_reagent_sale_date.sql',
      '20261011010000_active_economic_import_exceptions.sql',
      '20261011060830_order_summary_revision.sql',
      '20261011070000_product_master_refresh.sql',
      '20261011090000_requirements_decision_view.sql',
      '20261012184457_instrument_economics_summary_read.sql',
      '20261013120000_administrator_long_payback_approval.sql',
      '20261013130000_instrument_auto_approval.sql',
      '20261014090000_customer_accounts.sql',
      '20261014120000_account_classes.sql',
      '20261014160000_account_contacts.sql',
      '20261014180000_power_map.sql',
      '20261014190000_social_styles.sql',
      '20261015082020_visit_customers_without_ledger.sql',
      '20261015100000_customer_link_confirmation.sql',
    ]);
    expect(result.deployed.at(-1)?.localFile).toBe('20261005055748_activate_governed_role_union.sql');
    expect(result.deployed).toHaveLength(103);
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
    expect(pricingReleasePreflight(original, crlf).pending).toHaveLength(27);
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
  it('does not certify release readiness merely because every migration is deployed', () => {
    const evidence = structuredClone(original);
    for (const entry of evidence.migrations) {
      if (entry.status !== 'not_deployed') continue;
      Object.assign(entry, {
        status: 'exact_normalized_match',
        remoteVersion: entry.localFile.slice(0, 14),
        remoteSha256: entry.localSha256,
      });
    }
    const result = pricingReleasePreflight(evidence, source);
    expect(result.pending).toEqual([]);
    expect(result.releaseReady).toBe(false);
    expect(result.liveHistoryRechecked).toBe(false);
    expect(result.blockers).toContain('Complete staff-login acceptance against an isolated deployed candidate.');
  });
  it('rejects reviewed pending SQL that predates the deployed history', () => {
    const evidence = structuredClone(original);
    const entry = evidence.migrations.find((item: { localFile: string }) => item.localFile === '20260927180000_snapshot_pricing_import_privilege.sql');
    expect(entry).toBeDefined();
    Object.assign(entry!, { status: 'not_deployed', remoteVersion: null, remoteSha256: null });
    expect(() => pricingReleasePreflight(evidence, source)).toThrow('Pending migration predates deployed history');
  });
});
