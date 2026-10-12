import { AlertTriangle, CheckCircle2, Wrench } from 'lucide-react';
import { instrumentStatusLabels, type InstrumentServiceStatus } from '@/lib/instrument-portfolio';

const statusStyle: Record<InstrumentServiceStatus, string> = {
  urgent: 'border-red-200 bg-red-50 text-red-800',
  attention: 'border-amber-200 bg-amber-50 text-amber-900',
  clear: 'border-emerald-200 bg-emerald-50 text-emerald-800',
};

export function InstrumentStatusBadge({ status }: { status: InstrumentServiceStatus }) {
  const Icon = status === 'urgent' ? AlertTriangle : status === 'attention' ? Wrench : CheckCircle2;
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${statusStyle[status]}`}><Icon size={14} aria-hidden="true" />{instrumentStatusLabels[status]}</span>;
}
