export type EconomicDocumentExclusion = {
  sourceId: string;
  revision: string;
  date: string;
  voucherType: string;
  reason: string;
  cancelled: boolean;
};

export function EconomicDocumentExclusions({ documents, total }: {
  documents: EconomicDocumentExclusion[];
  total: number;
}) {
  if (documents.length === 0) return null;
  const olderCount = Math.max(0, total - documents.length);

  return <details className="rounded-xl border border-[#d7e4e2] bg-white p-3 text-[#173b3d]">
    <summary className="min-h-10 cursor-pointer text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145e62]">
      Excluded documents ({total})
    </summary>
    <p className="mt-2 text-xs leading-5 text-[#586e71]">
      Classified non-economic documents are retained for audit and excluded from revenue, GP and supply.
    </p>
    <ul className="mt-2 grid gap-2">
      {documents.map((document, index) => <li key={`${document.sourceId}-${document.revision}-${index}`} className="min-w-0 rounded-lg border border-[#e5efed] p-3">
        <dl className="grid min-w-0 gap-1 break-words text-xs leading-5 sm:grid-cols-[auto_1fr] sm:gap-x-2">
          <dt className="font-semibold">Date:</dt><dd className="min-w-0 break-all">{document.date}</dd>
          <dt className="font-semibold">Voucher type:</dt><dd className="min-w-0 break-words">{document.voucherType}</dd>
          <dt className="font-semibold">Source:</dt><dd className="min-w-0 break-all">{document.sourceId}</dd>
          <dt className="font-semibold">Revision:</dt><dd className="min-w-0 break-all">{document.revision}</dd>
          <dt className="font-semibold">Reason:</dt><dd className="min-w-0 break-words">{document.reason}</dd>
          {document.cancelled && <><dt className="font-semibold">Status:</dt><dd>Cancelled</dd></>}
        </dl>
      </li>)}
    </ul>
    {olderCount > 0 && <p className="mt-3 text-xs leading-5 text-[#586e71]">{olderCount} older excluded {olderCount === 1 ? 'document is' : 'documents are'} retained for audit.</p>}
  </details>;
}
