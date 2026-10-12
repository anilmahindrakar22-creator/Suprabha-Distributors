# Governing principles

**Status:** canonical.
**Sources:** owner directives of 13 Oct 2026 (governing principles; consolidation brief); [SUPRABHA_OS_ARCHITECTURE](../SUPRABHA_OS_ARCHITECTURE.md); [SUPRABHA80-PROFITABLE-WALLET-CAPTURE](../SUPRABHA80-PROFITABLE-WALLET-CAPTURE.md).
**Last verified:** 13 Oct 2026.

**The objective** is the most sustainable economic value from limited capital, time and people. It is not maximum activity or turnover. Anything that doesn't support a decision or give strategic guidance isn't built (owner, 13 Oct).

## 1. Engineering

| Principle | Meaning in this codebase |
| --- | --- |
| Single source of truth | one PostgreSQL per environment; Tally for accounting and stock; no duplicate masters |
| ACID | each command, its audit event and its outbox record commit together |
| Idempotency | every mutation carries a request key; a replay returns the original result |
| Optimistic concurrency | `expectedVersion`; stale or racing writes raise `PT409` (ADR-0017) |
| Auditability | append-only events: actor, entity, before/after, reason, request ID |
| Role-based, row-scoped authorization | enforced server-side in gateways; role sets |
| Modular monolith, lightweight | no new services, queues or languages without measured need (ADR-0002) |
| Recoverability and observability | outbox retries, connector recovery, backups with a restore drill, Server-Timing measurement |
| Provenance and freshness | every derived value has source, period, calculated-at, confidence and version (ADR-0016) |
| Evidence-based design; no silent failures | gaps and exceptions stay visible with an owner; nothing is guessed |

## 2. Commercial strategy, as one decision framework
The principles are **rules inside four logical engines** in the Commercial Intelligence domain. They are not separate systems or services.

| Engine | Question | Principles applied |
| --- | --- | --- |
| **FOCUS** | Which opportunities deserve attention? | Pareto and Power Law (computed concentration, versioned focus band; ADR-0006); Expected Value; Opportunity Cost; Contribution Margin (absolute GP, not turnover); Customer Lifetime Value; Compounding (recurring reagent value); Profitable Wallet Capture; Strategic Account Classification |
| **CONSTRAINT** | What prevents us from winning? | Theory of Constraints (one binding constraint per opportunity); First-Principles decomposition (wallet → division → product → instrument); Switching Costs and Moats; Competitor and Installed-Base Intelligence; **Stakeholder Power Mapping**; **Social Styles** (how to communicate, never whether to act) |
| **ACTION** | What is the best economically justified intervention? | Expected Value (gain × probability − cost); Razor-and-Blade economics (placements judged on lifetime reagent GP); Margin of Safety (conservative bands, placement policy limits); Game Theory (a likely-competitor-response checklist; advisory); Capital Efficiency; governed pricing hand-off (ADR-0003) |
| **LEARNING** | Did it work? | Feedback Loops (expected vs actual, append-only outcomes); Compounding; Measurable Outcomes; Continuous Improvement |

## 3. Commercial execution
- Strategic account classification (A/B; versioned policy)
- Customer wallet share
- Stakeholder Power Mapping
- Social Styles
- Competitor and installed-base intelligence
- Capital efficiency
- Measurable outcomes

These are defined in [SUPRABHA80](../intelligence/SUPRABHA80.md) and [POWER-MAPS](../intelligence/POWER-MAPS.md).

## 4. Every recommendation answers seven questions
1. **Why is this important?**
2. **What evidence supports it?** Source and freshness.
3. **What is the binding constraint?**
4. **What action is recommended?** NO_ACTION is valid.
5. **What revenue, GP, capital and risk are involved?**
6. **Who must act, and by when?**
7. **How will we measure whether it worked, and when?**

An unanswered question is shown as **missing**, never filled with a default.
