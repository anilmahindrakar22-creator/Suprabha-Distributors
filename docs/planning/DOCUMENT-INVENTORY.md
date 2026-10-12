# Document inventory, traceability and missing-design register

**Purpose:** list every design document, where it lives, what it's for, and which canonical document now carries its content.
**Last verified:** 13 Oct 2026 against `main` `3804421`, the release candidate `codex/staff-signin-session-redirect` `9cd36e0`, and the design branch `docs/power-map-social-styles-roadmap` `839497a`.

**Class key:**

| Class | Meaning |
| --- | --- |
| **Authoritative** | still binding; its rules are carried into canonical docs |
| **Supporting** | evidence, records, plans |
| **Historical** | kept for audit; superseded parts are named |
| **Obsolete** | fully replaced |

Original files are **not moved or deleted**. Canonical docs link back to them.

## 1. Inventory

### 1.1 On `main` (also present on the release candidate)

| File | Latest commit | Purpose and domains | Class | Notes | Carried into |
| --- | --- | --- | --- | --- | --- |
| [SUPRABHA_OS_ARCHITECTURE.md](../SUPRABHA_OS_ARCHITECTURE.md) | `ca2a06f` (6 Sep) | system shape, domains, inventory authority, order states, reliability | Authoritative (core rules) | role names differ from code (see ADR-0013) | [02-SYSTEM-AND-DOMAINS](../architecture/02-SYSTEM-AND-DOMAINS.md), [05-SECURITY-ACID-AUDIT](../architecture/05-SECURITY-ACID-AUDIT.md) |
| [REQUIREMENTS-AND-DELIVERY-PLAN.md](../REQUIREMENTS-AND-DELIVERY-PLAN.md) | 5 Sep baseline | OMS requirements REQ-01–20, connector contract, offline, performance budgets, R0–R5 | Authoritative (REQs, budgets) | R0–R5 sequencing superseded by the master roadmap Phase 0/1 | [01-FUNCTIONAL-REQUIREMENTS](../product/01-FUNCTIONAL-REQUIREMENTS.md), [04-TALLY-INTEGRATION](../architecture/04-TALLY-INTEGRATION.md), [RELEASE-GATES](RELEASE-GATES.md) |
| [ROADMAP.md](../ROADMAP.md) (main) | 28 Sep | milestones 1–6, deferrals, cost guardrails | Historical (ordering); Authoritative (deferrals, guardrails) | milestone order superseded (ADR-0010) | [MASTER-ROADMAP](MASTER-ROADMAP.md) |
| [SUPRABHA80-PROFITABLE-WALLET-CAPTURE.md](../SUPRABHA80-PROFITABLE-WALLET-CAPTURE.md) | 28 Sep | strategy: 4 engines, Pareto, constraints, pricing roles, learning | Authoritative | — | [SUPRABHA80](../intelligence/SUPRABHA80.md) |
| [SUPRABHA80-UI-FUNCTIONAL-TECHNICAL-SPEC.md](../SUPRABHA80-UI-FUNCTIONAL-TECHNICAL-SPEC.md) | 28 Sep (identical on main and the RC) | screens, FR-01–18, data, API, ACID, scoring, **§26 Market Map**, §§27–31 UX, performance, fast capture, demand-driven replenishment | Authoritative | §26 supersedes earlier map modes | [SUPRABHA80](../intelligence/SUPRABHA80.md), [ACTION-CENTER](../intelligence/ACTION-CENTER.md), [MARKET-MAPS](../intelligence/MARKET-MAPS.md), [02-UX](../product/02-UX-AND-NAVIGATION.md) |
| [CUSTOMER-PRICE-BOOK-AND-BASE-PRICE.md](../CUSTOMER-PRICE-BOOK-AND-BASE-PRICE.md) | Sep | price book and base price rules | Authoritative | — | [CATALOG-AND-PRICING](../domains/CATALOG-AND-PRICING.md) |
| [CUSTOMER-PRICING-ENGINE-IMPLEMENTATION.md](../CUSTOMER-PRICING-ENGINE-IMPLEMENTATION.md) | Sep | pricing engine build record | Supporting | — | [CATALOG-AND-PRICING](../domains/CATALOG-AND-PRICING.md) |
| [PRICE-BOOK-IMPLEMENTATION-STATUS.md](../PRICE-BOOK-IMPLEMENTATION-STATUS.md) | modified on the RC | pricing status and gates | Supporting | — | [IMPLEMENTATION-STATUS](IMPLEMENTATION-STATUS.md) |
| [TALLY-PRICING-HISTORY-AND-SAFE-BILLING-TEST.md](../TALLY-PRICING-HISTORY-AND-SAFE-BILLING-TEST.md) | Sep | safe Tally billing test | Supporting | — | [04-TALLY-INTEGRATION](../architecture/04-TALLY-INTEGRATION.md) |
| [LIGHTWEIGHT-RECOVERY.md](../LIGHTWEIGHT-RECOVERY.md) | Sep | connector recovery slices | Supporting | — | [04-TALLY-INTEGRATION](../architecture/04-TALLY-INTEGRATION.md) |
| [CONNECTOR-VALIDATION-2026-09-05.md](../CONNECTOR-VALIDATION-2026-09-05.md) | 5 Sep | connector evidence | Supporting | — | [04-TALLY-INTEGRATION](../architecture/04-TALLY-INTEGRATION.md) |
| [PRODUCTION-PILOT-2026-09.md](../PRODUCTION-PILOT-2026-09.md) | modified on the RC | pilot definition and status (**HOLD**) | Supporting (status evidence) | — | [RELEASE-GATES](RELEASE-GATES.md), [IMPLEMENTATION-STATUS](IMPLEMENTATION-STATUS.md) |

