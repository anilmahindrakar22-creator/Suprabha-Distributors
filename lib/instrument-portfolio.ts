import type { InstalledAsset, ServiceTicket, ServiceWorkspaceData } from './service-types';

export type InstrumentServiceStatus = 'urgent' | 'attention' | 'clear';
export const instrumentStatusLabels: Record<InstrumentServiceStatus, string> = {
  urgent: 'Urgent service', attention: 'Service attention', clear: 'No open service issues',
};
export type InstrumentPortfolioRow = InstalledAsset & {
  serviceStatus: InstrumentServiceStatus;
  openTicketCount: number;
  openTicketNumbers: string[];
  economicStatus: 'separate_workspace';
};
export type InstrumentPortfolio = {
  instruments: InstrumentPortfolioRow[];
  generatedAt: string;
  economicsReadiness: 'separate_workspace';
};

// A ticket is evidence of service attention, never proof that a machine is down.
export function serviceStatusForTickets(tickets: ServiceTicket[]): InstrumentServiceStatus {
  const open = tickets.filter(ticket => ticket.status === 'open');
  if (open.some(ticket => ticket.priority === 'urgent' || (ticket.category === 'breakdown' && ticket.priority === 'high'))) return 'urgent';
  return open.length ? 'attention' : 'clear';
}

export function buildInstrumentPortfolio(data: ServiceWorkspaceData, generatedAt: string): InstrumentPortfolio {
  const byInstallation = new Map<string, ServiceTicket[]>();
  for (const ticket of data.tickets) {
    const tickets = byInstallation.get(ticket.installationId) ?? [];
    tickets.push(ticket);
    byInstallation.set(ticket.installationId, tickets);
  }
  const rank: Record<InstrumentServiceStatus, number> = { urgent: 0, attention: 1, clear: 2 };
  const instruments = data.assets.map(asset => {
    const tickets = byInstallation.get(asset.installationId) ?? [];
    const open = tickets.filter(ticket => ticket.status === 'open');
    return { ...asset, serviceStatus: serviceStatusForTickets(tickets), openTicketCount: open.length,
      openTicketNumbers: open.map(ticket => ticket.ticketNumber), economicStatus: 'separate_workspace' as const };
  }).sort((a, b) => rank[a.serviceStatus] - rank[b.serviceStatus] || a.customerName.localeCompare(b.customerName, 'en-IN') || a.installationId.localeCompare(b.installationId));
  return { instruments, generatedAt, economicsReadiness: 'separate_workspace' };
}

export function filterInstrumentPortfolio(rows: InstrumentPortfolioRow[], query: string, status: InstrumentServiceStatus | 'all') {
  const search = query.trim().toLocaleLowerCase('en-IN');
  return rows.filter(row => (status === 'all' || row.serviceStatus === status) && (!search ||
    [row.customerName, row.itemName, row.serialNumber, row.orderNumber, row.siteContact, ...row.openTicketNumbers]
      .some(value => value?.toLocaleLowerCase('en-IN').includes(search))));
}
