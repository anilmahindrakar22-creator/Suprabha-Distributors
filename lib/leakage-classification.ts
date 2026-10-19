export const leakageReasonLabels = {
  unknown: 'Unknown / under review', competitor_sourcing: 'Competitor sourcing', lower_test_volume: 'Lower test volume',
  stock_timing: 'Stock buildup / order timing', downtime: 'Instrument downtime', service_issue: 'Service issue',
  supply_shortage: 'Supply shortage', pricing_pressure: 'Pricing / discount pressure', contract_noncompliance: 'Contract noncompliance',
  excess_foc: 'Excess FOC', mapping_data_issue: 'Mapping / data issue', product_substitution: 'Product substitution', other: 'Other',
} as const;
export type LeakageReasonCode = keyof typeof leakageReasonLabels;
export type LeakageClassification = { primaryReason?: LeakageReasonCode; reasonCodes?: LeakageReasonCode[]; confidence?: 'unknown' | 'suspected' | 'confirmed'; evidenceReference?: string };

export function buildLeakageClassification(form: FormData): Required<LeakageClassification> {
  const text = (value: FormDataEntryValue | null, fallback = '') => typeof value === 'string' ? value : fallback;
  const primaryReason = text(form.get('primaryReason'), 'unknown') as LeakageReasonCode;
  const reasonCodes = [...new Set([primaryReason, ...form.getAll('reasonCodes').map(value => text(value))])] as LeakageReasonCode[];
  const confidence = text(form.get('confidence'), 'unknown') as Required<LeakageClassification>['confidence'];
  const evidenceReference = text(form.get('evidenceReference')).trim();
  if (!Object.hasOwn(leakageReasonLabels, primaryReason) || reasonCodes.some(code => !Object.hasOwn(leakageReasonLabels, code))) throw new Error('Select supported leakage reasons.');
  if (!['unknown', 'suspected', 'confirmed'].includes(confidence)) throw new Error('Select a supported confidence level.');
  if (primaryReason === 'unknown' && confidence !== 'unknown') throw new Error('An unknown primary reason must keep unknown confidence.');
  if (confidence === 'confirmed' && evidenceReference.length < 3) throw new Error('Confirmed reasons require a supporting evidence reference.');
  if (reasonCodes.includes('unknown') && reasonCodes.length > 1) throw new Error('Remove Unknown from contributing reasons after selecting a classified reason.');
  return { primaryReason, reasonCodes, confidence, evidenceReference };
}