### 1.2 Only on the release candidate (`codex/staff-signin-session-redirect`)

| File | Purpose | Class | Carried into |
| --- | --- | --- | --- |
| [INSTRUMENT-ECONOMICS-AND-REAGENT-LEAKAGE-PLAN.md](../INSTRUMENT-ECONOMICS-AND-REAGENT-LEAKAGE-PLAN.md) | attribution engine, cost-at-sale, recovery, leakage rules | Authoritative | [INSTRUMENT-ECONOMICS](../intelligence/INSTRUMENT-ECONOMICS.md) |
| [INSTRUMENT-ECONOMICS-BUILD-STATUS.md](../INSTRUMENT-ECONOMICS-BUILD-STATUS.md), [CANDIDATE-ACCEPTANCE](../INSTRUMENT-ECONOMICS-CANDIDATE-ACCEPTANCE.md), [CHANGE-REVIEW-2026-10-10](../INSTRUMENT-ECONOMICS-CHANGE-REVIEW-2026-10-10.md), [PRODUCTION-CUTOVER-PLAN](../INSTRUMENT-ECONOMICS-PRODUCTION-CUTOVER-PLAN.md), [ROLLOUT-RECORD](../INSTRUMENT-ECONOMICS-ROLLOUT-RECORD.md), `…TALLY-POLICY-DRAFT.json` | build, acceptance and rollout records | Supporting | [IMPLEMENTATION-STATUS](IMPLEMENTATION-STATUS.md), [RELEASE-GATES](RELEASE-GATES.md) |
| [CLAUDE-HANDOVER-INSTRUMENT-ECONOMICS.md](../CLAUDE-HANDOVER-INSTRUMENT-ECONOMICS.md) | agent coordination log | Supporting (process) | — |
| [AGENT-DECISION-LAYER.md](../AGENT-DECISION-LAYER.md) | agent tooling (Jev) | Supporting (process) | — |
| [ORDERS-UI-REDESIGN-PLAN.md](../ORDERS-UI-REDESIGN-PLAN.md), [UI-UX-REVIEW.md](../UI-UX-REVIEW.md) | Orders UX plan and review | Supporting | [02-UX](../product/02-UX-AND-NAVIGATION.md) |
| [ORDER-NOTIFICATIONS.md](../ORDER-NOTIFICATIONS.md), [PUSH-NOTIFICATIONS.md](../PUSH-NOTIFICATIONS.md) | notifications | Supporting | [ORDERS-AND-FULFILMENT](../domains/ORDERS-AND-FULFILMENT.md) |
| [SERVICE-MILESTONE-4-DESIGN.md](../SERVICE-MILESTONE-4-DESIGN.md) | PM schedule, visits, downtime | **Deferred** (owner parked 13 Oct) | [INSTALLED-BASE-AND-SERVICE](../domains/INSTALLED-BASE-AND-SERVICE.md) |
| [SUPRABHA80-MARKET-MAP-V1-DESIGN.md](../SUPRABHA80-MARKET-MAP-V1-DESIGN.md) | Claude's Market V1 slice design, utility review, map comparison | Historical (partly superseded: ADR-0006, ADR-0007) | [MARKET-MAPS](../intelligence/MARKET-MAPS.md), [SUPRABHA80](../intelligence/SUPRABHA80.md) |
| [SUPRABHA80-ARCHITECTURE-REVIEW.md](../SUPRABHA80-ARCHITECTURE-REVIEW.md) | Claude's review (12–13 Oct) | **Obsolete**: replaced by this consolidation (its power-map model is withdrawn, ADR-0005) | — |

