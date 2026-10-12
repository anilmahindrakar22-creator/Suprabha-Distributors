import { leakageReasonLabels, type LeakageClassification } from '@/lib/leakage-classification';

export function LeakageClassificationFields({ classification = {} }: { classification?: LeakageClassification }) {
  const style = 'min-h-10 w-full min-w-0 rounded-lg border border-sf-line bg-white px-3 text-sm';
  return <fieldset className="grid gap-3 rounded-xl border border-sf-line-soft p-3 sm:col-span-full">
    <legend className="px-1 text-sm font-bold">Reason classification</legend>
    <label className="grid gap-1 text-xs font-semibold">Primary reason<select name="primaryReason" defaultValue={classification.primaryReason ?? 'unknown'} className={style}>{Object.entries(leakageReasonLabels).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
    <label className="grid gap-1 text-xs font-semibold">Reason confidence<select name="confidence" defaultValue={classification.confidence ?? 'unknown'} className={style}><option value="unknown">Unknown</option><option value="suspected">Suspected</option><option value="confirmed">Confirmed with evidence</option></select></label>
    <label className="grid gap-1 text-xs font-semibold">Classification evidence reference<input name="evidenceReference" defaultValue={classification.evidenceReference ?? ''} maxLength={2000} className={style} /></label>
    <details><summary className="min-h-10 cursor-pointer text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-brand">Additional contributing reasons</summary><div className="grid gap-2 sm:grid-cols-2">{Object.entries(leakageReasonLabels).filter(([code]) => code !== 'unknown').map(([code, label]) => <label key={code} className="flex min-h-10 items-center gap-2 text-xs"><input type="checkbox" name="reasonCodes" value={code} defaultChecked={classification.reasonCodes?.includes(code as keyof typeof leakageReasonLabels) ?? false} />{label}</label>)}</div></details>
    <p className="text-xs leading-5 text-sf-muted">A supply gap does not prove competitor sourcing. Confirmed reasons require evidence; contributing reasons do not split the estimated financial gap.</p>
  </fieldset>;
}
