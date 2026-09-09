# Suprabha OS operating model and adoption framework

## Purpose

Suprabha OS succeeds only when it becomes the normal way the business is run every day. This framework converts the product roadmap into an operating model for users and management. It is a future-governance design and must not expand or delay the current Phase 3 pilot/hardening gate.

## 1. Role-based Today / Action Center

Every role should start from a small, prioritized work queue rather than navigating multiple dashboards to discover what needs attention.

### Management / Owner
Surface only material exceptions and decisions requiring management action, such as:
- Strategic A/B account wallet loss or material account-health deterioration.
- Material 60+/90+ receivables and credit exceptions.
- Critical service failures or unresolved high-priority tickets.
- Placement/capital approvals and deteriorating placement economics.
- Large stalled opportunities, competitor threats and replacement windows.
- Billing, reconciliation, fulfilment or delivery exceptions above configured thresholds.

### Salesperson
The default Today view should prioritize a short actionable list, for example:
- Follow-ups due today/overdue.
- High-value opportunities with a required next action.
- A/B accounts with wallet-share decline or material untapped wallet.
- Upcoming competitor instrument replacement/renewal windows.
- Collection actions assigned to the salesperson.
- Service issues threatening commercial relationships.
- Strategic account intelligence requiring verification.

### Order Desk / Operations
- New orders requiring validation/confirmation.
- Billing/reconciliation exceptions.
- Fulfilment, dispatch and delivery actions due.
- Orders on hold and overdue operational actions.
- Connector/synchronization failures affecting current work.

### Accounts
- Tally reconciliation exceptions.
- Receivables and collection actions.
- Credit-limit/hold exceptions.
- Pricing or commercial approvals requiring accounts review.

### Service
- New/open tickets prioritized by severity and strategic-account impact.
- SLA-risk and overdue tickets.
- Preventive-maintenance actions due.
- Repeat failures and equipment with recurring downtime.

**Design rule:** the Today screen is an action surface, not another KPI dashboard. Every item must state what happened, why it matters, who owns it, the required next action and due date where applicable.

## 2. Deterministic Next Best Action engine

Initial recommendations must be rule-based, explainable, versioned and auditable. AI decision automation remains deferred.

Candidate rules include:
- Wallet share below configured threshold plus high untapped wallet -> Account Capture Review.
- Wallet share falls materially over the governed comparison period -> Account-at-Risk Review.
- Qualified opportunity has no meaningful activity beyond configured days -> Follow-up / Stalled Opportunity action.
- Replacement or renewal window enters configured horizon -> Commercial Opportunity action.
- Expected reagent consumption materially exceeds actual governed consumption proxy -> Leakage Investigation.
- Invoice/receivable crosses configured ageing threshold -> Collection action/escalation.
- Service ticket crosses SLA or severity threshold -> Service escalation.
- Critical stock-out affects recorded demand -> Procurement/availability attention signal without creating a competing inventory transaction in StockFlow.
- Strategic account intelligence exceeds freshness threshold -> Data Verification action.

Every generated action must retain rule/version, source records, created time, owner, priority, status, due date where applicable, completion/outcome and override/dismissal reason.

## 3. Exception-driven management

Management should manage exceptions rather than inspect every transaction. The Command Center should surface a governed Attention Queue for material conditions such as:
- A/B wallet at risk.
- Large wallet-share decline or wallet lost.
- 90+ day receivables.
- Reagent/wallet leakage.
- Placement payback deterioration versus approved business case.
- Critical service/downtime risk.
- High-value stalled opportunities.
- Material Tally reconciliation failures.
- Delivery failures affecting strategic customers.

Thresholds must be configurable management policy and versioned so historical alerts remain explainable. Users must be able to drill from exception -> evidence -> responsible owner -> action -> resolution.

## 4. Data ownership and stewardship

Every decision-critical data domain must have a named business owner and canonical source. Initial operating ownership guideline:

| Data/domain | Canonical source / proposed owner |
| --- | --- |
| Customer identity/master | Suprabha OS customer master; Order Desk/Accounts stewardship |
| Sales invoices/revenue | Tally; Accounts stewardship |
| Inventory/stock | Tally; Operations/Accounts stewardship |
| Receivables/collections | Tally; Accounts stewardship |
| Wallet estimate/division wallet | Suprabha OS intelligence; Salesperson maintains, Sales Manager/Management verifies material estimates |
| Opportunities/activities | Suprabha OS CRM; Salesperson |
| Installed equipment | Suprabha OS installed-base register; Service/Sales stewardship |
| Service events | Suprabha OS service module; Service |
| Stakeholder/Power Map | Suprabha OS CRM/contact intelligence; Salesperson |
| Pricing/GP policy | Governed commercial/accounting source; Accounts/Management |
| KPI definitions | KPI registry; Management-approved owner per KPI |

No user should maintain the same business truth independently in spreadsheets, notebooks, WhatsApp and Suprabha OS when the system provides its canonical location. External communication tools may remain communication channels but not competing systems of record.

## 5. Strategic data coverage and freshness

Estimated and observational intelligence must visibly distinguish fresh evidence from stale or unknown information.

Add governed metrics:
- **Strategic Data Coverage %** = A/B accounts with the minimum required intelligence fields populated / targeted A/B accounts.
- **Strategic Data Freshness %** = A/B accounts whose required intelligence has been verified within the configured freshness window / targeted A/B accounts.
- Coverage/freshness should drill down by salesperson, territory, account and intelligence type.
- Each estimate/observation should expose confidence, source/method where relevant, last verified date and verifier/recorder.
- Unknown or stale intelligence must never silently appear as current verified fact.

