import { leakageReasonLabels } from '@/lib/leakage-classification';

export type LeakageCaseHistoryRecord = {
  id: string;
  caseId: string;
  action: string;
  actor: string;
  recordedAt: string;
  payload: Record<string, unknown>;
};

const actionLabels: Record<string, string> = {
  create_case: 'Case created',
  update_case: 'Case updated',
  claim_recovery: 'Recovery claimed',
};

function displayText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function reasonLabel(value: unknown): string | undefined {
  const code = displayText(value);
  if (!code) return undefined;
  return Object.hasOwn(leakageReasonLabels, code)
    ? leakageReasonLabels[code as keyof typeof leakageReasonLabels]
    : code;
}

function Classification({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const classification = value as Record<string, unknown>;
  const primaryReason = reasonLabel(classification.primaryReason);
  const reasonCodes = Array.isArray(classification.reasonCodes)
    ? classification.reasonCodes.map(reasonLabel).filter((item): item is string => Boolean(item))
    : [];
  const confidence = displayText(classification.confidence);
  const evidenceReference = displayText(classification.evidenceReference);
  if (!primaryReason && !reasonCodes.length && !confidence && !evidenceReference) return null;

  return <div className="mt-1 grid gap-1 break-words text-xs leading-5 text-[#405a5d]">
    {primaryReason && <p><span className="font-semibold">Primary reason:</span> {primaryReason}</p>}
    {reasonCodes.length > 0 && <p><span className="font-semibold">Contributing reasons:</span> {reasonCodes.join(', ')}</p>}
    {confidence && <p><span className="font-semibold">Confidence:</span> {confidence}</p>}
    {evidenceReference && <p><span className="font-semibold">Evidence:</span> {evidenceReference}</p>}
  </div>;
}

function PayloadSummary({ payload }: { payload: Record<string, unknown> }) {
  const fields = [
    ['Status', displayText(payload.status)],
    ['Reason', displayText(payload.reason)],
    ['Action', displayText(payload.action)],
    ['Outcome', displayText(payload.outcome)],
    ['Owner', displayText(payload.owner)],
  ] as const;
  const visibleFields = fields.filter(([, value]) => value);

  return <>
    {visibleFields.length > 0 && <dl className="mt-1 grid gap-1 break-words text-xs leading-5 text-[#405a5d] sm:grid-cols-[auto_1fr] sm:gap-x-2">
      {visibleFields.map(([label, value]) => <div key={label} className="contents"><dt className="font-semibold">{label}:</dt><dd>{value}</dd></div>)}
    </dl>}
    <Classification value={payload.classification} />
  </>;
}

export function LeakageCaseHistory({ caseId, history, truncated = false }: {
  caseId: string;
  history: LeakageCaseHistoryRecord[];
  truncated?: boolean;
}) {
  const matching = history.filter(record => record.caseId === caseId);
  const visible = matching.slice(0, 20);
  const hasOlderHistory = truncated || matching.length > 20;

  return <details className="rounded-xl border border-[#d7e4e2] bg-white p-3 text-[#173b3d]">
    <summary className="min-h-10 cursor-pointer text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145e62]">Case history</summary>
    {visible.length === 0
      ? <p className="mt-2 text-xs leading-5 text-[#586e71]">No case history is available.</p>
      : <ol className="mt-2 grid gap-3">
        {visible.map(record => <li key={record.id} className="min-w-0 border-t border-[#e5efed] pt-2">
          <div className="flex min-w-0 flex-col gap-1 text-xs leading-5 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-2">
            <span className="font-semibold">{actionLabels[record.action] ?? 'Case event'}</span>
            <span className="break-all text-[#405a5d]">{displayText(record.actor) ?? 'Unknown actor'}</span>
            <time className="break-all text-[#586e71]" dateTime={record.recordedAt}>{record.recordedAt}</time>
          </div>
          <PayloadSummary payload={record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload) ? record.payload : {}} />
        </li>)}
      </ol>}
    {hasOlderHistory && <p className="mt-3 text-xs leading-5 text-[#586e71]">Showing up to 20 recent case events from the bounded audit view. Older events are retained in the audit ledger.</p>}
  </details>;
}
