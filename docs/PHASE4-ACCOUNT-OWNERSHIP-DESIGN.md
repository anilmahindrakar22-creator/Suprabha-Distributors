# Phase 4, slice 1: account owner, territory and visits

**Status:** building on the recommended defaults (owner said "continue" on 14 Oct 2026 without choosing): D-16 = see all, with "My accounts" as a filter; D-17 = any sales or operations user logs visits. Both are reversible. D-18 is open (management creates territory names). **Roadmap:** Phase 4 (depends only on Phase 0). **Author:** Claude, 13 Oct 2026.
**Utility test:** every field answers *who is responsible for this account, and who should be visited next.*

## 1. What exists
- `stockflow_customers` (Tally ledger sync), a lazy directory and the Tally balance.
- Order row scope (`private.stockflow_role_order_scopes`): `global` or `created_by` per role. **Every role is `global` today.**
- Order assignment (who handles an order) is separate, and it stays separate.
- `claude/market-w1` has a pin/location backend (`20261012120000_market_customer_locations`). It's reused here, reworked to ADR-0006/0007 (location belongs to Customer).

## 2. Scope of slice 1
1. **Account owner and territory** (`customer_assignment`): effective-dated `owner_email` (an active member) and `territory` (from a short, managed territory list). One open assignment per customer. History is kept: a change closes the old row, it never edits it.
2. **Location** (`customer_location`): exact pin **or** town, with a precision flag (`pin`/`town`), source, `verified_by` and `verified_at`. Never auto-geocoded. Taken from market-w1 and reworked.
3. **Visit log** (`customer_visit`): date, member, outcome (a short list: met, not available, order taken, issue raised, other), a note, and an optional **next visit date**. Append-only.
4. **Coverage queue** (one screen, Customers → "My accounts"):
   - for the signed-in owner (managers can pick an owner or territory);
   - rows sorted by **overdue next visit**, then **longest since last visit**;
   - columns: account, town, last visit, next visit, last order date;
   - one action: **Log visit**.

## 3. Not in slice 1 (utility rule or pending decision)
- Contacts (needs the personal-data policy, ADR-0018 / D-07).
- Prospects (D-08), and A/B classification (D-13).
- Competitor-equipment observations (Phase 6 evidence).
- Any map (Phase 7).

## 4. Rules
- Commands use the standard pattern: idempotency key, `expectedVersion`, audit, **PT409** on conflict.
- Only **administrator/management** assign owners and territories. **Sales** log visits on accounts they own (or any account, if D-17 = global).
- Row scope: see D-16.

## 5. Owner decisions
- **D-16, sales visibility:** should a salesperson see **only their assigned accounts** (and those accounts' orders)? Or **everything**, as today?
  - **Recommendation:** keep everything visible for now. "My accounts" is a filter, not a restriction. Revisit after assignments are complete, because restricting before every account has an owner would hide accounts.
- **D-17, who logs visits:** owner only, or any sales/operations user?
  - **Recommendation:** any sales or operations user can log a visit. It's recorded with their name.
- **D-18, territories:** what are the territories? A list of names (for example districts or route names). Until you supply it, the screen lets management create territory names.
