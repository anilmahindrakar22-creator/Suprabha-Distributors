# Suprabha OS delivery roadmap

The roadmap grows one transactional spine. It is not authorization to build every listed domain simultaneously.

The current detailed requirements, acceptance gates and ordered recovery slices are in [Requirements and delivery plan](REQUIREMENTS-AND-DELIVERY-PLAN.md). That plan takes precedence over conflicting historical milestone wording below. Next implementation: durable connector recovery (R1), after the R0 deployment and measurement audit.

## Current baseline — StockFlow OMS Phase 3

Preserve and release the existing order flow, Tally catalog/customer lookup, fulfilment data, audit history, user management, delivery exceptions, installation/commissioning and operations dashboard. Phase 3 is complete only after the feature branch passes CI, review and an explicitly approved production release.

## Milestone 1 — Core hardening

**Goal:** make current OMS commands safe foundations for inventory and future modules.

- Central permission and row-scope policy.
- Central order-transition policy with obsolete reservation states removed from the active path.
- Idempotency for every mutation, not only order creation.
- Structured before/after audit payloads with request IDs.
- Database-enforced prohibition of hard deletion for business records.
- Constraint, concurrency and rollback integration tests.

**Exit gate:** two simultaneous users cannot overwrite an order; repeated commands cannot duplicate work; every critical change is attributable.

## Milestone 2 — Tally inventory boundary and delivery integrity

**Goal:** keep Tally Prime as the only inventory authority while StockFlow controls the order-to-delivery workflow.

- Read the complete product catalog and stock snapshot from Tally.
- Do not enter, reserve, allocate or adjust stock in StockFlow.
- Record fulfilment quantities without claiming that Tally stock is booked.
- Capture dispatch docket, transporter, date and optional vehicle.
- Capture delivery time, receiver and optional proof-of-delivery reference.
- Preserve idempotency, database constraints and audit history for every OMS step.

**Exit gate:** an order reaches delivery with evidence and a complete user log, while every inventory transaction remains in Tally.

## Milestone 3 — Tally billing reconciliation

- Transactional outbox worker with acknowledgement, retry and dead-letter visibility.
- Idempotent Tally invoice handoff and external voucher ID.
- Match OMS orders to Tally sales vouchers without writing stock from StockFlow.
- Surface unmatched or conflicting invoice references for accounts.
- Retain partial fulfilment and dispatch/delivery closure audit.

**Current slice:** the connector exports read-only voucher identity and billed orders show verified, unmatched or awaiting-sync status.

**Local next-release work:** reuse cached sales-voucher lines to compare exact Tally item names and aggregated quantities, display differences separately from invoice identity, and let authorised Accounts/Operations users record an immutable reconciliation review. This does not query or write Tally during browser use.

**Exit gate:** an order reaches billing and dispatch once, with verified customer/invoice identity and recoverable integration failures. Batch records remain in Tally.

## Immediate priority — lightweight recovery

Feature delivery now proceeds before the remaining [lightweight recovery work](LIGHTWEIGHT-RECOVERY.md), while every new slice must preserve the same-app, Tally-source-of-truth boundary. Performance improvements remain the next dedicated stream after the agreed features. Do not describe the OMS as fully offline-capable until reconnect and account-isolation tests pass.

## Milestone 4 — Installed-base and service operations

- Installed-equipment register derived from completed order installations.
- Promote installation records into canonical instruments/assets.
- Ownership, placement, warranty and contract.
- Service ticket logging and resolution linked to installed equipment, with priority, server-side permissions and immutable activity history (foundation delivered locally; visits, parts and downtime remain).
- Preventive-maintenance queue.
- Estimated reagent consumption gap, clearly labelled as an estimate.

## Milestone 5 — Customer, commercial and finance controls

- Expanded customer master with duplicate controls, contacts, addresses and assignments.
- Credit policy and Tally receivables reconciliation.
- Customer-specific pricing and approval thresholds.
- CRM/quotations and salesperson row scope.
- Placement approval and recorded overrides.

## Milestone 6 — Governed intelligence and external access

- KPI registry containing definition, formula, source, time range, refresh and drill-down.
- Command Center built only on verified transactional data.
- Forecasting and opportunity scoring with method/confidence metadata.
- Future customer interface using the same API, identity, customer, catalog and order engine.