### 1.3 Only on `docs/power-map-social-styles-roadmap` (unmerged; head `839497a`)
Permalinks use the commit, so they stay valid after branch changes.

| File / section | Commit | Purpose | Class | Carried into |
| --- | --- | --- | --- | --- |
| [ROADMAP.md: Territory, Power Map, Social Styles](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/blob/cba7f67/docs/ROADMAP.md) | `cba7f67` | Power Map roles and graph, Social Styles questionnaire, territory map modes | Authoritative (Power Map, Social Styles); **map modes superseded** (ADR-0004) | [POWER-MAPS](../intelligence/POWER-MAPS.md), [MARKET-MAPS](../intelligence/MARKET-MAPS.md) |
| [ROADMAP.md: Strategic Account Dominance Framework](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/blob/839497a/docs/ROADMAP.md) | `12a5679` | A/B classes, wallet formulas, stages, division model, 80% scorecard, capital priority, salesperson model, operating loop | Authoritative, except open decisions D-02/D-03 | [SUPRABHA80](../intelligence/SUPRABHA80.md) |
| same file: Governed KPI framework | `828803b` | KPI registry rules, Account Health Score, wallet gain/loss, pipeline, service, receivables, Tally inventory intelligence, principal scorecard, headline Command Center | Authoritative | [COMMAND-CENTER](../intelligence/COMMAND-CENTER.md) |
| [GROWTH-AND-SCALE-ARCHITECTURE.md](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/blob/839497a/docs/GROWTH-AND-SCALE-ARCHITECTURE.md) | `bc89efe` | 16 future engines (census, white space, principals, tenders, annuity, service moat, capital board…) | Supporting (future backlog) | [MASTER-ROADMAP §Future](MASTER-ROADMAP.md) |
| [HOSTING-AND-SERVER-MIGRATION.md](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/blob/839497a/docs/HOSTING-AND-SERVER-MIGRATION.md) | `1476bb3`, `3da9891` | office-PC hosting → in-house server → in-house AI; budget-first AI | **Proposed / not approved** (conflicts with current hosting: D-06) | [OPEN-DECISIONS](OPEN-DECISIONS.md) |
| [OPERATING-MODEL-ADOPTION.md](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/blob/839497a/docs/OPERATING-MODEL-ADOPTION.md) | `2fa1851` | role "Today" views, deterministic next best action, data ownership, management cadence | Authoritative (direction) | [ACTION-CENTER](../intelligence/ACTION-CENTER.md), [00-VISION-AND-ROLES](../product/00-VISION-AND-ROLES.md) |
| [EMPLOYEE-LEARNING-AND-ADOPTION.md](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/blob/839497a/docs/EMPLOYEE-LEARNING-AND-ADOPTION.md) | `839497a` | learning levels, capability matrix | Supporting | [00-VISION-AND-ROLES](../product/00-VISION-AND-ROLES.md) |

Branches `docs/tally-pricing-safe-test`, `-2` and `-final` point at the same or older content (`839497a`); they add nothing unique.

