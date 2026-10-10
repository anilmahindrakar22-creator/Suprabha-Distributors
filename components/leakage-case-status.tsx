import { Ban, CircleCheck, CircleDot, CircleMinus, Clock3, FileCheck2, LoaderCircle, type LucideIcon } from 'lucide-react';
import type { LeakageCase } from '@/lib/instrument-economics-types';

type LeakageCaseStatus = LeakageCase['status'];

const statusPresentation: Record<LeakageCaseStatus, { label: string; Icon: LucideIcon; className: string }> = {
  detected: { label: 'Detected', Icon: CircleDot, className: 'border-sky-200 bg-sky-50 text-sky-900' },
  qualified: { label: 'Qualified', Icon: FileCheck2, className: 'border-amber-200 bg-amber-50 text-amber-900' },
  in_progress: { label: 'In progress', Icon: LoaderCircle, className: 'border-amber-200 bg-amber-50 text-amber-900' },
  recovered: { label: 'Recovered', Icon: CircleCheck, className: 'border-emerald-200 bg-emerald-50 text-emerald-900' },
  partially_recovered: { label: 'Partially recovered', Icon: Clock3, className: 'border-amber-200 bg-amber-50 text-amber-900' },
  no_recovery: { label: 'No recovery', Icon: CircleMinus, className: 'border-slate-200 bg-slate-50 text-slate-800' },
  dismissed: { label: 'Dismissed', Icon: Ban, className: 'border-slate-200 bg-slate-50 text-slate-800' },
};

export function LeakageCaseStatus({ status }: { status: LeakageCaseStatus }) {
  const { label, Icon, className } = statusPresentation[status];
  return <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${className}`}>
    <Icon aria-hidden="true" focusable="false" className="size-3.5 shrink-0" />
    <span>{label}</span>
  </span>;
}
