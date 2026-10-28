import { formatRupees } from '@/lib/billing-sheet';

export type RateCheckLine = {
  lineId: string | null;
  tallyKey: string;
  itemName: string;
  approvedRate: number | null;
  invoiceRates: number[];
  invoiceUnits?: string[];
  orderUnit?: string | null;
  difference: number | null;
  state: 'matches' | 'different' | 'unit_differs' | 'missing_on_invoice' | 'not_on_order' | 'no_approved_rate';
};

export type RateCheck = {
  view: 'rate_check'; orderId: string; orderNumber: string; customerName: string; status: string;
  tolerance: number;
  state: 'not_billed' | 'no_approved_price' | 'waiting_for_tally' | 'matches' | 'different';
  differentCount?: number;
  limitations?: string[];
  lines: RateCheckLine[];
};

export type RateExceptions = {
  view: 'rate_exceptions'; tolerance: number; checkedCount: number;
  orders: Array<{ orderId: string; orderNumber: string; customerName: string; status: string; differentCount: number; worstDifference: number | null }>;
};

export const RATE_CHECK_ROLES = ['administrator', 'management', 'accounts'] as const;
export const RATE_EXCEPTION_ROLES = ['administrator', 'management'] as const;
export const RATE_CHECK_STATUSES = ['billed_in_tally', 'ready_for_dispatch', 'dispatched', 'delivered'] as const;

export function rateCheckBadge(check: RateCheck | null): string | null {
  return check?.state === 'different' ? 'Rate differs' : null;
}

export function rateCheckSummary(check: RateCheck): string {
  switch (check.state) {
    case 'matches': return 'Tally rates match the approved price (within ₹1)';
    case 'different': {
      const n = check.differentCount ?? 0;
      return `${n} ${n === 1 ? 'item differs' : 'items differ'} from the approved price`;
    }
    case 'waiting_for_tally': return 'Waiting for Tally invoice rates to sync';
    case 'no_approved_price': return 'No approved price to compare';
    case 'not_billed': return 'Not billed yet';
  }
}

export function rateLineLabel(line: RateCheckLine): string {
  switch (line.state) {
    case 'unit_differs': {
      const units = line.invoiceUnits ?? [];
      return units.length ? `Billed per ${units.join(' / ')}, order is per ${line.orderUnit ?? 'unit'}: check the unit` : 'Billed in a different unit';
    }
    case 'different': {
      const d = line.difference ?? 0;
      return `Billed ${formatRupees(Math.abs(d))} ${d < 0 ? 'lower' : 'higher'} per unit`;
    }
    case 'missing_on_invoice': return 'Not on the Tally invoice';
    case 'not_on_order': return 'On the Tally invoice but not on the order';
    case 'no_approved_rate': return 'No approved rate';
    case 'matches': return 'Matches';
  }
}