### 1.4 Untracked in the shared working folder (integration owner's drafts; not in git)
`CLAUDE-HANDOVER-RELEASE-VALIDATION.md`, `JEV-GLOBAL-WORKING-RULES.md`, `LIVEKEEPING-STOCKFLOW-PERFORMANCE.md`, `MARKET-FULL-SALES-IMPORT-PLAN.md`, `STOCKFLOW-SPEED-BASELINE-20261012.md`, `TALLY-DASHBOARD-*.md`, `TALLY-LIVEKEEPING-FEATURE-MAP.md`.
- They are **referenced by name only** until their owner commits them.
- Most relevant: `MARKET-FULL-SALES-IMPORT-PLAN.md`, a prerequisite for Phases 3, 5 and 7.

## 2. Duplicated material, now single-sourced

| Topic | Previously in | Canonical home |
| --- | --- | --- |
| Wallet definitions, share, untapped | wallet-capture doc §§3–7; spec §§5, 12; dominance framework | [SUPRABHA80 §3](../intelligence/SUPRABHA80.md) |
| Command Center metrics | main ROADMAP M6; dominance framework; KPI framework | [COMMAND-CENTER](../intelligence/COMMAND-CENTER.md) |
| Map modes | `cba7f67`; spec §26; Claude Market V1 §13 | [MARKET-MAPS](../intelligence/MARKET-MAPS.md) |
| Instrument economics rules | 6 `INSTRUMENT-ECONOMICS-*` files | [INSTRUMENT-ECONOMICS](../intelligence/INSTRUMENT-ECONOMICS.md) (rules); the records stay where they are |
| Inventory authority | architecture doc; requirements; ROADMAP; KPI framework | [ADR-0001](../architecture/06-DECISION-RECORDS.md) |
| Action Center / "Today" | spec §4; operating model §1 | [ACTION-CENTER](../intelligence/ACTION-CENTER.md) |

## 3. Traceability: consolidated requirement → source

| Consolidated requirement (ID) | Source(s) |
| --- | --- |
| ARCH-01 one database, modular monolith | SUPRABHA_OS_ARCHITECTURE §Purpose/§Architecture; ROADMAP guardrails |
| ARCH-02 Tally owns inventory, accounting, invoices | SUPRABHA_OS_ARCHITECTURE §Inventory authority; REQUIREMENTS §1; ROADMAP M2 and deferrals |
| ARCH-03 idempotency, versions, outbox, append-only audit | SUPRABHA_OS_ARCHITECTURE §Reliability; spec §14 |
| OMS-01…20 | REQUIREMENTS REQ-01…REQ-20 (IDs kept verbatim) |
| PERF-01 performance budgets | REQUIREMENTS §6; spec §16, §30 |
| S80-01 four engines | wallet-capture §2; spec §11 |
| S80-02 Pareto: computed concentration, policy band | wallet-capture §3 |
| S80-03 diagnose the constraint before discounting | wallet-capture §4; spec FR-05/06 |
| S80-04 A/B classes, wallet formulas, stages | dominance framework (`12a5679`) |
| S80-05 the Pricing Engine stays the price authority | wallet-capture §6; spec FR-08 |
| S80-06 outcomes and learning | wallet-capture §9; spec §8, FR-09 |
| MAP-FR-01…12 | spec §26.9 |
| PM-01 Power Map roles, influence graph | `cba7f67` §Stakeholder Power Map |
| SS-01 Social Styles, questionnaire, uncertainty | `cba7f67` §Social Styles |
| IE-01 attribution engine | economics plan §3 |
| IE-02 actual GP from Tally, no invented cost | economics plan §4 |
| IE-03 recovery and payback; policy bands | economics plan §5 |
| RL-01 leakage tiers and cause classification | economics plan §6 |
| KPI-01 KPI registry metadata | KPI framework (`828803b`) |
| PRIN-01…20 governing principles | owner brief, 13 Oct 2026 |

## 3a. Source-section coverage (every H2 section of the authoritative sources)
Each section is either carried into a canonical doc, kept in its source as evidence, or marked deferred or superseded. **129 sections checked, plus the growth and hosting documents as wholes; 0 unaccounted.**