### Suprabha 80 — Strategic Account Dominance Framework

Suprabha 80 is the future governing commercial-intelligence model for increasing wallet share across strategically important A- and B-class accounts. It defines measurement and decision rules now; it does not authorize implementation before the current Phase 3 pilot/hardening gates are complete.

**North-star KPI:** A+B weighted wallet share, calculated from canonical Suprabha revenue and governed addressable-wallet estimates. The strategic destination is at least 80% wallet share across targeted A/B accounts; intermediate targets must be based on measured baseline data rather than invented assumptions.

#### A/B account classification

- Classify strategic accounts primarily by total addressable IVD wallet and strategic potential, not by current Suprabha sales alone.
- Initial configurable guideline: A = approximately ₹2 lakh or more addressable IVD wallet per month; B = approximately ₹75,000 to ₹2 lakh per month. Thresholds must remain configurable by territory/market as evidence improves.
- A accounts require a management-visible account plan, full stakeholder/Power Map and frequent account review.
- B accounts require a structured account plan and key-stakeholder mapping, with management escalation for material opportunities.
- Target wallet share for both strategic classes is at least 80% where commercially rational and compliant.

#### Wallet measurement

- Wallet Share % = canonical Suprabha revenue / governed estimated addressable IVD wallet × 100.
- Prefer trailing-three-month average Suprabha revenue for operational wallet-share reporting so a single large invoice does not distort the account.
- Estimated wallet must carry source/method, confidence and last-verified date.
- Material changes to wallet estimates must be auditable so users cannot improve reported wallet share merely by reducing the denominator.
- Untapped Wallet = max(Estimated Addressable Wallet - Suprabha Revenue, 0).
- Revenue required at 80% = Estimated Addressable Wallet × 0.80.
- Capture Gap to 80% = max(Revenue Required at 80% - Suprabha Revenue, 0).
- Operational account stages: Conquest (0–<25%), Capture (25–<50%), Grow (50–<80%) and Defend (≥80%). Thresholds may later be configurable, but historical calculations must remain reproducible.

#### Division-level wallet model

- Break addressable wallet into governed diagnostic divisions such as Biochemistry, Hematology, Immunoassay, Molecular, Microbiology, Rapid, Coagulation, Electrolytes, HbA1c and Others as appropriate.
- For each division show estimated wallet, Suprabha revenue/share, competitor/installed-base context when known, capture gap and next opportunity.
- The account-level wallet must reconcile to its division-level estimates or explicitly show unallocated/unknown wallet.
- Missing or low-confidence estimates must be shown as unknown rather than silently treated as zero.

#### 80% Account Scorecard

Every A/B account should eventually expose one management card containing, where available:

- Account class, estimated monthly addressable wallet, Suprabha trailing revenue, current wallet share, 80% target revenue and capture gap.
- Division-level wallet/share and largest untapped opportunities.
- Competitor installed base, likely replacement/renewal windows and instrument/service dependencies.
- Decision maker, champion, blocker and other relevant Power Map roles.
- Qualified opportunities, expected conversion date and accountable salesperson/owner.
- A single explicit next-best commercial action selected by the responsible user, with due date and outcome history.
- Risk flags such as stock/service problems, credit issues, relationship deterioration or competitor activity.

#### Capital allocation and placements

Capital must be allocated by expected wallet capture and gross-profit quality rather than by brand preference or salesperson pressure alone.

- Core financial measure: expected annual incremental gross profit / capital required.
- A governed Capital Priority Score may combine: 35% financial return, 25% wallet unlocked, 15% probability of conversion, 10% strategic account importance, 10% cross-selling potential and 5% competitive displacement. These initial weights are configurable policy, not immutable database truth.
- Every placement proposal must retain the underlying inputs, score version, expected wallet captured, expected GP, capital required, payback and approval/override history.
- Placement economics may consider adjacent wallet unlocked by the instrument, but expected cross-sell must remain separately visible from committed/actual revenue.
- Actual post-placement revenue and GP should later be compared with the original business case.

#### Salesperson and management operating model

