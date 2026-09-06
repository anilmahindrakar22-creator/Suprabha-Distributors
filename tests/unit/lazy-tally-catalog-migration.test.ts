import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(
    new URL(
      '../../supabase/migrations/20260906174500_lazy_tally_catalog.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);
const edge = readFileSync(
  fileURLToPath(
    new URL(
      '../../supabase/functions/stockflow-orders/index.ts',
      import.meta.url,
    ),
  ),
  'utf8',
);
const api = readFileSync(
  fileURLToPath(new URL('../../app/api/orders/route.ts', import.meta.url)),
  'utf8',
);

describe('lazy Tally catalogue contract', () => {
  it('protects catalogue reads with gateway authentication and active membership', () => {
    expect(migration).toContain(
      "digest(coalesce(p_gateway_key, ''), 'sha256')",
    );
    expect(migration).toContain("status = 'active'");
    expect(migration).toContain(
      'revoke all on function public.stockflow_catalog_gateway',
    );
    expect(migration).toContain('to service_role');
  });

  it('removes catalogue items from bootstrap and exposes a versioned lazy read', () => {
    expect(migration).toContain(
      "'catalogVersion', coalesce(v_snapshot->>'fetchedAt', '')",
    );
    expect(migration).toContain("'catalog', '[]'::jsonb");
    expect(migration).toContain("p_action <> 'get_catalog'");
    expect(edge).toContain('"get_catalog"');
    expect(edge).toContain('"stockflow_catalog_gateway"');
    expect(api).toContain("parameters.get('catalog') === '1'");
  });
});
