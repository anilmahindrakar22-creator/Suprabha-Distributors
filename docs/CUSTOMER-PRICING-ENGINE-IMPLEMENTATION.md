# Customer Pricing Engine implementation

## Authority boundary

StockFlow governs order pricing decisions and approvals. TallyPrime remains the accounting, inventory, and statutory-invoice authority. This release adds read-only sales-price evidence and a tested purchase-cost import boundary; it does not create, alter, cancel, or delete Tally vouchers.

## Deterministic resolution

For an exact canonical customer and stock item on the pricing date, the server resolves an effective approved customer contract first, then the latest eligible Tally sales invoice. Exceptional, zero-rate/FOC, and future sales are retained as evidence but never silently proposed. Missing evidence produces review, never an invented rate.

Reliable purchase-cost evidence is compared with the applicable historic cost. The restricted workspace shows GP, margin erosion, guardrail state, and a bracketed suggestion only when a configured target and versioned rounding rule exist. Cost increases never automatically change a customer rate.

## Security and integrity

Commercial values are available only through the pricing gateway to active `administrator`, `management`, and `accounts` roles. General order and stock responses contain only a safe pricing workflow state. Connector pricing evidence is atomically consumed into private append-only tables and removed from the public operational snapshot.

Approval uses an order lock, optimistic version, idempotency record, immutable/versioned decision, audit event, billing snapshot, order state, and transactional outbox in one database transaction. Order-line changes invalidate the active approval and snapshot. Entry into billing is blocked without a current snapshot and rechecks whether authoritative cost evidence changed.

## Effective-dated customer prices

Contracts are proposed from the restricted order workspace and approved or rejected by Administrator/Management. Approved date ranges cannot overlap. A replacement closes the previous range, marks it superseded, and preserves it for historical resolution and audit.

## Safe deployment gates

The migration seeds a deliberately conservative `bootstrap-review-only-v1` policy. It forces human review, permits no automatic override, and disables calculated suggestions. Before an office pilot, management must approve and configure the real minimum margin, target margin, override threshold, and rounding rule as a new effective-dated policy.

The complete migration and `supabase/tests/pricing_engine_integrity.sql` must pass on an isolated non-production Supabase branch before production migration or edge-function deployment. Live purchase-cost extraction also remains disabled until its exact read-only Tally query is validated without affecting office performance.
