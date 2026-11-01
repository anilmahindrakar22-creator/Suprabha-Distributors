'use client';

import { useRef, useState } from 'react';

const button = 'min-h-11 rounded-xl border border-sf-line px-3 text-xs font-bold text-sf-ink disabled:opacity-50';

export function ProspectOpportunity({ customerId, brandName, reason }: { customerId: string; brandName: string; reason: string }) {
  const requestId = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  async function openOpportunity() {
    if (busy) return;
    setStatus('');
    setBusy(true);
    try {
      const response = await fetch('/api/wallet/diagnosis', {
        method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'open_opportunity', payload: { requestId: requestId.current, customerId, kind: 'capture', divisionCode: null, origin: 'manual', reason } }),
      });
      if (response.status === 200) setStatus('Opportunity opened. Follow it up in Wallet.');
      else if (response.status === 409) setStatus('This lab already has an open opportunity in Wallet.');
      else if (response.status === 403) setStatus('Not allowed.');
      else if (response.status === 400) { requestId.current = crypto.randomUUID(); setStatus('Could not open the opportunity.'); }
      else setStatus('Could not open. Try again.');
    } catch {
      setStatus('Could not open. Try again.');
    } finally { setBusy(false); }
  }

  return <section aria-label="Prospect opportunity" className="space-y-2">
    <h4 className="text-xs text-sf-muted">{brandName} prospect</h4>
    {status && status !== 'Could not open. Try again.' ? <output className="text-sm text-sf-muted">{status}</output> : <><button type="button" className={button} disabled={busy} onClick={() => void openOpportunity()}>Open opportunity</button>{status ? <output className="text-sm text-sf-muted">{status}</output> : null}</>}
  </section>;
}
