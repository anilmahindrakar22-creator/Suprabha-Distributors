import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// Test-only read-only migration evidence checker.
import { pricingReleasePreflight } from '../pricing-release-preflight.mjs';

const directory = new URL('../../supabase/migrations/', import.meta.url);
const original = JSON.parse(readFileSync(new URL('../../supabase/migration-history-map.json', import.meta.url), 'utf8'));
const source = new Map(readdirSync(fileURLToPath(directory)).filter((name) => name.endsWith('.sql')).map((name) => [name, readFileSync(new URL(name, directory), 'utf8')]));

describe('read-only pricing release preflight', () => {
  it('registers the wallet migrations after candidate rebuild and SQL tests after sales coverage', () => {
    const result = pricingReleasePreflight(original, source);
    expect(result.pending.indexOf('20261030130000_wallet_v2.sql')).toBeGreaterThan(result.pending.indexOf('20261030110000_economics_candidate_rebuild.sql'));
    expect(result.pending.indexOf('20261031130000_wallet_my_actions.sql')).toBeGreaterThan(result.pending.indexOf('20261031120000_wallet_actions.sql'));
    expect(result.pending.indexOf('20261031140000_power_map_enhancement.sql')).toBeGreaterThan(result.pending.indexOf('20261031130000_wallet_my_actions.sql'));
    expect(result.pending.indexOf('20261031150000_power_map_influence.sql')).toBeGreaterThan(result.pending.indexOf('20261031140000_power_map_enhancement.sql'));
    expect(result.sqlTests).toEqual(['supabase/tests/sales_coverage.sql', 'supabase/tests/wallet_v2.sql', 'supabase/tests/wallet_v2_concurrency.sql', 'supabase/tests/wallet_diagnosis.sql', 'supabase/tests/wallet_diagnosis_concurrency.sql', 'supabase/tests/wallet_actions.sql', 'supabase/tests/wallet_actions_concurrency.sql', 'supabase/tests/wallet_my_actions.sql', 'supabase/tests/power_map_enhancement.sql', 'supabase/tests/power_map_influence.sql', 'supabase/tests/po_tally_receipts.sql', 'supabase/tests/po_tally_receipts_concurrency.sql']);
    const runner = readFileSync(new URL('../pricing-migration-local.ps1', import.meta.url), 'utf8');
    expect(runner).toContain("'20261030110000_economics_candidate_rebuild.sql','20261030130000_wallet_v2.sql','20261031090000_wallet_diagnosis.sql','20261031120000_wallet_actions.sql','20261031130000_wallet_my_actions.sql','20261031140000_power_map_enhancement.sql','20261031150000_power_map_influence.sql'");
    let previous = -1;
    for (const path of result.sqlTests) {
      const position = runner.indexOf(path);
      expect(position).toBeGreaterThan(previous);
      previous = position;
      const fixture = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
      if (path.includes('wallet_v2')) expect(fixture).toContain('raise notice \'PASS');
    }
    const migration = source.get('20261030130000_wallet_v2.sql')!;
    expect(migration).toContain('stockflow_wallet_gateway');
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).not.toMatch(/create(?: or replace)? function private\.stockflow_sales_(?:coverage_status|reconciliation)\(/i);
  });
  it('bounds economics with checked final-definition anchors and registers parity separately from acceptance', () => {
    const migration = source.get('20261030110000_economics_candidate_rebuild.sql')!;
    const base = source.get('20261007181000_instrument_economic_import_and_rebuild.sql')!;
    const scope = source.get('20261016061635_mapped_instrument_cost_scope.sql')!;
    // The mapped-scope migration is the last writer of the rebuild. Earlier
    // cost/date/return patches leave these five seams intact.
    const writers = [...source].filter(([file, sql]) => file < '20261030110000' && (
      sql.includes("pg_get_functiondef('private.stockflow_rebuild_instrument_economics(text)'::regprocedure)") ||
      /create(?: or replace)? function private\.stockflow_rebuild_instrument_economics\(/i.test(sql)
    )).map(([file]) => file).sort();
    expect(writers.at(-1)).toBe('20261016061635_mapped_instrument_cost_scope.sql');
    let definition = base.slice(base.indexOf('create function private.stockflow_rebuild_instrument_economics('));
    definition = definition.replace('recovery_origin date;', 'recovery_origin date; cost_products jsonb;');
    const scopedInsert = scope.split('$replacement$')[1];
    expect(definition.split(' insert into private.stockflow_economic_runs(actor)')).toHaveLength(2);
    definition = definition.replace(' insert into private.stockflow_economic_runs(actor)', scopedInsert);
    const patches = [...migration.matchAll(/\(\$old\$([\s\S]*?)\$old\$,\s*(?:\$new\$([\s\S]*?)\$new\$|(''))\)/g)];
    expect(patches).toHaveLength(5);
    for (const [, anchor, replacement] of patches) {
      expect(definition.split(anchor), anchor).toHaveLength(2);
      definition = definition.replace(anchor, replacement ?? '');
    }
    expect(definition).not.toContain('Economic rebuild exceeds V1 limit; narrow source window');
    expect(definition.split('private.stockflow_economic_rebuild_candidates(cost_products)')).toHaveLength(2);
    expect(definition.indexOf('into cost_products')).toBeLessThan(definition.indexOf('into rebuild_candidate_ids'));
    expect(definition.indexOf('into rebuild_candidate_ids')).toBeLessThan(definition.indexOf('insert into private.stockflow_economic_runs(actor)'));
    expect(definition.split('>10000 then raise exception')).toHaveLength(2); // containment test's seam
    expect(migration).toContain('if occurrences<>1 then raise exception');
    for (const signature of ['stockflow_rebuild_instrument_economics_full_scan(text)', 'stockflow_economic_rebuild_candidates(jsonb)']) {
      expect(migration).toContain(`revoke all on function private.${signature} from public,anon,authenticated,service_role;`);
    }
    expect(migration).not.toContain('stockflow_economics_gateway');
    const runner = readFileSync(new URL('../pricing-migration-local.ps1', import.meta.url), 'utf8');
    expect(runner).toContain("'20261030101000_sales_coverage.sql','20261030110000_economics_candidate_rebuild.sql'");
    expect(runner).toContain('supabase/tests/economics_candidate_rebuild.sql');
    expect(runner).not.toContain('supabase/scripts/economics-candidate-parity.sql');
    const fixture = readFileSync(new URL('../../supabase/tests/economics_candidate_rebuild.sql', import.meta.url), 'utf8');
    const acceptance = readFileSync(new URL('../../supabase/scripts/economics-candidate-parity.sql', import.meta.url), 'utf8');
    for (const sql of [fixture, acceptance]) {
      expect(sql.trimEnd()).toMatch(/rollback;$/);
      expect(sql).toContain('stockflow_rebuild_instrument_economics_full_scan');
      expect(sql).not.toMatch(/INSERT_HERE/);
    }
    const helpers = (sql: string) => sql.split('-- BEGIN SHARED PARITY HELPERS')[1].split('-- END SHARED PARITY HELPERS')[0];
    expect(helpers(acceptance)).toBe(helpers(fixture));
  });
  it('keeps full-sales patches additive with unique source anchors and registered replay tests', () => {
    const expectedOwners = [
      ['private.stockflow_import_economic_vouchers', '20261016053720_economic_import_execution_budget.sql'],
      ['private.stockflow_rebuild_instrument_economics', '20261016061635_mapped_instrument_cost_scope.sql'],
      ['public.stockflow_economics_gateway', '20261030090000_instrument_register.sql'],
    ];
    for (const [name, expectedOwner] of expectedOwners) {
      const owners = [...source].filter(([file, sql]) => file < '20261030100000' && (
        sql.includes(`pg_get_functiondef('${name}(`) ||
        new RegExp(`create(?: or replace)? function ${name.replaceAll('.', '\\.')}\\(`, 'i').test(sql)
      )).map(([file]) => file).sort();
      expect(owners.at(-1), `Final existing definition of ${name}: ${owners.join(', ')}`).toBe(expectedOwner);
    }
    const importer = source.get('20261007181000_instrument_economic_import_and_rebuild.sql')!;
    const containment = source.get('20261030100000_economic_rebuild_containment.sql')!;
    const coverage = source.get('20261030101000_sales_coverage.sql')!;
    for (const anchor of [
      "perform private.stockflow_rebuild_instrument_economics('tally-sync');",
      "'Complete window omitted known vouchers; supply cancellation revisions',doc-'vouchers'",
    ]) expect(importer.split(anchor), anchor).toHaveLength(2);
    expect(containment).toContain("exception when sqlstate '54000'");
    expect(containment).not.toContain('stockflow_economic_import_exceptions');
    expect(containment).not.toContain('create or replace function private.stockflow_rebuild_instrument_economics');
    const gateway = source.get('20261007183000_instrument_economics_commands.sql')!;
    expect(gateway.split("if p_action='get_instrument_economics' then")).toHaveLength(2);
    expect(coverage).toContain("return private.stockflow_sales_coverage_read(roles)");
    expect(coverage).toContain("from public,anon,authenticated");
    const runner = readFileSync(new URL('../pricing-migration-local.ps1', import.meta.url), 'utf8');
    expect(runner).toContain('supabase/tests/economic_rebuild_containment.sql');
    expect(runner).toContain('supabase/tests/sales_coverage.sql');
  });
  it('keeps register anchors unique in the logic-bearing definitions', () => {
    const history = source.get('20261010071925_historical_instrument_registration.sql')!;
    const gateway = source.get('20261007183000_instrument_economics_commands.sql')!;
    const registration = source.get('20261030090000_instrument_register.sql')!;
    const anchors = [
      [history, 'coalesce(i.customer_id,o.customer_id)=customer and i.serial_number=serial'],
      [gateway, 'target private.stockflow_economic_targets%rowtype;'],
      [gateway, 'insert into private.stockflow_economic_targets(kind,name,company_id,customer_id,customer_source_id,site_id,model_id,installation_id,effective_from,created_by)'],
    ];
    for (const [definition, anchor] of anchors) {
      expect(definition.split(anchor), anchor).toHaveLength(2);
      expect(registration).toContain(anchor);
    }
    const runner = readFileSync(new URL('../pricing-migration-local.ps1', import.meta.url), 'utf8');
    for (const name of ['instrument_register.sql', 'instrument_register_read.sql', 'instrument_register_concurrency.sql']) {
      expect(runner).toContain(`supabase/tests/${name}`);
    }
    expect(runner).toContain('instrument_register_upgrade=1');
    const read = source.get('20261030091000_instrument_register_read.sql')!;
    expect(read).toContain('private.stockflow_economic_workspace_read(text[],boolean)');
    expect(read).toContain('private.stockflow_economic_workspace_detail(text[])');
  });
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
  it('registers PO Tally receipts after purchase orders and runs the race after acceptance', () => {
    const result = pricingReleasePreflight(original, source);
    const name = '20261102090000_po_tally_receipts.sql';
    expect(result.pending.indexOf(name)).toBeGreaterThan(result.pending.indexOf('20261029100000_supplier_purchase_orders.sql'));
    expect(source.get(name)).toContain('stockflow_po_receipt_gateway');
    const runner = readFileSync(new URL('../pricing-migration-local.ps1', import.meta.url), 'utf8');
    expect(runner).toContain("'20261031150000_power_map_influence.sql','20261102090000_po_tally_receipts.sql'");
    expect([...runner].every(character => character.charCodeAt(0) < 128)).toBe(true);
    const main = 'supabase/tests/po_tally_receipts.sql';
    const race = 'supabase/tests/po_tally_receipts_concurrency.sql';
    expect(result.sqlTests.indexOf(race)).toBe(result.sqlTests.indexOf(main) + 1);
    expect(runner.indexOf(race)).toBeGreaterThan(runner.indexOf(main));
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
      '20261030090000_instrument_register.sql',
      '20261030091000_instrument_register_read.sql',
      '20261030100000_economic_rebuild_containment.sql',
      '20261030101000_sales_coverage.sql',
      '20261030110000_economics_candidate_rebuild.sql',
      '20261030130000_wallet_v2.sql',
      '20261031090000_wallet_diagnosis.sql',
      '20261031120000_wallet_actions.sql',
      '20261031130000_wallet_my_actions.sql',
      '20261031140000_power_map_enhancement.sql',
      '20261031150000_power_map_influence.sql',
      '20261102090000_po_tally_receipts.sql',
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
      '20261030090000_instrument_register.sql',
      '20261030091000_instrument_register_read.sql',
      '20261030100000_economic_rebuild_containment.sql',
      '20261030101000_sales_coverage.sql',
      '20261030110000_economics_candidate_rebuild.sql',
      '20261030130000_wallet_v2.sql',
      '20261031090000_wallet_diagnosis.sql',
      '20261031120000_wallet_actions.sql',
      '20261031130000_wallet_my_actions.sql',
      '20261031140000_power_map_enhancement.sql',
      '20261031150000_power_map_influence.sql',
      '20261102090000_po_tally_receipts.sql',
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
