# Tally integration, freshness and reconciliation contracts

**Status:** canonical.
**Sources:** [REQUIREMENTS §4 (REQ-08–16)](../REQUIREMENTS-AND-DELIVERY-PLAN.md); [LIGHTWEIGHT-RECOVERY](../LIGHTWEIGHT-RECOVERY.md); [CONNECTOR-VALIDATION-2026-09-05](../CONNECTOR-VALIDATION-2026-09-05.md); economics plan §§2–4; [TALLY-PRICING-HISTORY-AND-SAFE-BILLING-TEST](../TALLY-PRICING-HISTORY-AND-SAFE-BILLING-TEST.md); ADR-0001.
**Last verified:** 13 Oct 2026.

## 1. Boundary
- Tally Prime is authoritative for accounting, invoices, ledgers, inventory and purchase cost.
- Suprabha OS reads Tally through **one office connector per company and installation**.
- **No automated Tally posting** in the current phase: staff bill in Tally.
- Browsers never contact Tally.

## 2. Workloads and cadence (REQ-12, REQ-13)

| Workload | Starting cadence | Notes |
| --- | --- | --- |
| Stock snapshot + recent invoices | ~15 min | cooldown; a browser refresh never triggers an export |
| Customer and catalog masters | ~4 h | catalog cached atomically |
| Historical baseline / reconciliation | outside billing hours | bounded windows plus scheduled full reconciliation |
| Economics source vouchers (sales/purchases) | targeted today | **full-sales export required** for Phases 3, 5 and 7 (owner approved, 13 Oct; plan drafted by the integration owner) |

## 3. Contracts
- **Identity:** the canonical keys are `(company, source customer id)` and `(company, source product id)`. Names are labels only; nothing is matched fuzzily (economics plan §2).
- **Revisions:** source lines are immutable revisions. Derived results reference the revision and the rule version.
- **Freshness:**
  - every snapshot records extraction time and upload time separately;
  - retries never advance freshness (REQ-14);
  - the screens show staleness. For example, invoice verification is withdrawn when the supporting snapshot is invalid, older than 20 minutes, or more than 5 minutes ahead of the browser clock ([LIGHTWEIGHT-RECOVERY](../LIGHTWEIGHT-RECOVERY.md)).
- **Partial failure:** the last good values are kept, each domain records its own error and freshness, and an empty failed response never erases masters (REQ-14).
- **Invoice identity (REQ-08–10):** a match is verified only on company + financial year + voucher identity + customer ledger. Ambiguous, cancelled or mismatched matches never get a verified badge.
- **Quantity reconciliation (REQ-11):** separate from invoice identity, and not built yet.
- **Company guard:** an export is accepted only from the identified company. A wrong company is rejected.
- **Cost (economics plan §4):** actual GP = actual net Tally sale value − attributable Tally purchase cost. Missing cost shows as COST_UNAVAILABLE and is never zero or today's rate.

## 4. Reconciliation
- **Ongoing:** order ↔ invoice identity (built), quantity (design), source coverage per run, import exceptions with owner and reason (built in economics).
- **Native comparison:** the standalone Tally-dashboard native report comparison is a local prototype. It is never presented as certification.

## 5. Acceptance (Phase 0)
- Connector restart and retry.
- Company identity confirmed on office Tally.
- Freshness messages accurate.
- No billing slowdown above 10% p95 in a before/after trial (REQUIREMENTS §6).