| Source | Sections → canonical home |
| --- | --- |
| Spec (31) | §1–3 → 02-UX, SUPRABHA80 · §4–9 → ACTION-CENTER · §10 → SUPRABHA80 §6 · §11 → 02-SYSTEM · §12 → 03-DATA · §13 → MASTER-ROADMAP P5 (APIs) · §14, 17 → 05-SECURITY · §15 → ADR-0014 · §16, 30 → RELEASE-GATES and NFRs · §18 → 02-UX · §19 → 01-PRINCIPLES (observability) · §20–21 → RELEASE-GATES · §22 → MASTER-ROADMAP exclusions, D-03 · §23 → superseded by MASTER-ROADMAP (ADR-0010) · §24–25 → 01-PRINCIPLES, SUPRABHA80 · §26 → MARKET-MAPS · §27 → 01-PRINCIPLES §2a · §28 → CATALOG-AND-PRICING · §29 → 02-UX · §31 → ORDERS, PROCUREMENT |
| Wallet capture (17) | §1–6, 9–13, 15–16 → SUPRABHA80, ACTION-CENTER, 03-DATA, ADR-0003/0006/0014 · §7–8 → SUPRABHA80 §4a · §14 → 01-PRINCIPLES §2a · §17 → IMPLEMENTATION-STATUS |
| Economics plan (12 + dated refinements) | §1–6 → INSTRUMENT-ECONOMICS §2 · §7–12 and the refinements stay in the source as authoritative detail (linked) |
| REQUIREMENTS (9) | §1, 3 → ORDERS, 01-FUNCTIONAL-REQUIREMENTS · §2 → IMPLEMENTATION-STATUS · §4 → 04-TALLY · §5 → 05-SECURITY · §6, 8 → RELEASE-GATES · §7 → superseded by MASTER-ROADMAP · §9 → RELEASE-GATES Phase 0 |
| main ROADMAP (10) | baseline, M1–M3, recovery → MASTER-ROADMAP Phases 0–1 · M4 → Phase 2 and the service deferral · M5 → Phases 4–5, receivables deferred · M6 → Phase 8 · deferrals and guardrails → stay authoritative in the source |
| SUPRABHA_OS_ARCHITECTURE (10) | → 02-SYSTEM, 05-SECURITY, ADR-0001/0002/0013, ORDERS (state machine) |
| `cba7f67` (3) | Territory → MARKET-MAPS (modes superseded) · Power Map → POWER-MAPS · Social Styles → POWER-MAPS §3 |
| Dominance framework (7) | classes, wallet, divisions, scorecard → SUPRABHA80 · capital allocation → ADR-0014, D-02 · salesperson model → D-03 · Command Center → COMMAND-CENTER |
| KPI framework (9) | → COMMAND-CENTER (receivables deferred; inventory per ADR-0001) |
| OPERATING-MODEL (12) | §1–3, 7 → ACTION-CENTER · §4–5 → 01-PRINCIPLES §2a · Purpose, §6, 8–10, Definition of success → 00-VISION-AND-ROLES |
| EMPLOYEE-LEARNING (9) | → 00-VISION-AND-ROLES §Adoption (detail stays in the source) |
| GROWTH-AND-SCALE (16 engines) | → MASTER-ROADMAP §Future (proposed / not approved) |
| HOSTING (stages) | → D-06 (proposed / not approved) |

## 4. Missing-design register (needed, not yet designed anywhere)

| Gap | Needed by | Note |
| --- | --- | --- |
| **Customer owner/territory assignment and row scope for sales** | Phases 4–7 | spec §17 requires it; no table, no design |
| **Customer contacts table** | Power Map, Phase 6 | `cba7f67` assumes it; no schema exists |
| **Opportunity entity/CRM** shared by Power Map and Suprabha 80 | Phases 5–6 | `cba7f67` says "CRM opportunity records"; spec `wallet_opportunity`. One entity needed (ADR-0008) |
| **Prospect accounts** | Phases 4–5 | ADR-0009 (proposed) |
| **Full-sales Tally export contract** | Phases 3, 5, 7 | integration owner's untracked plan |
| **Unified installed-base register** (installations + economic placements) | Phase 2 | ADR-0011 |
| **KPI registry schema** | Phase 8 | KPI framework defines the metadata only |
| **Visit log** (commercial visits) | Phases 4, 7 | ROADMAP mentions "last visit"; no design |
| **Placement approval routing by role** | Phase 2 | D-04 director role |
| Backup and restore procedure with recorded drill | Phase 0 | REQUIREMENTS §8; no evidence |
