import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workspace = readFileSync('components/order-workspace.tsx', 'utf8');

describe('order refresh consistency', () => {
  it('uses a monotonic request identity for manual and filtered list requests', () => {
    expect(workspace).toContain('const latestListRequestRef = useRef(0)');
    expect(workspace.match(/\+\+latestListRequestRef\.current/g)).toHaveLength(3);
    expect(workspace).toContain('if (requestId !== latestListRequestRef.current) return');
  });

  it('prevents duplicate refresh taps and reports progress accessibly', () => {
    expect(workspace).toContain('onClick={() => void load(false, true)}');
    expect(workspace).toContain('disabled={refreshing}');
    expect(workspace).toContain('aria-busy={refreshing}');
    expect(workspace).toContain("refreshing ? 'Refreshing…' : 'Refresh'");
  });
});
