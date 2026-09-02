import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function read(path: string) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
}

const auditMigration = read('../../supabase/migrations/20260902150249_audit_fulfilment_before_after.sql');
const integrationTest = read('../../supabase/tests/transactional_command_integrity.sql');

describe('transactional integrity database assets', () => {
  it('captures exact fulfilment state before and after a command', () => {
    expect(auditMigration).toContain('private.stockflow_fulfilment_snapshot');
    expect(auditMigration).toContain("'before',v_before,'after',v_after");
    expect(auditMigration).toContain("'requestId',v_idempotency_key");
  });

  it('tests duplicate replay and stale-writer rejection through real gateways', () => {
    expect(integrationTest.match(/public\.stockflow_edit_gateway/g)).toHaveLength(3);
    expect(integrationTest).toContain('exception when serialization_failure');
    expect(integrationTest).toContain('Duplicate edit created');
  });

  it('tests rollback and leaves the database unchanged', () => {
    expect(integrationTest).toContain('Failed stale command left a completed command record');
    expect(integrationTest.trimEnd().endsWith('rollback;')).toBe(true);
  });
});
