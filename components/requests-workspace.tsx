'use client';

import { useState } from 'react';

import { ProductRequestInbox } from './product-request';
import { ProcurementRequirements } from './procurement-requirements';
import { PurchaseOrdersPanel } from './purchase-orders-panel';
import { canManagePurchaseOrders } from '@/lib/order-permissions';
import { PageHeader } from './page-header';
import { hasAnyStockFlowRole, type StockFlowRole } from '@/lib/user-types';

// Product requests and customer demand live here, off the Orders list, so orders stay list-first.
export function RequestsWorkspace({ roles, onOpenOrder }: { roles: readonly StockFlowRole[]; onOpenOrder?: (orderId: string, orderNumber: string) => void }) {
  const [poRefresh, setPoRefresh] = useState(0);
  const [requirementsRefresh, setRequirementsRefresh] = useState(0);
  return (
    <div className="h-full overflow-y-auto bg-sf-page">
      <div className="mx-auto max-w-5xl p-3 sm:p-6">
        <PageHeader eyebrow="Work requests" title="Requests" description="Product requests from staff and customer demand from open orders." />
        <ProcurementRequirements roles={roles} refreshKey={requirementsRefresh} onOpenOrder={onOpenOrder} onPurchaseOrdersCreated={() => setPoRefresh((value) => value + 1)} />
        {canManagePurchaseOrders(roles) ? <PurchaseOrdersPanel refreshKey={poRefresh} onChanged={() => setRequirementsRefresh((value) => value + 1)} /> : null}
        {hasAnyStockFlowRole(roles, ['administrator', 'management', 'operations']) ? <ProductRequestInbox /> : null}
      </div>
    </div>
  );
}
