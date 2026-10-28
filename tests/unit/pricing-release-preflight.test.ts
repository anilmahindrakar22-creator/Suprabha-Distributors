import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// Test-only read-only migration evidence checker.
import { pricingReleasePreflight } from '../pricing-release-preflight.mjs';

const directory = new URL('../../supabase/migrations/', import.meta.url);
const original = JSON.parse(readFileSync(new URL('../../supabase/migration-history-map.json', import.meta.url), 'utf8'));
const source = new Map(readdirSync(fileURLToPath(directory)).filter((name) => name.endsWith('.sql')).map((name) => [name, readFileSync(new URL(name, directory), 'utf8')]));

describe('read-only pricing release preflight', () => {
  it('registers supplier purchase replay and patches each live anchor exactly once', () => {
    const migration = source.get('20261029100000_supplier_purchase_orders.sql')!;
    const importer = source.get('20260921110000_observable_pricing_evidence_import.sql')!;
    const reader = source.get('20261028090000_to_order_list.sql')!;
    expect(importer.split("new.payload:=new.payload-'pricingHistory';")).toHaveLength(2);
    for (const anchor of ['d.oldest_order_at', '-coalesce(purchase_order,0) as need', "'openDemand',open_demand"]) {
      expect(reader.split(anchor), anchor).toHaveLength(2);
      expect(migration).toContain(anchor);
    }
    const fixture = readFileSync(new URL('../../supabase/tests/supplier_purchase_orders.sql', import.meta.url), 'utf8');
    expect(fixture).not.toMatch(/(?:insert\s+into|update)\s+private\.stockflow_(?:purchase_orders|purchase_order_lines|purchase_order_events|supplier_prices)\b/i);
    expect(fixture).toContain('update public.stockflow_snapshots');
    expect(fixture).toContain('public.stockflow_purchase_gateway');
    expect(fixture.trimEnd()).toMatch(/rollback;$/);
    expect(readFileSync(new URL('../pricing-migration-local.ps1', import.meta.url), 'utf8')).toContain('supabase/tests/supplier_purchase_orders.sql');
  });
  it('keeps to-order fixtures on real gateways with constrained literals', () => {
    const fixture = readFileSync(new URL('../../supabase/tests/to_order_list.sql', import.meta.url), 'utf8');
    expect(fixture).not.toMatch(/(?:insert\s+into|update)\s+private\.stockflow_(?:orders|order_lines|order_events|order_pricing_decisions|billing_snapshots)\b/i);
    expect(fixture).not.toMatch(/is\s+distinct\s+from\s+case\b/i);
    expect(fixture.trimEnd()).toMatch(/rollback;$/);
    for (const action of ['create_order', 'transition_order']) expect(fixture).toContain(`'${action}'`);
    const literals = (sql: string) => [...sql.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    const policy = source.get('20260902091533_centralize_order_policy.sql')!;
    const states = new Set(literals(policy.split('insert into private.stockflow_order_states(status, terminal) values')[1].split(';')[0]));
    for (const status of ['awaiting_confirmation', 'confirmed']) expect(states.has(status), status).toBe(true);
    expect(policy).toContain("('awaiting_confirmation','confirmed',array[");
    const member = source.get('20260830071657_create_stockflow_member_allowlist.sql')!;
    const statuses = new Set(literals(member.match(/check \(status in \(([^)]+)\)\)/)![1]));
    for (const status of ['active', 'suspended']) expect(statuses.has(status), status).toBe(true);
    const roles = source.get('20261025090000_billing_role.sql')!.match(/check \(role = any \(array\[([^\]]+)\]/)![1];
    expect(literals(roles)).toContain('administrator');
    const sql = [...source.values()].join('\n');
    const orderTable = sql.match(/create table(?: if not exists)? private\.stockflow_orders\s*\([\s\S]+?\n\);/i)![0];
    const sourceChecks = [...orderTable.matchAll(/check\s*\(source\s+in\s*\(([^)]+)\)/gi)];
    expect(sourceChecks.length).toBeGreaterThan(0);
    for (const check of sourceChecks) expect(literals(check[1])).toContain('phone');
    const migration = source.get('20261028090000_to_order_list.sql')!;
    expect(migration).toContain("coalesce(p_payload->>'view','')='to_order'");
    expect(migration).toContain('return public.stockflow_requirements_gateway_before_to_order(p_gateway_key,p_actor_email,p_action,p_payload)');
    // Keep the open-demand predicate identical to the existing reader.
    const previous = source.get('20261011090000_requirements_decision_view.sql')!;
    const excluded = /o\.status not in \([^)]+\)/;
    expect(migration.match(excluded)?.[0]).toBe(previous.match(excluded)?.[0]);
    expect(migration).toContain('sum(greatest(l.quantity-l.fulfilled_quantity,0))');
  });
  it('patches exactly the live sales import and keeps unit fixtures on real gateways', () => {
    const migration = source.get('20261026150000_rate_check_units.sql')!;
    const anchor = migration.split('$anchor$')[1];
    const importer = source.get('20260921110000_observable_pricing_evidence_import.sql')!.replace(/\r/g, '');
    expect(importer.split(anchor).length - 1).toBe(1);
    expect(migration).toContain("pg_get_functiondef('private.stockflow_import_tally_pricing_evidence()'::regprocedure)");
    expect(migration).toContain("nullif(btrim(entry->>'unit'),'')");
    const fixture = readFileSync(new URL('../../supabase/tests/rate_check_units.sql', import.meta.url), 'utf8');
    expect(fixture).not.toMatch(/(?:insert\s+into|update)\s+private\.stockflow_(?:orders|order_lines|order_pricing_decisions|billing_snapshots|order_tally_invoices)\b/i);
    expect(fixture).not.toMatch(/is\s+distinct\s+from\s+case\b/i);
    expect(fixture.trimEnd()).toMatch(/rollback;$/);
    for (const action of ['create_order', 'apply_governed_order_pricing', 'transition_order', 'get_order_pricing']) {
      expect(fixture).toContain(`'${action}'`);
    }
  });
  it('keeps push fixtures on real order gateways and valid member/state literals', () => {
    const fixture = readFileSync(new URL('../../supabase/tests/push_alerts.sql', import.meta.url), 'utf8');
    expect(fixture).not.toMatch(/insert\s+into\s+private\.stockflow_(?:orders|order_events|order_lines|billing_snapshots)\b/i);
    expect(fixture).not.toMatch(/update\s+private\.stockflow_(?:orders|order_events|order_lines)\b/i);
    expect(fixture).not.toContain("'draft'");
    expect(fixture).not.toMatch(/is\s+distinct\s+from\s+case\b/i);
    expect(fixture).not.toMatch(/[\u00c2\u00c3\ufffd]/);
    expect(fixture.trimEnd()).toMatch(/rollback;$/);
    for (const action of ['create_order', 'transition_order', 'save_fulfilment', 'set_order_assignee']) {
      expect(fixture).toContain(`'${action}'`);
    }
    const literals = (sql: string) => [...sql.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    const statesSql = source.get('20260902091533_centralize_order_policy.sql')!
      .split('insert into private.stockflow_order_states(status, terminal) values')[1].split(';')[0];
    const states = new Set(literals(statesSql));
    const transitions = [...fixture.matchAll(/push_test_transition\(o,'([^']+)'/g)].map((match) => match[1]);
    expect(transitions.length).toBeGreaterThan(0);
    for (const status of ['awaiting_confirmation', ...transitions]) expect(states.has(status), status).toBe(true);
    const transitionRules = source.get('20260902091533_centralize_order_policy.sql')!;
    let previous = 'awaiting_confirmation';
    for (const status of transitions) {
      expect(transitionRules).toContain(`('${previous}','${status}',array[`);
      previous = status;
    }
    const memberSql = source.get('20260830071657_create_stockflow_member_allowlist.sql')!;
    const memberStatuses = new Set(literals(memberSql.match(/check \(status in \(([^)]+)\)\)/)![1]));
    const rolesSql = source.get('20261025090000_billing_role.sql')!.match(/check \(role = any \(array\[([^\]]+)\]/)![1];
    const roles = new Set(literals(rolesSql));
    const memberInserts = [...fixture.matchAll(/insert into public\.stockflow_members[^;]+;/g)];
    expect(memberInserts).toHaveLength(2);
    for (const [statement] of memberInserts) {
      for (const value of literals(statement.split('values')[1])) {
        if (!value.includes('@')) expect(roles.has(value) || memberStatuses.has(value), value).toBe(true);
      }
    }
    for (const match of fixture.matchAll(/update public\.stockflow_members set status\s*=\s*'([^']+)'/g)) {
      expect(memberStatuses.has(match[1]), match[1]).toBe(true);
    }
    const roleSets = [...fixture.matchAll(/set roles\s*=\s*array\[([^\]]+)\]/g)];
    for (const match of roleSets) {
      const values = literals(match[1]);
      expect(new Set(values).size).toBe(values.length);
      for (const role of values) expect(roles.has(role), role).toBe(true);
    }
    const pushSql = source.get('20261026140000_push_alerts.sql')!;
    const outcomes = new Set(literals(pushSql.match(/status text not null check \(status in \(([^)]+)\)/)![1]));
    for (const match of fixture.matchAll(/'outcome',\s*'([^']+)'/g)) expect(outcomes.has(match[1]), match[1]).toBe(true);
    const scopesSql = source.get('20260902145535_enforce_order_scope_and_state_constraints.sql')!;
    const scopes = new Set(literals(scopesSql.match(/check \(scope in \(([^)]+)\)\)/)![1]));
    for (const match of fixture.matchAll(/set scope\s*=\s*'([^']+)'/g)) expect(scopes.has(match[1]), match[1]).toBe(true);
  });
  it('validates the saved production evidence after deployment', () => {
    const result = pricingReleasePreflight(original, source);
    expect(result.pending).toEqual([
      '20261028090000_to_order_list.sql',
      '20261029090000_challan_delivery.sql',
      '20261029091000_order_list_priority_sort.sql',
      '20261029100000_supplier_purchase_orders.sql',
    ]);
    expect(result.deployed.at(-1)?.localFile).toBe('20261026150000_rate_check_units.sql');
    expect(result.deployed).toHaveLength(147);
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
    expect(pricingReleasePreflight(original, crlf).pending).toEqual([
      '20261028090000_to_order_list.sql',
      '20261029090000_challan_delivery.sql',
      '20261029091000_order_list_priority_sort.sql',
      '20261029100000_supplier_purchase_orders.sql',
    ]);
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
      Object.assign(entry, { status: 'exact_normalized_match', remoteVersion: entry.localFile.slice(0, 14), remoteSha256: entry.localSha256 });
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
