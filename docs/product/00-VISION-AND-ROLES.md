# Product vision and user roles

**Status:** canonical.
**Sources:**
- [REQUIREMENTS §1](../REQUIREMENTS-AND-DELIVERY-PLAN.md);
- [SUPRABHA_OS_ARCHITECTURE §Authorization](../SUPRABHA_OS_ARCHITECTURE.md);
- `lib/user-types.ts`;
- [OPERATING-MODEL-ADOPTION](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/blob/839497a/docs/OPERATING-MODEL-ADOPTION.md);
- [EMPLOYEE-LEARNING-AND-ADOPTION](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/blob/839497a/docs/EMPLOYEE-LEARNING-AND-ADOPTION.md);
- owner brief.

**Last verified:** 13 Oct 2026.

## Vision
A reliable operating system that helps Suprabha capture profitable diagnostic market share while controlling working capital and protecting customer relationships. The phases are:
- **First**, trustworthy daily operations: fast orders, correct Tally bills, delivery.
- **Then**, decision intelligence that names the few actions worth taking.

It is not a collection of dashboards.

## Roles (as built) and their jobs

| Role | Main jobs | Commercial intelligence access |
| --- | --- | --- |
| `administrator` | everything; user management | full |
| `management` | approvals, oversight, Action Center | full |
| `accounts` | billing hand-off, invoice reconciliation, pricing evidence, economics | economics and pricing evidence |
| `operations` | confirm, prepare, dispatch, delivery, installations, service | none (service register only) |
| `warehouse` | pick and pack | none |
| `sales` | capture orders, customers, request prices | **own assigned accounts, after Phase 4** |
| `viewer` | read-only | none |

- **Roles are sets.** A person may hold several.
- **Architecture-doc names** ("Order desk", "Service", "Customer") map as in [ADR-0013](../architecture/06-DECISION-RECORDS.md).
- **Director** is open ([D-04](../planning/OPEN-DECISIONS.md)).

## Key journeys
1. **Order desk:** customer + products → save; pending/draft states are clear (REQ-04).
2. **Operations:** today's queue → confirm → prepare → dispatch → deliver, with evidence.
3. **Accounts:** bill in Tally → enter the invoice reference → verified match; review mismatches.
4. **Management:** Action Center ("Today") → approve, modify or reject → review outcomes.
5. **Sales (Phase 4+):** my accounts → Account page (wallet, gaps, Power Map) → log a visit → next action.
6. **Accounts/Management (Phase 2):** placement proposal → payback tier → approval → recovery tracking.

## Operating model (from [OPERATING-MODEL-ADOPTION](https://github.com/anilmahindrakar22-creator/Suprabha-Distributors/blob/839497a/docs/OPERATING-MODEL-ADOPTION.md))
- **SOP-to-system mapping (§6):** each standard operating procedure maps to the screen and command that executes it. No shadow spreadsheets.
- **Phased adoption (§8–10):**
  - adopt role by role;
  - track adoption KPIs, such as active use and data completeness, never surveillance;
  - implementation guardrails as in the source.

## Adoption
- **Learning levels:** Operate → Understand → Improve.
- **Guidance over forms:** the software asks short contextual questions rather than presenting blank forms (employee learning framework).
- **Management cadence:** daily, weekly, monthly and quarterly, per the operating model.
