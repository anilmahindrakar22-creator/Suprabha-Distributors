export type OpportunityKind = 'capture' | 'defend' | 'recover';
export type OpportunityOutcome = 'won' | 'lost' | 'dropped';
export type ConstraintCategory = 'price' | 'portfolio' | 'instrument' | 'service' | 'relationship' | 'credit' | 'availability' | 'clinical' | 'contract_tender' | 'competitor_lock_in' | 'unknown';
export type ConstraintConfidence = 'high' | 'medium' | 'low';
export type EvidenceSource = 'document' | 'customer_stated' | 'our_view';
export type ConstraintFacts =
  | { category: 'price'; competitor: string; product: string; competitorPricePaise: number; ourPricePaise: number }
  | { category: 'portfolio'; product: string; division: string }
  | { category: 'instrument'; analyser: string; owner: 'customer' | 'competitor_placed' | 'rental' | 'unknown'; closedSystem: 'yes' | 'no' | 'unknown'; division: string }
  | { category: 'service'; issue: string; since: string }
  | { category: 'availability'; product: string; issue: string }
  | { category: 'credit'; issue: string }
  | { category: 'relationship'; decisionMaker: string; issue: string; contactId?: string }
  | { category: 'clinical'; issue: string }
  | { category: 'contract_tender'; holder: string; endsOn: string }
  | { category: 'competitor_lock_in'; competitor: string; endsOn: string }
  | { category: 'unknown'; nextQuestion: string; askBy: string };
export type WalletConstraint = { id: string; category: ConstraintCategory; evidence: string; confidence: ConstraintConfidence; recordedBy: string; recordedAt: string; source: EvidenceSource; sourcePerson: string | null; observedOn: string; facts: Omit<ConstraintFacts, 'category'>; contactName?: string | null; priceUnproven: boolean; gapPermille: number | null };
export type WalletOpportunity = {
  id: string; customerId: string; kind: OpportunityKind; openedReason: string; openedBy: string; openedAt: string;
  closure: { outcome: OpportunityOutcome; reason: string; closedBy: string; closedAt: string } | null;
  constraint: WalletConstraint | null; history: WalletConstraint[];
};
export type WalletDiagnosisRow = { customerId: string; kind: OpportunityKind; category: ConstraintCategory | null; confidence: ConstraintConfidence | null; priceUnproven: boolean };
export type WalletDiagnoses = { rows: WalletDiagnosisRow[]; undiagnosedFocusCount: number | null; focusCount: number | null; focusWithoutDecisionMaker?: number | null };
export type WalletSignals = { priceExceptions90d: number; deliveryProblems90d: number; deliveryProblemsOpen: number; serviceTicketsOpen: number; serviceTickets90d: number; ourInstallations: number; lastVisitOn: string | null; powerAlerts?: string[]; decisionMakerLastMetOn?: string | null };
type FactsWithoutCategory = Omit<ConstraintFacts, 'category'>;
export type WalletDiagnosisCommand =
  | { action: 'get_wallet_diagnoses'; payload: { customerIds: string[] } }
  | { action: 'get_account_opportunities'; payload: { customerId: string } }
  | { action: 'get_account_signals'; payload: { customerId: string } }
  | { action: 'open_opportunity'; payload: { requestId: string; customerId: string; kind: OpportunityKind; reason: string } }
  | { action: 'record_constraint'; payload: { requestId: string; opportunityId: string; category: ConstraintCategory; facts: FactsWithoutCategory; evidence: string; source: EvidenceSource; sourcePerson: string | null; observedOn: string; expectedCurrentConstraintId: string | null } }
  | { action: 'close_opportunity'; payload: { requestId: string; opportunityId: string; outcome: OpportunityOutcome; reason: string } };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const kinds: OpportunityKind[] = ['capture', 'defend', 'recover'];
