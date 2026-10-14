'use client';

import { ProductRequestInbox } from './product-request';
import { ProcurementRequirements } from './procurement-requirements';
import { PageHeader } from './page-header';
import { hasAnyStockFlowRole, type StockFlowRole } from '@/lib/user-types';

// Product requests and customer demand live here, off the Orders list, so orders stay list-first.
export function RequestsWorkspace({ roles, onOpenOrder }: { roles: readonly StockFlowRole[]; onOpenOrder?: (orderId: string, orderNumber: string) => void }) {
  return (
    <div className="h-full overflow-y-auto bg-sf-page">
      <div className="mx-auto max-w-5xl p-3 sm:p-6">
        <PageHeader eyebrow="Work requests" title="Requests" description="Product requests from staff and customer demand from open orders." />
        {hasAnyStockFlowRole(roles, ['administrator', 'management', 'operations']) ? <ProductRequestInbox /> : null}
        <ProcurementRequirements onOpenOrder={onOpenOrder} />
      </div>
    </div>
  );
}
