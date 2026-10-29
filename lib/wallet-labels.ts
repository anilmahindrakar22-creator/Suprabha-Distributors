import type { ActionType } from '@/lib/wallet-action-types';
import type { ConstraintCategory } from '@/lib/wallet-diagnosis-types';

export const walletActionLabels: Record<ActionType, string> = { visit: 'Visit', demo: 'Demo', get_competitor_proof: 'Get competitor proof', add_product: 'Add product', fix_service: 'Fix service issue', fix_supply: 'Fix supply issue', instrument_proposal: 'Instrument proposal', credit_terms: 'Credit terms', price_review: 'Price review', no_action: 'No action (deliberate)' };
export const walletConstraintLabels: Record<ConstraintCategory, string> = { price: 'Price', portfolio: 'Portfolio gap', instrument: 'Instrument', service: 'Service', relationship: 'Relationship', credit: 'Credit', availability: 'Availability', clinical: 'Clinical', contract_tender: 'Contract / tender', competitor_lock_in: 'Competitor lock-in', unknown: 'Unknown' };