Initial freshness policies may differ by field; for example wallet estimates and key stakeholder maps may require more frequent verification than stable address information. Policies remain configurable and versioned.

## 6. SOP-to-system mapping

Every material real-world business event must have one canonical system action.

| Real-world event | Canonical system action |
| --- | --- |
| Phone/customer order | Create/confirm order |
| Tally billing | Reconcile/link invoice/voucher |
| Warehouse fulfilment | Record fulfilment evidence |
| Courier/transport leaves | Dispatch |
| Customer receives goods | Delivery confirmation |
| Payment/receivable change | Tally sync/reconciliation |
| Customer complaint/equipment issue | Service ticket |
| Sales visit/call | CRM activity |
| Commercial opportunity | Opportunity + explicit next action |
| Instrument installation | Installation -> installed-base record |
| Strategic intelligence learned | Update governed customer/opportunity intelligence with evidence/freshness |

For each workflow, the implementation SOP should define responsible role, trigger, required fields, SLA/timing, exception path and evidence of completion.

## 7. Management cadence

Suprabha OS should eventually run the management rhythm rather than merely provide reports.

### Daily — approximately 10 minutes
Operational exceptions only: orders, billing/reconciliation, fulfilment/dispatch/delivery, critical service, urgent collections and system/integration failures.

### Weekly — approximately 30–45 minutes
Commercial execution: qualified pipeline, stalled opportunities, wallet gained/lost, A/B accounts at risk, stock/service issues affecting sales, key collection actions and next-week priorities.

### Monthly — approximately 60–90 minutes
Suprabha 80 strategic-account review: wallet, share, capture gap, GP, receivable exposure, Account Health, competitor position, Power Map, opportunities, next action and capital required for priority A accounts and escalated B accounts.

### Quarterly
Portfolio and capital review: division/brand/principal performance, territory performance, placements, capital efficiency/ROCE, inventory exposure, principal support, resource allocation and strategic priorities.

**Meeting rule:** every review should end in accountable actions with owner and due date; meeting notes alone are not completion.

## 8. Phased adoption and change management

Do not launch the full future vision simultaneously. Adoption should follow the transactional spine and earn trust before adding intelligence complexity.

### Adoption Phase 1 — Transaction trust
Order -> Tally billing/reconciliation -> fulfilment -> dispatch -> delivery.

Success evidence: users can process normal daily orders without manual database intervention; exceptions are visible; duplicate work is prevented; the team trusts transaction status.

### Adoption Phase 2 — Customer and daily sales execution
Customer master -> CRM activities -> follow-ups -> Today/Action Center.

Success evidence: sales users rely on the system for their daily follow-up queue and management can see overdue/stalled actions without separate spreadsheets.

### Adoption Phase 3 — Installed base and service
Instrument register -> service tickets -> PM -> consumption/uptime evidence.

Success evidence: installed-base and service status are operationally trustworthy and recurring service work is managed through the system.

### Adoption Phase 4 — Suprabha 80
A/B classification -> governed wallet estimates -> division wallet -> wallet share -> capture gap -> Account Health.

Success evidence: management uses the system in monthly strategic-account reviews and wallet estimates meet coverage/freshness standards.

### Adoption Phase 5 — Territory and stakeholder intelligence
Territory Map -> competitor installed base -> Power Map -> Social Styles/communication guidance.

Success evidence: account planning uses verified intelligence and produces explicit commercial actions rather than passive profiles.

### Adoption Phase 6 — Management operating system
Command Center -> exception management -> capital allocation -> principal/portfolio reviews.

Success evidence: recurring management reviews use canonical Suprabha OS metrics and actions rather than manually assembled parallel reports.

## 9. Adoption KPIs

Implementation success must be measured, not assumed. Candidate adoption metrics:
- % of eligible orders processed end-to-end through the governed workflow.
- % of required workflow events recorded within SLA.
- Active users by role and frequency appropriate to role.
- % of salesperson follow-ups/actions completed through the system.
- Overdue action count/value.
- Strategic Data Coverage % and Freshness %.
- % of management reviews conducted from canonical system data without manual parallel reporting.
- Number/value of unresolved exceptions by age.
- Duplicate/manual correction rate for critical workflows.
- User-reported friction and average time for high-frequency tasks, measured during pilots.

Adoption metrics are diagnostic and must not incentivize meaningless clicks or data entry. Measure business-process completion and data quality rather than raw login counts alone.

## 10. Implementation guardrails

- Keep high-frequency tasks fast; minimize mandatory fields at the point of work.
- Progressive disclosure: show users only what their role needs for the current decision.
- Mobile-responsive workflows are important for sales/service even while native mobile apps remain deferred.
- Every critical action must have server-side authorization, auditability and appropriate idempotency.
- Preserve Tally as the inventory/accounting authority where defined; do not create parallel truth for convenience.
- Do not automate a recommendation until its rule and source data can be explained to the affected user.
- New modules should not proceed merely because they are on the roadmap; each adoption phase needs explicit exit evidence.

## Definition of successful implementation

Suprabha OS is successfully implemented when users no longer need to reconstruct the state of the business from calls, WhatsApp, notebooks and disconnected spreadsheets; each role can see the work that requires action; management sees material exceptions and strategic decisions; canonical data is fresh enough to trust; and recurring operating reviews produce accountable actions from the system.
