import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(new URL('../../supabase/migrations/20260902093349_idempotent_remaining_mutations.sql', import.meta.url)),
  'utf8',
);

const gateways = ['fulfilment', 'edit', 'exception', 'installation', 'user'];

describe('remaining mutation idempotency migration', () => {
  it.each(gateways)('wraps the %s gateway in the shared command protocol', (gateway) => {
    expect(migration).toContain(`public.stockflow_${gateway}_gateway(text,text,text,jsonb)`);
  });

  it('starts and finishes every wrapped command in the same database function', () => {
    expect(migration.match(/begin_stockflow_command/g)).toHaveLength(5);
    expect(migration.match(/finish_stockflow_command/g)).toHaveLength(5);
  });

  it('adds request IDs to order and member audit history', () => {
    expect(migration).toContain('add column request_id text');
    expect(migration).toContain("'requestId',v_idempotency_key");
    expect(migration).toContain('actor_email, request_id');
  });
});
