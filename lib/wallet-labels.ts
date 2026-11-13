import type { ActionType } from '@/lib/wallet-action-types';
import type { ConstraintCategory } from '@/lib/wallet-diagnosis-types';
import type { PowerAlert, ContactAssessment, decisionRoles, legacyDecisionRoles } from '@/lib/account-types';

export const walletActionLabels: Record<ActionType, string> = { visit: 'Visit', demo: 'Demo', get_competitor_proof: 'Get competitor proof', add_product: 'Add product', fix_service: 'Fix service issue', fix_supply: 'Fix supply issue', instrument_proposal: 'Instrument proposal', credit_terms: 'Credit terms', price_review: 'Price review', no_action: 'No action (deliberate)' };
export const walletConstraintLabels: Record<ConstraintCategory, string> = { price: 'Price', portfolio: 'Portfolio gap', instrument: 'Instrument', service: 'Service', relationship: 'Relationship', credit: 'Credit', availability: 'Availability', clinical: 'Clinical', contract_tender: 'Contract / tender', competitor_lock_in: 'Competitor lock-in', unknown: 'Unknown' };
export const walletCurrentRoleLabels: Record<typeof decisionRoles[number], string> = { final_approver: 'Final approver', technical_decider: 'Technical decider', daily_orderer: 'Daily orderer', purchase_payments: 'Purchase & payments', user: 'User', gatekeeper: 'Gatekeeper', unknown: 'Unknown' };
export const walletRoleMeanings: Record<typeof decisionRoles[number], string> = {
  final_approver: 'Approves big purchases and payment terms', technical_decider: 'Chooses methods, kits and machines', daily_orderer: 'Decides and raises routine reagent orders',
  purchase_payments: 'Negotiates price, places orders, clears payments', user: 'Runs tests; their feedback on kits counts', gatekeeper: 'Controls who gets to meet the deciders', unknown: 'Not known yet; find out on the next visit',
};
export const walletLegacyRoleLabels: Record<typeof legacyDecisionRoles[number], string> = { decision_maker: 'Decision maker', influencer: 'Influencer', champion: 'Champion', technical_evaluator: 'Technical evaluator', coach: 'Coach' };
/** Current roles plus legacy ones; legacy labels are for read-only display and are never offered in a picker. */
export const walletRoleLabels: Record<ContactAssessment['decisionRole'], string> = { ...walletCurrentRoleLabels, ...walletLegacyRoleLabels };
export const walletStanceLabels: Record<ContactAssessment['stance'], string> = { champion: 'Champion', supporter: 'Supporter', neutral: 'Neutral', sceptical: 'Sceptical', blocker: 'Blocker', unknown: 'Unknown' };
export const walletStanceMeanings: Record<ContactAssessment['stance'], string> = {
  champion: 'Actively sells for us inside the lab', supporter: 'Favours us when asked', neutral: 'No lean either way', sceptical: 'Doubts us; needs convincing', blocker: 'Works against us', unknown: 'Not known yet',
};
export const walletPowerAlertLabels: Record<PowerAlert, string> = { no_decision_maker: 'No final approver known', decision_maker_not_met: 'Final approver or daily orderer not met in 60 days', influential_blocker: 'Influential blocker', influential_unknown: 'Influential person, stance unknown', no_influential_supporter: 'No influential supporter' };
