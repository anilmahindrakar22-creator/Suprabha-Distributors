import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(new URL('../../supabase/migrations/20260902092611_idempotent_order_transitions.sql', import.meta.url)),
  'utf8',
);

describe('idempotent order transition migration', () => {
  it('stores an immutable command result under an actor-scoped key', () => {
    expect(migration).toContain('create table private.stockflow_command_results');
    expect(migration).toContain('primary key (actor_email, action, idempotency_key)');
    expect(migration).toContain('stockflow_command_results_no_delete');
  });

  it('serializes duplicate commands and rejects key reuse with different input', () => {
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain("extensions.digest(p_payload::text, 'sha256')");
    expect(migration).toContain('Idempotency key was already used for a different request');
  });

  it('records the request ID in audit and outbox data before saving the result', () => {
    expect(migration).toContain("jsonb_build_object('requestId', v_idempotency_key)");
    expect(migration).toContain("'from', v_from_status, 'to', v_to_status, 'requestId', v_idempotency_key");
    expect(migration).toContain('perform private.finish_stockflow_command(');
  });
});