- Sales performance should not be judged only on gross sales. A future governed scorecard may weight approximately: 35% revenue/GP achievement, 25% wallet-share growth, 15% new wallet captured, 10% A/B retention, 10% collections and 5% intelligence/data quality. Final weights remain configurable management policy.
- A accounts receive a monthly management review; B accounts receive structured salesperson review with escalation for significant opportunities or risks.
- Each review should answer: current share, missing wallet, current competitor owner of that wallet, reason Suprabha has not captured it, and the specific action/capital required next.
- Accounts at ≥80% move into a Defend motion focused on availability, service uptime, relationship depth, pricing discipline, collections and early detection of competitor threats rather than unnecessary selling.

#### Command Center metrics

The future management Command Center should surface at minimum:

- Total A+B addressable wallet.
- Canonical Suprabha revenue captured from A+B accounts.
- A+B weighted wallet share.
- Untapped A+B wallet.
- Qualified capture pipeline.
- Capital required for qualified capture opportunities.
- Expected incremental revenue and GP from qualified opportunities.
- Count/value of A/B accounts in Conquest, Capture, Grow and Defend stages.
- Wallet share movement over time, with drill-down to territory, salesperson, account and division.

The strategic operating loop is: Map Market → Identify A/B Accounts → Estimate Wallet → Measure Share → Identify Missing Divisions → Map Competitor Installed Base → Power Map Stakeholders → Identify Replacement Window → Select Commercial Action → Allocate Capital → Capture Business → Measure Actual Consumption/Revenue → Cross-sell → Reach ≥80% → Defend.

### Governed KPI and management metrics framework

The KPI layer must distinguish **headline management KPIs** from **diagnostic/drill-down metrics**. A metric belongs on the management Command Center only when it changes a management decision; supporting metrics remain available through drill-down. Every KPI must inherit the KPI registry definition, canonical source, formula/version, period, refresh policy, owner and drill-down path.

**Management objective:** optimize four dimensions together — Wallet Share × Gross Profit × Cash Conversion × Capital Efficiency. Growth that destroys margin, cash conversion or capital returns must not be presented as success.

#### Profitability and capital efficiency

- Revenue, gross profit ₹ and GP % with drill-down by account, account class, diagnostic division, product, brand/principal, salesperson and territory.
- GP per customer and GP per instrument/placement where attribution is supportable.
- Capital Efficiency / GP Return on Capital = annualized gross profit attributable to the activity divided by governed average capital employed. The exact capital-employed definition must be versioned before operational use.
- Placement payback and actual-versus-business-case revenue, GP and payback.
- Margin leakage from unauthorized/exception pricing where pricing data is available.
- Do not compare capital-return metrics across activities unless capital and GP attribution rules are consistent.

#### Account Health Score

A future governed Account Health Score (0–100) may combine wallet share, revenue trend, GP quality, payment behaviour, service health, relationship/engagement and verified competitor threat. Initial component weights are management policy and must remain configurable/versioned.

- Suggested presentation bands: Healthy 80–100, Watch 60–79, At Risk 40–59, Critical <40; thresholds remain configurable.
- Show the component scores and evidence behind the composite; never expose only an unexplained number.
- Unknown inputs reduce confidence rather than silently becoming zero.
- Account health is an attention/triage tool, not a substitute for the underlying financial, service or relationship evidence.

#### Wallet capture, loss and reagent leakage

- Wallet Gained ₹: governed increase in captured recurring wallet over the comparison period, separated from estimate revisions.
- Wallet Lost ₹: governed decrease in captured recurring wallet, with drill-down to account, division/product, known competitor and recorded reason where available.
- Net Wallet Capture ₹ = Wallet Gained ₹ - Wallet Lost ₹.
- Reagent Consumption Gap / Wallet Leakage = governed expected reagent consumption minus actual canonical sales/consumption proxy, never below zero unless an explicit over-consumption variance is shown separately.
- Leakage analysis should distinguish likely low test volume, purchasing outside Suprabha, downtime/service, stock availability, estimate error and unknown cause where evidence permits.
- Expected consumption is an estimate and must carry method, confidence and verification metadata.

#### Opportunity execution and pipeline velocity

