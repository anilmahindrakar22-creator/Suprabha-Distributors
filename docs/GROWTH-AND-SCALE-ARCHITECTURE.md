# Suprabha OS — Growth & Scale Architecture

## Purpose

This document defines the future growth architecture for Suprabha Distributors after the current StockFlow OMS Phase 3 pilot/hardening gate. It is a strategic companion to `ROADMAP.md`, not authorization to expand current implementation scope.

The objective is to connect market opportunity, commercial capability, capital, service, people and data into one repeatable growth system.

> Market opportunity -> capability required -> capital required -> accountable action -> wallet capture -> recurring GP -> cash conversion -> reinvestment.

The operating objective remains: **Wallet Share × Gross Profit × Cash Conversion × Capital Efficiency**.

## Sequencing guardrail

Do not begin these growth modules before the current Phase 3 release/pilot is stable enough for daily office use. New modules must reuse canonical customer, order, Tally, instrument, service, CRM and KPI data rather than create parallel spreadsheets or duplicate databases.

## 1. Market Census

Create a canonical market universe, including both customers and non-customers:

- Private diagnostic laboratories.
- Hospitals and nursing homes.
- Government hospitals and medical colleges.
- Blood banks.
- Specialty clinics and centers.
- Collection centers.
- Public-health and institutional laboratories.

Each account may carry geography, customer type, estimated wallet, current Suprabha revenue, installed equipment, competitors, decision stakeholders, current suppliers, contract/replacement windows and next opportunity date.

**Difficulty:** Medium.
**Primary dependency:** clean customer/account master and geography.
**Business value:** Very high.

## 2. White-Space / Portfolio Gap Engine

For each account and diagnostic division, compare:

- Estimated addressable wallet.
- Canonical Suprabha revenue.
- Current wallet share.
- Untapped wallet.
- Current competitor ownership.
- Whether Suprabha has a competitive product/principal able to capture the gap.

Where a material wallet gap cannot be served with the current portfolio, create a governed `Portfolio Gap` record. Aggregate those gaps by division and territory to show which missing product categories or principals would unlock the most profitable wallet.

**Difficulty:** Medium.
**Primary dependency:** market census, division-level wallet data, product/division mapping.
**Business value:** Very high.

## 3. Manufacturer / Principal Acquisition Engine

Manage target manufacturers as a strategic pipeline rather than accepting opportunities opportunistically.

Score target principals using governed inputs such as:

- Addressable wallet unlocked.
- Portfolio overlap/gap closure.
- Expected revenue and GP.
- Recurring reagent potential.
- Capital/opening-stock requirement.
- Service burden.
- Credit terms.
- Exclusivity and territory protection.
- Brand/regulatory strength.
- Reliability and supply performance.
- Replacement opportunities in the mapped installed base.

Outcome: an evidence-based principal priority list and business case.

**Difficulty:** Easy–Medium once data exists.
**Primary dependency:** portfolio gap engine and market census.
**Business value:** High.

## 4. Government / Tender Intelligence

Treat government business as a distinct commercial workflow.

Suggested lifecycle:

`Tender identified -> pre-bid -> eligibility -> technical qualification -> OEM authorization -> EMD/PBG -> submission -> technical result -> financial result -> PO -> installation -> acceptance -> payment -> guarantee closure`.

Retain tender institution, item, quantity, technical specifications, brands/OEMs, winner, L1/L2/L3 where lawfully/publicly known, commercial result, tender cycle and next expected cycle.

**Difficulty:** Medium–High.
**Primary dependency:** document/evidence model, CRM/opportunity ownership, permissions.
**Business value:** High for institutional expansion.

## 5. Installed-Base & Replacement Intelligence

Maintain both Suprabha and competitor installed equipment where evidence is available:

- Manufacturer/model.
- Account/location.
- Installation date/estimated age.
- Ownership/placement model.
- Service condition.
- Reagent dependence.
- Contract/AMC/CMC dates where known.
- Expected replacement window.
- Evidence/source/confidence/last verification for competitor observations.

Generate replacement-window opportunities 6–12 months before likely change, with configurable rules.

**Difficulty:** Medium.
**Primary dependency:** canonical instrument model and CRM.
**Business value:** Very high.

## 6. Recurring Revenue / Annuity Engine

Evaluate each instrument and placement as a recurring economic engine:

- Instrument investment.
- Expected test volume.
- Expected reagent/consumable revenue.
- GP/month and GP/year.
- Service cost.
- Working capital.
- Payback.
- Multi-year GP.
- Adjacent wallet unlocked.
- Actual vs expected consumption/revenue after placement.

Classify investments as Revenue Engine, Strategic Placement, Defensive Placement or Poor Investment using governed policy.

