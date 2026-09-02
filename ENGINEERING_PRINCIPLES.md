# Suprabha OS engineering principles

StockFlow is the first operational module of **Suprabha OS**, a transaction-safe operating system for Suprabha Distributors. These rules apply to every module and integration.

1. Database truth beats UI assumptions.
2. Every financial or stock change is transactional.
3. Never silently lose a business event.
4. External systems, including Tally, are unreliable by definition and require acknowledgement.
5. Every retry must be safe and idempotent.
6. Critical changes are attributable and auditable.
7. Business history is never hard-deleted; use cancellation, voiding, supersession or deactivation.
8. One business entity has one canonical identity.
9. Calculated values have explicit, versioned definitions.
10. Estimates are labelled as estimates and retain method, confidence and verification date.
11. Authentication and authorization are enforced server-side; UI visibility is only a convenience.
12. No feature may corrupt accounting, inventory or audit history.
13. A modular monolith is preferred until measured scale justifies extraction.
14. Tests protect business rules, transactions, concurrency and recovery—not only code paths.
15. Build current modules so future modules plug in rather than replace them.

## Definition of a trustworthy critical flow

A critical operation must have database constraints, authorization, transaction boundaries, idempotency, audit evidence and rollback/concurrency tests. A successful UI message alone is not proof of completion.

