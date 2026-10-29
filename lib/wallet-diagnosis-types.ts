export type OpportunityKind = 'capture' | 'defend' | 'recover';
export type OpportunityOutcome = 'won' | 'lost' | 'dropped';
export type ConstraintCategory = 'price' | 'portfolio' | 'instrument' | 'service' | 'relationship' | 'credit' | 'availability' | 'clinical' | 'contract_tender' | 'competitor_lock_in' | 'unknown';
export type ConstraintConfidence = 'high' | 'medium' | 'low';
export type WalletConstraint = { id: string; category: ConstraintCategory; evidence: string; confidence: ConstraintConfidence; recordedBy: string; recordedAt: string };
export type WalletOpportunity = {
  id: string; customerId: string; kind: OpportunityKind; openedReason: string; openedBy: string; openedAt: string;
  closure: { outcome: OpportunityOutcome; reason: string; closedBy: string; closedAt: string } | null;
  constraint: WalletConstraint | null; history: WalletConstraint[];
};
export type WalletDiagnosisRow = { customerId: string; kind: OpportunityKind; category: ConstraintCategory | null; confidence: ConstraintConfidence | null };
export type WalletDiagnoses = { rows: WalletDiagnosisRow[]; undiagnosedFocusCount: number | null; focusCount: number | null };
export type WalletDiagnosisCommand =
  | { action: 'get_wallet_diagnoses'; payload: { customerIds: string[] } }
  | { action: 'get_account_opportunities'; payload: { customerId: string } }
  | { action: 'open_opportunity'; payload: { requestId: string; customerId: string; kind: OpportunityKind; reason: string } }
  | { action: 'record_constraint'; payload: { requestId: string; opportunityId: string; category: ConstraintCategory; evidence: string; confidence: ConstraintConfidence; expectedCurrentConstraintId: string | null } }
  | { action: 'close_opportunity'; payload: { requestId: string; opportunityId: string; outcome: OpportunityOutcome; reason: string } };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const kinds: OpportunityKind[] = ['capture', 'defend', 'recover'];
const outcomes: OpportunityOutcome[] = ['won', 'lost', 'dropped'];
const categories: ConstraintCategory[] = ['price', 'portfolio', 'instrument', 'service', 'relationship', 'credit', 'availability', 'clinical', 'contract_tender', 'competitor_lock_in', 'unknown'];
const confidences: ConstraintConfidence[] = ['high', 'medium', 'low'];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, min: number, max: number) => typeof value === 'string' && value.length >= min && value.length <= max;
const fail = (): never => { throw new Error('Invalid wallet diagnosis request'); };

export function validateWalletDiagnosisCommand(input: unknown): WalletDiagnosisCommand {
  if (!object(input) || !object(input.payload) || typeof input.action !== 'string') return fail();
  const p = input.payload;
  switch (input.action) {
    case 'get_wallet_diagnoses':
      if (!Array.isArray(p.customerIds) || p.customerIds.length > 50 || !p.customerIds.every(id => typeof id === 'string' && uuid.test(id)) || new Set(p.customerIds).size !== p.customerIds.length) return fail();
      return { action: input.action, payload: { customerIds: p.customerIds as string[] } };
    case 'get_account_opportunities':
      if (typeof p.customerId !== 'string' || !uuid.test(p.customerId)) return fail();
      return { action: input.action, payload: { customerId: p.customerId } };
    case 'open_opportunity':
      if (typeof p.requestId !== 'string' || !uuid.test(p.requestId) || typeof p.customerId !== 'string' || !uuid.test(p.customerId) || !kinds.includes(p.kind as OpportunityKind) || !text(p.reason, 3, 500)) return fail();
      return { action: input.action, payload: p as unknown as Extract<WalletDiagnosisCommand, { action: 'open_opportunity' }>['payload'] };
    case 'record_constraint':
      if (typeof p.requestId !== 'string' || !uuid.test(p.requestId) || typeof p.opportunityId !== 'string' || !uuid.test(p.opportunityId) || !categories.includes(p.category as ConstraintCategory) || !text(p.evidence, 3, 1000) || !confidences.includes(p.confidence as ConstraintConfidence) || !(p.expectedCurrentConstraintId === null || (typeof p.expectedCurrentConstraintId === 'string' && uuid.test(p.expectedCurrentConstraintId)))) return fail();
      return { action: input.action, payload: p as unknown as Extract<WalletDiagnosisCommand, { action: 'record_constraint' }>['payload'] };
    case 'close_opportunity':
      if (typeof p.requestId !== 'string' || !uuid.test(p.requestId) || typeof p.opportunityId !== 'string' || !uuid.test(p.opportunityId) || !outcomes.includes(p.outcome as OpportunityOutcome) || !text(p.reason, 3, 500)) return fail();
      return { action: input.action, payload: p as unknown as Extract<WalletDiagnosisCommand, { action: 'close_opportunity' }>['payload'] };
    default: return fail();
  }
}
