import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const frame = readFileSync('components/stockflow-frame.tsx', 'utf8');
const orders = readFileSync('components/order-workspace.tsx', 'utf8');
const route = readFileSync('app/api/orders/route.ts', 'utf8');

describe('lightweight workspace boundaries', () => {
  it('loads deferred service and administrator sections only when opened', () => {
    expect(frame).toContain("const OrderWorkspace = lazy(loadOrderWorkspace)");
    expect(frame).toContain("lazy(() => import('./service-workspace')");
    expect(frame).toContain("lazy(() => import('./user-management')");
    expect(frame).not.toContain("import { ServiceWorkspace } from './service-workspace'");
    expect(frame).not.toContain("import { UserManagement } from './user-management'");
    expect(frame).not.toContain("import { OrderWorkspace } from './order-workspace'");
  });

  it('preloads Orders without competing with the initial Stock render', () => {
    expect(frame).toContain("'requestIdleCallback' in window");
    expect(frame).toContain('void loadOrderWorkspace()');
    expect(frame).toContain("await import('@/lib/order-bootstrap-cache')");
    expect(frame).not.toContain("import { clearOrderBootstrapCache, loadOrderBootstrap }");
    expect(frame).toContain('onPointerEnter={item === \'orders\' ? warmOrders : undefined}');
    expect(frame).toContain('onPointerDown={item === \'orders\' ? warmOrders : undefined}');
  });

  it('does not mount every order detail form in the initial inbox', () => {
    expect(orders).toContain('const [detailsLoaded, setDetailsLoaded] = useState(false)');
    expect(orders).toContain('if (event.currentTarget.open) { setDetailsLoaded(true); void loadDetails(); }');
    expect(orders).toContain('{detailsLoaded ? <>');
  });

  it('exposes successful save timing through the existing measured response contract', () => {
    const post = route.slice(route.indexOf('export async function POST'));
    expect(post).toContain('const startedAt = performance.now()');
    expect(post).toContain('return measuredJsonResponse(result, startedAt)');
  });
});