**Difficulty:** Medium.
**Primary dependency:** instrument, sales, product, GP and service data.
**Business value:** Very high.

## 7. Service Moat

Extend service from ticket handling into revenue protection and customer retention:

- Response SLA.
- Resolution SLA.
- Preventive maintenance.
- Uptime/downtime where evidence is reliable.
- First-time fix and repeat failure.
- Loaner/backup instrument where commercially justified.
- Applications support/training.
- Revenue/wallet at risk from service events.
- Service cost and service profitability where measurable.

**Difficulty:** Medium–High operationally; Medium technically.
**Primary dependency:** installed base, service event discipline and staff adoption.
**Business value:** High.

## 8. Clinical / Applications Selling Capability

Build governed decision-support content for sales and customers:

- Method comparison guides.
- Throughput/workload suitability.
- CPT/economics calculators.
- Validation/regulatory evidence links.
- QC/application requirements.
- Ease-of-use and staffing considerations.
- Suitable laboratory profile.

Initial topics may include HbA1c, biochemistry, hematology, electrolytes, immunoassay, molecular, coagulation and microbiology.

These tools support consultative selling; they do not replace clinical judgment or manufacturer/regulatory documentation.

**Difficulty:** Easy–Medium technically; high content/governance effort.
**Primary dependency:** product master and curated evidence.
**Business value:** High.

## 9. Opportunity–Capability–Capital Engine

This is the strategic integration layer.

Every material opportunity may identify:

- Expected wallet unlocked.
- Expected revenue and GP.
- Probability/confidence.
- Capital required.
- Product/principal required.
- Service/application capability required.
- Sales/management/OEM support required.
- Due date and next action.

Management views should include:

- Highest-return opportunities requiring capital.
- Opportunities blocked by portfolio gaps.
- Opportunities blocked by service/application capacity.
- Opportunities requiring management or OEM intervention.
- Opportunities that can be won with no material capital.

**Difficulty:** Medium–High.
**Primary dependency:** CRM, wallet, capital, portfolio and people-capability models.
**Business value:** Extremely high.

## 10. Capital Allocation Board

Compare competing uses of scarce capital on a common governed basis:

- Instrument placements.
- Opening stock for a new principal.
- Inventory investment.
- New salesperson/territory coverage.
- Service equipment/capability.
- Geographic expansion.

Compare expected GP, payback, ROCE/capital efficiency, cash-conversion risk, wallet unlocked, strategic importance and downside risk.

No composite score may hide raw inputs; overrides require reason and audit history.

**Difficulty:** Medium.
**Primary dependency:** reliable GP, capital and opportunity data.
**Business value:** Extremely high.

## 11. Geographic Expansion Intelligence

Rank territories using governed inputs:

- Addressable diagnostic wallet.
- Current Suprabha share.
- A/B account density.
- Competitor strength.
- Travel/service burden.
- Sales capacity.
- Government opportunity.
- Capital required.
- Expected GP/cash conversion.

Use this to decide whether to deepen an existing territory or hire/expand into a new district.

**Difficulty:** Medium.
**Primary dependency:** market census, geography, sales and service data.
**Business value:** High.

## 12. Sales Force Operating System

Move from activity logging to an accountable daily operating system:

- Territory plan.
- Route/day plan.
- Customer call objective.
- Next action and due date.
- Opportunity stage and probability.
- Wallet gap targeted.
- Collections responsibility where policy permits.
- Coaching/review metrics.
- Conversion and cycle-time metrics.

Measure outcomes, not meaningless visit counts.

**Difficulty:** Medium technically; High adoption effort.
**Primary dependency:** CRM, role scope and management cadence.
**Business value:** Very high.

## 13. Customer Retention / Early Warning

Detect risk using explainable signals such as:

- Revenue/order-frequency decline.
- Reagent consumption decline.
- Service complaints/downtime.
- Overdues/credit deterioration.
- Competitor activity.
- Reduced sales engagement.
- Expiring contracts/replacement windows.

Start with deterministic rules. Machine learning may later rank risk after sufficient clean historical outcomes exist.

**Difficulty:** Easy–Medium for rules; Medium–High for validated ML.
**Primary dependency:** sales, service, receivables and CRM history.
**Business value:** High.

## 14. Supplier / Principal Performance & Negotiation

Measure each principal using evidence:

- Revenue and GP.
- Growth.
- Fill rate / availability proxy.
- Lead time and backorders.
- Credit days.
- Expiry/FOC support.
- Service response.
- Territory protection incidents where governed evidence exists.
- Instrument capital deployed.
- Lost sales attributable to supply failure when supported by a recorded demand signal.

Use the scorecard for annual portfolio review and negotiation.

