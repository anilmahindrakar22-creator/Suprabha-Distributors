import type { EconomicsWorkspaceData } from './instrument-economics-types';

type SourceLine = NonNullable<EconomicsWorkspaceData['sourceLines']>[number] & {
  partyName?: string | null;
  usedByInstrument?: boolean;
};
type InstrumentAddData = EconomicsWorkspaceData & {
  sourceLines?: SourceLine[];
  customers: (EconomicsWorkspaceData['customers'][number] & {
    city?: string | null;
    tallyIdentities?: { companyId: string; customerSourceId: string }[];
  })[];
};
type Lab = { id: string; name: string; city?: string | null; customerSourceId: string };
type InstrumentLabIdentity = { customerId: string; companyId: string; customerSourceId: string };

const paise = 5_000_000;

function amount(line: SourceLine): bigint {
  return /^-?\d+$/.test(line.netSalesPaise) ? BigInt(line.netSalesPaise) : BigInt(0);
}

function unused(line: SourceLine): boolean {
  return line.usedByInstrument !== true;
}

function readableText(line: SourceLine): string {
  return `${line.productName ?? ''} ${line.date ?? ''} ${line.partyName ?? ''}`.toLocaleLowerCase();
}

function money(value: bigint): string {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const rupees = absolute / BigInt(100);
  const remainder = absolute % BigInt(100);
  const fraction = remainder === BigInt(0) ? '' : `.${remainder.toString().padStart(2, '0')}`;
  return `${negative ? '-' : ''}₹${new Intl.NumberFormat('en-IN').format(rupees)}${fraction}`;
}

function dateLabel(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

export function instrumentPurchases(data: EconomicsWorkspaceData, search = '', showCheaper = false): SourceLine[] {
  const query = search.trim().toLocaleLowerCase();
  return ((data as InstrumentAddData).sourceLines ?? [])
    .filter(line => line.kind === 'purchase' && Number.isFinite(Number(line.quantity)) && Number(line.quantity) === 1 && unused(line) && amount(line) > BigInt(0) && (showCheaper || amount(line) >= BigInt(paise)))
    .filter(line => !query || readableText(line).includes(query))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function matchingInstrumentSales(data: EconomicsWorkspaceData, purchase: SourceLine): SourceLine[] {
  return ((data as InstrumentAddData).sourceLines ?? [])
    .filter(line => line.kind === 'sale' && line.companyId === purchase.companyId && line.productId === purchase.productId && line.unit === purchase.unit && Number.isFinite(Number(line.quantity)) && Number(line.quantity) === 1 && line.date >= purchase.date && unused(line) && amount(line) > BigInt(0))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function instrumentLineLabel(line: SourceLine): string {
  const verb = line.kind === 'purchase' ? 'bought' : 'sold';
  const pieces = [line.productName || 'Instrument', `${verb} ${dateLabel(line.date)}`, money(amount(line))];
  if (line.partyName) pieces.push(line.partyName);
  return pieces.join(' \u00b7 ');
}

export function instrumentLabIdentities(data: EconomicsWorkspaceData): InstrumentLabIdentity[] {
  return ((data as InstrumentAddData).customers ?? []).flatMap(customer =>
    (customer.tallyIdentities ?? []).map(identity => ({ customerId: customer.id, ...identity })),
  );
}

export function rentalLabs(data: EconomicsWorkspaceData, query: string, companyId: string): Lab[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized.length < 2) return [];
  const extra = data as InstrumentAddData;
  const identities = instrumentLabIdentities(data).filter(identity => identity.companyId === companyId);
  const seen = new Set<string>();
  return identities.flatMap(identity => {
    if (seen.has(identity.customerId)) return [];
    const customer = extra.customers.find(item => item.id === identity.customerId);
    if (!customer || !`${customer.name} ${customer.city ?? ''}`.toLocaleLowerCase().includes(normalized)) return [];
    seen.add(identity.customerId);
    return [{ id: customer.id, name: customer.name, ...(customer.city ? { city: customer.city } : {}), customerSourceId: identity.customerSourceId }];
  }).slice(0, 20);
}

export function derivedInstrumentFields(
  purchase: SourceLine,
  lab: Lab,
  installation: { modelId?: string | null } | null | undefined,
  installedOn: string,
) {
  const modelId = installation?.modelId || purchase.productName || '';
  return {
    companyId: purchase.companyId,
    customerSourceId: lab.customerSourceId,
    siteId: lab.city || lab.name,
    modelId,
    name: `${purchase.productName || 'Instrument'} \u00b7 ${lab.name}`,
    effectiveFrom: installedOn,
    capitalEvidence: `Tally purchase ${purchase.voucherNumber || purchase.lineKey}`,
    kind: 'placement' as const,
    lab: { id: lab.id, name: lab.name, ...(lab.city ? { city: lab.city } : {}), customerSourceId: lab.customerSourceId },
  };
}

export function investmentLine(purchase: SourceLine, sale?: SourceLine | null): string {
  const bought = amount(purchase);
  const billed = sale ? amount(sale) : BigInt(0);
  return `Investment ${money(bought - billed)} = bought ${money(bought)} \u2212 billed ${money(billed)}`;
}