- Qualified pipeline value and expected incremental GP.
- Opportunity age and days in current stage.
- Stage conversion rate, win rate and loss rate.
- Average/median sales cycle and expected-close versus actual-close variance.
- Stalled opportunities using a configurable inactivity/stage-age policy.
- Mandatory governed loss reason for lost opportunities.
- Pipeline coverage and pipeline velocity may be added only after stage definitions and probability rules are stable enough to make the metric comparable.

#### Service and installed-base performance

- Installed base, active instruments, instruments under service and open service tickets.
- Mean/median response time and resolution time.
- First-time fix rate and repeat-failure rate where service-event data supports reliable calculation.
- Instrument uptime % only when downtime start/end evidence is sufficiently complete; otherwise show service-event proxies rather than false precision.
- Preventive-maintenance compliance %.
- Service-related wallet/revenue risk: link material downtime or recurring service failures to affected strategic accounts without claiming causation unless evidence supports it.

#### Receivables, collections and cash conversion

- Total receivables and ageing: 0–30, 31–60, 61–90 and 90+ days.
- Days Sales Outstanding (DSO) using a documented, versioned formula.
- Overdue value/% and collection efficiency.
- Credit-limit utilization and accounts/orders on credit hold.
- 90+ day receivables as a headline attention metric.
- Quality Revenue should be treated as a management concept combining acceptable margin and acceptable collection behaviour; any future composite formula must be explicitly governed before use.

#### Inventory intelligence sourced from Tally

Tally remains the inventory authority. Suprabha OS may analyze synchronized Tally inventory data but must not create a competing stock ledger.

- Stock value, stock days and inventory turnover.
- Critical SKUs and stock-out events.
- Near-expiry, expired, slow-moving and non-moving stock value, including configurable >90/>180-day ageing views.
- Lost Sales Due to Stock-out ₹ only when a governed demand signal exists (for example an unfulfilled order/line or recorded lost demand); never infer lost sales solely from zero stock.
- Inventory metrics must expose Tally sync freshness so stale snapshots are not presented as current truth.

#### Principal / brand scorecard

Each manufacturer/principal should eventually have a comparable management scorecard where data permits:

- Revenue, GP ₹, GP %, growth and wallet captured.
- Inventory investment, turns, ageing/expiry loss and stock availability/fill-rate proxies from Tally/supplier evidence.
- Credit terms/days and receivable exposure attributable to the portfolio where supportable.
- Instrument capital deployed and placement economics.
- Service/support performance using recorded service/escalation evidence rather than subjective ratings alone.
- Principal Capital Return / Strategic Value may combine financial and strategic measures only through a transparent, versioned policy; the raw components must always remain visible.

#### Headline Command Center design

Keep the first management screen intentionally small. Proposed headline measures:

**Market leadership**
- A+B addressable wallet.
- A+B weighted wallet share.
- Net Wallet Capture ₹.
- Untapped A+B wallet.

**Profitability/capital**
- Revenue.
- Gross Profit ₹.
- GP %.
- Capital Efficiency / GP Return on Capital.

**Customer/cash**
- Count of A/B accounts at ≥80% wallet share.
- Count of At-Risk/Critical A/B accounts.
- Receivables ₹.
- DSO.

**Attention indicators**
- Reagent/Wallet Leakage ₹.
- Lost Sales Due to Stock-out ₹.
- Near-expiry stock ₹.
- Stalled opportunities count/value.
- Critical service cases.
- 90+ day receivables ₹.

Every headline number should drill down to the records and causes that create it. The Command Center must never become a manually maintained parallel reporting database.

### Territory and account intelligence

This is a future intelligence layer and must not expand or delay the current Phase 3 production/pilot gate.

- Territory Map built from the canonical customer/account master; the map is a visualization, never a second customer database.
- Customer, Opportunity, Equipment and Sales Territory map modes using the same underlying verified data.
- Account intelligence may include customer type, assigned salesperson, installed equipment, key contacts, actual revenue, estimated wallet, wallet share, untapped wallet, open opportunities, last visit and account/credit status.
- Derived metrics such as wallet share and untapped wallet must be calculated from canonical inputs rather than stored as competing truths.
- Estimated market intelligence must carry method/source, confidence and last-verified metadata.
- Filters may include division, customer type, salesperson, brand/equipment, account status, wallet share, revenue, GP, opportunity value, last visit, credit risk, placement status and geography.