**Difficulty:** Medium.
**Primary dependency:** procurement/supplier data, Tally sales/inventory and service/escalation records.
**Business value:** High.

## 15. People Capability / Suprabha Academy

Create a scalable knowledge and competency system:

- Product and applications knowledge.
- Sales process.
- Tender process.
- Collections discipline.
- Tally/OMS workflow.
- Cold-chain handling.
- Service escalation.
- Pricing/approval policy.
- Account planning.

Track competency and training completion only where it supports performance or compliance; avoid bureaucracy.

**Difficulty:** Easy technically; Medium–High organizationally.
**Primary dependency:** role model and content ownership.
**Business value:** High as team size grows.

## 16. Customer Self-Service Layer

Later, expose a lightweight customer interface using the same canonical API and identity model:

- Repeat orders.
- Order status.
- Invoice/outstanding visibility where approved.
- Service requests.
- Instrument/service history.
- Product/documents where appropriate.

Do not create a second order/customer database.

**Difficulty:** Medium–High.
**Primary dependency:** stable core, strong authorization, customer identity and security.
**Business value:** Medium–High; defer until internal operations are stable.

## Difficulty and rollout summary

| Capability | Build difficulty | Data/adoption difficulty | Priority after Phase 3 |
|---|---|---|---|
| Market Census | Medium | Medium | 1 |
| White-Space / Portfolio Gap | Medium | High | 2 |
| Installed Base / Replacement | Medium | Medium | 3 |
| Government / Tender Intelligence | Medium–High | Medium | 4 |
| Opportunity–Capability–Capital | Medium–High | High | 5 |
| Recurring Revenue / Annuity | Medium | Medium | 6 |
| Capital Allocation Board | Medium | High | 7 |
| Sales Force OS | Medium | High | 8 |
| Service Moat | Medium | High | 9 |
| Manufacturer Acquisition | Easy–Medium | Medium | 10 |
| Customer Retention Rules | Easy–Medium | Medium | 11 |
| Geographic Expansion | Medium | High | 12 |
| Supplier Scorecard | Medium | Medium | 13 |
| Clinical Selling Tools | Easy–Medium | High content effort | 14 |
| Suprabha Academy | Easy | Medium–High | 15 |
| Customer Self-Service | Medium–High | Medium | Later |
| Classical ML | Medium | Very high data requirement | Later |
| Local LLM / RAG | Medium technically | Medium governance | Later |

## Recommended build strategy

Do not build all sixteen modules independently. Most are views, rules and workflows over the same canonical data.

### Growth Foundation

Build only the reusable data primitives first:

1. Canonical market account + geography.
2. Diagnostic division taxonomy.
3. Installed-base/competitor observation with provenance.
4. Wallet estimate with confidence/freshness.
5. Opportunity with next action/outcome/loss reason.
6. Capital/business-case record.
7. Capability/resource requirement linked to opportunity.

Once these exist, many later features become calculations and focused workflows rather than separate systems.

### Expected implementation difficulty

The software is **moderately difficult, not extraordinarily difficult**. The hardest part is not CPU, AI or database scale. The difficult parts are:

- Establishing trustworthy market/wallet data.
- Getting sales/service staff to maintain the few fields that matter.
- Keeping estimates separate from verified facts.
- Designing one canonical customer/account model.
- Maintaining Tally authority for accounting/inventory.
- Preventing duplicate spreadsheets and parallel truths.
- Calibrating commercial rules without creating bureaucracy.

With the existing modular-monolith/PostgreSQL architecture, the technical path remains manageable. Do not introduce microservices, a data warehouse, heavy GIS or AI infrastructure merely to support this strategy.

## Growth operating loop

```text
Map market
    -> Identify A/B accounts
    -> Quantify wallet and white space
    -> Identify competitor installed base / replacement windows
    -> Check whether current portfolio can capture the gap
    -> If not, create portfolio/principal gap
    -> Create opportunity and required capabilities
    -> Evaluate capital/business case
    -> Assign next action and owner
    -> Win / lose with reason
    -> Measure actual revenue, GP, cash and consumption
    -> Protect through service and relationship depth
    -> Reinvest into the next highest-return opportunity
```

## Definition of success

The Growth & Scale Architecture is successful when Suprabha can answer, from governed data rather than memory or disconnected spreadsheets:

1. Where is the largest profitable untapped diagnostic wallet?
2. Which competitor currently owns it?
3. What product/principal is required to capture it?
4. What salesperson, service/application capability or management support is required?
5. How much capital is required?
6. What GP and cash return is expected?
7. What is the next action and who owns it?
8. Did the opportunity convert, and if not, why?
9. Did the capital deployed produce the expected recurring revenue and GP?
10. Where should the next rupee and the next person be deployed?
