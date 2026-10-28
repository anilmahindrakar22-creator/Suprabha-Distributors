export type EconomicDocumentExclusion = {
  sourceId: string;
  revision: string;
  date: string;
  voucherType: string;
  reason: string;
  cancelled: boolean;
};

function formatExclusionDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

export function EconomicDocumentExclusions({ documents, total }: {
  documents: EconomicDocumentExclusion[];
  total: number;
}) {
  if (documents.length === 0) return null;
  const olderCount = Math.max(0, total - documents.length);

  return <details className="rounded-xl border border-sf-line-soft bg-white p-3 text-sf-strong">
    <summary className="min-h-10 cursor-pointer text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-brand">
      Excluded documents ({total})
    </summary>
    <p className="mt-2 text-xs leading-5 text-sf-muted">
      Classified non-economic documents are retained for audit and excluded from revenue, GP and supply.
    </p>
    <ul className="mt-2 grid gap-2">
      {documents.map((document, index) => <li key={`${document.sourceId}-${document.revision}-${index}`} className="min-w-0 rounded-lg border border-sf-line-soft p-3">
        <dl className="grid min-w-0 gap-1 break-words text-xs leading-5 sm:grid-cols-[auto_1fr] sm:gap-x-2">
          <dt className="font-semibold">Date:</dt><dd className="min-w-0 break-all">{formatExclusionDate(document.date)}</dd>
          <dt className="font-semibold">Voucher type:</dt><dd className="min-w-0 break-words">{document.voucherType}</dd>
          <dt className="font-semibold">Source:</dt><dd className="min-w-0 break-all">{document.sourceId}</dd>
          <dt className="font-semibold">Revision:</dt><dd className="min-w-0 break-all">{document.revision}</dd>
          <dt className="font-semibold">Reason:</dt><dd className="min-w-0 break-words">{document.reason}</dd>
          {document.cancelled && <><dt className="font-semibold">Status:</dt><dd>Cancelled</dd></>}
        </dl>
      </li>)}
    </ul>
    {olderCount > 0 && <p className="mt-3 text-xs leading-5 text-sf-muted">{olderCount} older excluded {olderCount === 1 ? 'document is' : 'documents are'} retained for audit.</p>}
  </details>;
}
