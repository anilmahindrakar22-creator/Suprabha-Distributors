'use client';

import { useState } from 'react';
import { CORRECTION_REASONS, correctionAppliesNow, type PurchaseOrder, type PurchaseOrderLine, type PendingCorrection, type CorrectionReason } from '@/lib/purchase-orders';
import { PurchaseOrderSheet, usePurchaseOrderWrite } from './purchase-orders-panel';

const primary = 'min-h-12 rounded-lg bg-sf-ink px-3 text-sm font-semibold text-sf-soft-0 disabled:opacity-50';
const input = 'min-h-11 w-full min-w-0 rounded-lg border border-sf-line bg-sf-soft-0 p-2 text-sf-body';
const date = (value: string) => new Date(value).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' });
const reasonLabel = (code: CorrectionReason) => CORRECTION_REASONS.find(reason => reason.code === code)?.label ?? code;
type SheetProps = { po: PurchaseOrder; onClose: () => void; onDone: (message: string) => void; onConflict: () => void };

export function CorrectionSheet({ po, line, onClose, onDone, onConflict }: SheetProps & { line: PurchaseOrderLine }) {
  const command = usePurchaseOrderWrite(onConflict);
  const [quantity, setQuantity] = useState(String(line.quantity));
  const [reasonCode, setReasonCode] = useState<CorrectionReason | ''>('');
  const [note, setNote] = useState('');
  const applies = correctionAppliesNow(po, line, Number(quantity));
  return <PurchaseOrderSheet title="Correct quantity" locked={command.locked} onClose={onClose}>
    <form className="min-w-0 space-y-3 text-sm [overflow-wrap:anywhere]" onSubmit={async event => {
      event.preventDefault();
      const body = await command.write('request_po_quantity_correction', { id: po.id, expectedVersion: po.version, itemKey: line.itemKey, quantity: Number(quantity), reasonCode, note: note.trim() });
      if (body) onDone(applies ? 'Quantity corrected' : 'Sent for approval');
    }}>
      <p className="font-semibold">{line.itemName}</p>
      <p className="text-sf-muted">Ordered {line.quantity} {line.unit} · received {line.receivedQuantity}{line.originalQuantity !== undefined && line.originalQuantity !== line.quantity ? ` · first ordered ${line.originalQuantity}` : ''}</p>
      <fieldset disabled={command.locked} className="min-w-0 space-y-3">
        <label className="block">New quantity<input className={input} type="number" min={Math.max(line.receivedQuantity, 0.000001)} max={1000000} step="any" required value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
        <fieldset className="min-w-0"><legend>Reason</legend>{CORRECTION_REASONS.map(reason => <label key={reason.code} className="flex min-h-11 items-center gap-2"><input type="radio" name="correction-reason" required value={reason.code} checked={reasonCode === reason.code} onChange={() => setReasonCode(reason.code)} />{reason.label}</label>)}</fieldset>
        <label className="block">Note<textarea className={input} minLength={3} maxLength={300} required value={note} onChange={event => setNote(event.target.value)} /></label>
      </fieldset>
      <p aria-live="polite" className="text-sf-muted">{applies ? 'This change applies now.' : po.sharedAt ? 'Already shared with the supplier. A manager must approve, then share the PO again.' : 'More than 20% above the first order. A manager must approve.'}</p>
      {command.error ? <p role="alert" className="text-sf-danger">{command.error}</p> : null}
      <button className={primary} disabled={command.busy || !reasonCode || note.trim().length < 3}>{command.busy ? 'Saving…' : command.locked ? 'Retry' : applies ? 'Save correction' : 'Send for approval'}</button>
    </form>
  </PurchaseOrderSheet>;
}

export function ReviewSheet({ po, request, onClose, onDone, onConflict }: SheetProps & { request: PendingCorrection }) {
  const command = usePurchaseOrderWrite(onConflict);
  const [note, setNote] = useState('');
  const line = po.lines.find(line => line.itemKey === request.itemKey);
  const [lastDecision, setLastDecision] = useState<'approve' | 'reject'>('approve');
  async function decide(decision: 'approve' | 'reject') {
    if (!command.locked) setLastDecision(decision);
    const body = await command.write('decide_po_quantity_correction', { requestId: request.requestId, expectedVersion: po.version, decision, ...(note.trim() ? { note: note.trim() } : {}) });
    if (body) onDone((command.locked ? lastDecision : decision) === 'approve' ? 'Correction approved' : 'Correction rejected');
  }
  return <PurchaseOrderSheet title="Review correction" locked={command.locked} onClose={onClose}>
    <div className="min-w-0 space-y-3 text-sm [overflow-wrap:anywhere]">
      <p>{line?.itemName ?? request.itemKey}: {request.fromQuantity} → {request.toQuantity} {line?.unit}</p>
      <p>{reasonLabel(request.reasonCode)}</p><p className="whitespace-pre-wrap">{request.note}</p>
      <p className="text-sf-muted">Asked by {request.requestedByEmail} · {date(request.requestedAt)}</p>
      <label className="block">Note<textarea className={input} maxLength={300} disabled={command.locked} value={note} onChange={event => setNote(event.target.value)} /></label>
      {po.sharedAt ? <p className="text-sf-muted">Approving marks this PO Re-send needed.</p> : null}
      {command.error ? <p role="alert" className="text-sf-danger">{command.error}</p> : null}
      <div className="flex flex-wrap gap-2"><button className={primary} disabled={command.busy} onClick={() => void decide('approve')}>{command.busy ? 'Saving…' : command.locked ? 'Retry' : 'Approve'}</button><button className="min-h-11 px-3 font-semibold text-sf-danger disabled:opacity-50" disabled={command.locked} onClick={() => void decide('reject')}>Reject</button></div>
    </div>
  </PurchaseOrderSheet>;
}

export function ConfirmSupplierSheet({ po, onClose, onDone, onConflict }: SheetProps) {
  const command = usePurchaseOrderWrite(onConflict);
  const [note, setNote] = useState('');
  return <PurchaseOrderSheet title="Supplier confirmed" locked={command.locked} onClose={onClose}>
    <form className="min-w-0 space-y-3 text-sm [overflow-wrap:anywhere]" onSubmit={async event => {
      event.preventDefault();
      const body = await command.write('confirm_purchase_order_supplier', { id: po.id, expectedVersion: po.version, ...(note.trim() ? { note: note.trim() } : {}) });
      if (body) onDone('Supplier confirmation recorded');
    }}>
      <p>Record that {po.supplierName} confirmed this PO.</p>
      <label className="block">Note<textarea className={input} maxLength={200} disabled={command.locked} value={note} onChange={event => setNote(event.target.value)} /></label>
      {command.error ? <p role="alert" className="text-sf-danger">{command.error}</p> : null}
      <button className={primary} disabled={command.busy}>{command.busy ? 'Saving…' : command.locked ? 'Retry' : 'Record confirmation'}</button>
    </form>
  </PurchaseOrderSheet>;
}

export function CorrectionHistory({ po }: { po: PurchaseOrder }) {
  return <ul aria-label="Correction history" className="min-w-0 space-y-2 text-xs text-sf-muted [overflow-wrap:anywhere]">{po.corrections?.map((correction, index) => <li key={index}>{po.lines.find(line => line.itemKey === correction.itemKey)?.itemName ?? correction.itemKey}: {correction.fromQuantity} → {correction.toQuantity} · {reasonLabel(correction.reasonCode)} · {date(correction.recordedAt)}{correction.approvedByEmail ? ` · approved by ${correction.approvedByEmail}` : ''}</li>)}</ul>;
}