### Stakeholder Power Map

The Power Map answers who influences a customer decision and how influence flows through the account. It is linked to the canonical customer/contact and CRM opportunity records rather than duplicating contacts.

- Classify relevant contacts by decision role, including Decision Maker/Economic Buyer, Champion, Influencer, Technical Evaluator, User, Gatekeeper, Blocker and Coach where applicable.
- Capture formal authority separately from observed actual influence.
- Represent directional stakeholder relationships and influence strength (for example strong, medium or low) with evidence/confidence and last verification.
- Capture relationship with Suprabha, sentiment/engagement, brand preference, price sensitivity, technical influence, access, relationship owner, last interaction and key concern where useful.
- Allow opportunity-level views to identify the likely decision maker, champion, blocker and strongest known influence path.
- Future recommendations may use verified opportunity and stakeholder data to suggest account actions, but AI decision automation remains explicitly deferred.

### Social Styles for stakeholder communication

Social Style is a salesperson-observed communication aid, not a psychological diagnosis. Classification must remain evidence-based, editable and explicitly uncertain when observations are insufficient.

- Supported observed styles: Analytical, Driving, Expressive and Amiable.
- Store primary style, optional secondary style, score distribution, confidence, evidence/notes, recorded_by and last_verified_at.
- Include a `Not enough information` state; avoid forcing a classification from weak evidence.
- Prefer classification only after several meaningful interactions (guideline: approximately 3–5 interactions).
- Analytical guidance: lead with data, technical evidence, accuracy, method, throughput, validation, CPT and comparisons.
- Driving guidance: be concise and lead with results, ROI, price, turnaround, commercial outcome and a clear recommendation.
- Expressive guidance: emphasize innovation, differentiation, future potential, demonstrations and relevant success stories.
- Amiable guidance: emphasize trust, service, training, continuity, references and implementation reassurance.

#### Salesperson observation questionnaire

A future CRM workflow may use ten quick observational questions rather than asking the customer to self-classify. The questions should cover:

1. What the stakeholder asks about first when evaluating an instrument: data/specifications, result/price/timeline, novelty/differentiation, or service/support/reliability.
2. Decision speed: methodical, fast/decisive, intuitive, or consultative.
3. Meeting behaviour: detailed questioning, directing/controlling, enthusiastic/conversational, or listening/cooperative.
4. Best response trigger: evidence/comparisons, bottom-line benefits, ideas/possibilities, or trust/reassurance.
5. Option evaluation: careful comparison, asks for the best option, explores interesting options, or seeks the safe/comfortable choice.
6. Communication style: precise/factual, short/direct, animated/conversational, or calm/friendly.
7. Main pre-purchase concern: technical correctness, results, differentiation, or support.
8. Behaviour under pressure: asks for more information, becomes more forceful, becomes more animated/emotional, or avoids conflict/delays.
9. Importance of relationship: follows demonstrated competence, secondary to results, very important, or extremely important.
10. Proposal preference: detailed comparison, short recommendation with numbers, attractive presentation/demo, or explanation plus follow-up discussion.

Questionnaire scoring: A = Analytical, B = Driving, C = Expressive, D = Amiable. Retain the full score distribution and use it to derive primary/secondary style and confidence rather than reducing every person to a single permanent label.

**Intelligence guardrail:** Suprabha 80, KPI metrics, Territory Maps, Power Maps and Social Styles must inherit existing authorization/row scope, auditability and one-source-of-truth principles. Observations and estimates must never be presented as verified facts without provenance/confidence metadata.

## Explicitly deferred

- Returns, until the product decision changes.
- Stock entry, reservation, batch allocation and adjustment in StockFlow.
- Native mobile applications.
- AI decision automation.
- Advanced forecasting and market-share algorithms.
- Courier and WhatsApp automation.
- Microservices, Kafka and Kubernetes.

## Cost and portability guardrails

- Prefer PostgreSQL, TypeScript, GitHub CI and existing managed/free tiers while limits remain operationally adequate.
- Keep the application deployable locally or on managed infrastructure through configuration.
- Add paid infrastructure only for a measured reliability, security or capacity need.
- Never make a daily-use Tally workstation the only database or only backup location.