const outcomes: OpportunityOutcome[] = ['won', 'lost', 'dropped'];
const categories: ConstraintCategory[] = ['price', 'portfolio', 'instrument', 'service', 'relationship', 'credit', 'availability', 'clinical', 'contract_tender', 'competitor_lock_in', 'unknown'];
const sources: EvidenceSource[] = ['document', 'customer_stated', 'our_view'];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, min: number, max: number) => typeof value === 'string' && value.trim() === value && value.length >= min && value.length <= max;
const fail = (): never => { throw new Error('Invalid wallet diagnosis request'); };
const isoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const textFact = (v: unknown) => text(v, 2, 200);
function validFacts(category: ConstraintCategory, facts: unknown): facts is FactsWithoutCategory {
  if (!object(facts)) return false;
  const date = todayIST();
  const validDate = (v: unknown) => isoDate(v);
  switch (category) {
    case 'price': return exactKeys(facts, ['competitor','product','competitorPricePaise','ourPricePaise']) && textFact(facts.competitor) && textFact(facts.product) && [facts.competitorPricePaise, facts.ourPricePaise].every(v => Number.isSafeInteger(v) && (v as number) >= 1 && (v as number) <= 9e13);
    case 'portfolio': return exactKeys(facts, ['product','division']) && textFact(facts.product) && text(facts.division, 1, 80);
    case 'instrument': return exactKeys(facts, ['analyser','owner','closedSystem','division']) && textFact(facts.analyser) && ['customer','competitor_placed','rental','unknown'].includes(String(facts.owner)) && ['yes','no','unknown'].includes(String(facts.closedSystem)) && text(facts.division, 1, 80);
    case 'service': return exactKeys(facts, ['issue','since']) && textFact(facts.issue) && validDate(facts.since);
    case 'availability': return exactKeys(facts, ['product','issue']) && textFact(facts.product) && textFact(facts.issue);
    case 'credit': return exactKeys(facts, ['issue']) && textFact(facts.issue);
    case 'relationship': return (exactKeys(facts, ['decisionMaker','issue']) || (exactKeys(facts, ['decisionMaker','issue','contactId']) && typeof facts.contactId === 'string' && uuid.test(facts.contactId))) && textFact(facts.decisionMaker) && textFact(facts.issue);
    case 'clinical': return exactKeys(facts, ['issue']) && textFact(facts.issue);
    case 'contract_tender': return exactKeys(facts, ['holder','endsOn']) && textFact(facts.holder) && validDate(facts.endsOn);
    case 'competitor_lock_in': return exactKeys(facts, ['competitor','endsOn']) && textFact(facts.competitor) && validDate(facts.endsOn);
    case 'unknown': return exactKeys(facts, ['nextQuestion','askBy']) && textFact(facts.nextQuestion) && isoDate(facts.askBy) && facts.askBy >= date;
  }
}
function validRecordPayload(p: Record<string, unknown>): boolean {
  const category = p.category as ConstraintCategory;
  return exactKeys(p, ['requestId','opportunityId','category','facts','evidence','source','sourcePerson','observedOn','expectedCurrentConstraintId'])
    && typeof p.requestId === 'string' && uuid.test(p.requestId) && typeof p.opportunityId === 'string' && uuid.test(p.opportunityId)
    && categories.includes(category) && validFacts(category, p.facts) && text(p.evidence, 3, 1000)
    && sources.includes(p.source as EvidenceSource)
    && (p.source === 'customer_stated' ? text(p.sourcePerson, 2, 120) : p.sourcePerson === null)
    && isoDate(p.observedOn) && p.observedOn <= todayIST() && p.observedOn >= `${Number(todayIST().slice(0, 4)) - 2}${todayIST().slice(4)}`
    && (p.expectedCurrentConstraintId === null || (typeof p.expectedCurrentConstraintId === 'string' && uuid.test(p.expectedCurrentConstraintId)));
}
export function validateWalletDiagnosisCommand(input: unknown): WalletDiagnosisCommand {
  if (!object(input) || !object(input.payload) || typeof input.action !== 'string' || !exactKeys(input, ['action','payload'])) return fail();
  const p = input.payload;
  switch (input.action) {
    case 'get_wallet_diagnoses':
      if (!exactKeys(p, ['customerIds']) || !Array.isArray(p.customerIds) || p.customerIds.length > 50 || !p.customerIds.every(id => typeof id === 'string' && uuid.test(id)) || new Set(p.customerIds).size !== p.customerIds.length) return fail();
      return { action: input.action, payload: { customerIds: p.customerIds as string[] } };
    case 'get_account_opportunities': case 'get_account_signals':
      if (!exactKeys(p, ['customerId']) || typeof p.customerId !== 'string' || !uuid.test(p.customerId)) return fail();
      return { action: input.action, payload: { customerId: p.customerId } };
    case 'open_opportunity':
      if (!exactKeys(p, ['requestId','customerId','kind','reason']) || typeof p.requestId !== 'string' || !uuid.test(p.requestId) || typeof p.customerId !== 'string' || !uuid.test(p.customerId) || !kinds.includes(p.kind as OpportunityKind) || !text(p.reason, 3, 500)) return fail();
      return { action: input.action, payload: p as unknown as Extract<WalletDiagnosisCommand, { action: 'open_opportunity' }>['payload'] };
    case 'record_constraint': if (!validRecordPayload(p)) return fail(); return { action: input.action, payload: p as unknown as Extract<WalletDiagnosisCommand, { action: 'record_constraint' }>['payload'] };
    case 'close_opportunity':
      if (!exactKeys(p, ['requestId','opportunityId','outcome','reason']) || typeof p.requestId !== 'string' || !uuid.test(p.requestId) || typeof p.opportunityId !== 'string' || !uuid.test(p.opportunityId) || !outcomes.includes(p.outcome as OpportunityOutcome) || !text(p.reason, 3, 500)) return fail();
      return { action: input.action, payload: p as unknown as Extract<WalletDiagnosisCommand, { action: 'close_opportunity' }>['payload'] };
    default: return fail();
  }
}
