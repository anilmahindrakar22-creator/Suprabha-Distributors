import type { ActionType } from '@/lib/wallet-action-types';
import type { ConstraintCategory } from '@/lib/wallet-diagnosis-types';
import type { PowerAlert, ContactAssessment } from '@/lib/account-types';

export const walletActionLabels: Record<ActionType, string> = { visit: 'Visit', demo: 'Demo', get_competitor_proof: 'Get competitor proof', add_product: 'Add product', fix_service: 'Fix service issue', fix_supply: 'Fix supply issue', instrument_proposal: 'Instrument proposal', credit_terms: 'Credit terms', price_review: 'Price review', no_action: 'No action (deliberate)' };
export const walletConstraintLabels: Record<ConstraintCategory, string> = { price: 'Price', portfolio: 'Portfolio gap', instrument: 'Instrument', service: 'Service', relationship: 'Relationship', credit: 'Credit', availability: 'Availability', clinical: 'Clinical', contract_tender: 'Contract / tender', competitor_lock_in: 'Competitor lock-in', unknown: 'Unknown' };
export const walletRoleLabels: Record<ContactAssessment['decisionRole'], string> = { decision_maker: 'Decision maker', champion: 'Champion', influencer: 'Influencer', technical_evaluator: 'Technical evaluator', user: 'User', gatekeeper: 'Gatekeeper', coach: 'Coach', unknown: 'Unknown' };
export const walletPowerAlertLabels: Record<PowerAlert, string> = { no_decision_maker: 'No decision maker known', decision_maker_not_met: 'Decision maker not met in 60 days', influential_blocker: 'Influential blocker', influential_unknown: 'Influential person, stance unknown', no_influential_supporter: 'No influential supporter' };
