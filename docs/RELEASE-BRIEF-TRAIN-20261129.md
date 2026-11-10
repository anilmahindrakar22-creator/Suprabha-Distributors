# Release brief: train 29 Nov 2026 (`claude/train-20261129`)

**Who reads it:** the integration chat, the only deployer.

**Status:** being built, local only. The owner approves one push when the train is complete.

**Stacked on:** train-22 at `9b5d26c`. If train-22 changes during its sign-off, merge it into this train before release.

## What ships
| Area | Who sees it | Summary |
|---|---|---|
| Visit reasons | Sales (record), management (read) | Every visit form asks for a reason (11 categories, lab said / our view). Shown as hints in Wallet diagnosis |
| No territory filter | Accounts, All scope | Lists accounts with no territory |
| Growth P1 / P1b | Management, administrator | Revenue tree, H1→H2 bridge, scorecard, monthly charts, purchases against sales. Every chart opens its lab or invoice list |
| Growth P2 Act | Management, administrator | Action inbox (rules R1–R4 v1). Accept creates a commercial action for an owner; Snooze/Reject with a reason; outcomes |
| Company-wide GP | Management, administrator | Separate read model at average purchase cost. Instrument Economics untouched |
| P3 Profit | Management, administrator | GP by month (consumables vs instruments); "Where margin can grow"; margin by lab and item (sortable, searchable); item price spread by lab |
| Instrument kind | Management, administrator | Items with an average purchase cost of ₹25,000 or more count as instruments. Override in Brand setup (append-only, with reason) |
| Review prices | Roles that can already open Pricing | Opens the lab's price book with the item focused and a proposal prefilled. Never submits; approval unchanged (ADR-0003) |
| Billed below approved price | Management, administrator | Flags Tally sale lines billed under the customer's approved price. Read-only |

## Migrations (apply in order; each replays on PG15 with its SQL test)
1. `20261129090000_visit_reasons.sql`: new table, plus patches to three gateways.
2. `20261129100000_accounts_no_territory.sql`: read filter only.
3. `20261129110000_growth_read.sql`: new `stockflow_growth_gateway`.
4. `20261129120000_growth_p1b.sql`
5. `20261129130000_growth_tree_lists.sql`
6. `20261129140000_growth_inbox.sql`:
   - **live constraint change:** the opportunity origin adds `growth_rule`;
   - **new write path:** Accept creates or reuses an opportunity and adds one action;
   - **new table:** append-only `stockflow_growth_decisions`.
7. `20261129150000_growth_gp.sql`: GP read only.
8. `20261129160000_growth_item_kind.sql`:
   - **new append-only table:** `stockflow_growth_item_kind_overrides`;
   - **new write action:** `set_item_kind` on the brand-mapping gateway (management and administrator only).
9. `20261129170000_growth_margin.sql`: margin reads.
   - Shares one costed-line helper with GP (`stockflow_growth_costed_lines`); GP output is unchanged (GP1–GP12, K1–K8 replay).
   - Lab rows exclude sales with no Tally ledger, so the lab list can total slightly less than company consumables GP.
10. `20261129180000_growth_billed_below.sql`: read only.
   - Approved prices are in INR per base unit, before GST; billed rate = line net ÷ quantity.
   - Each line is checked against the price in effect on its invoice date (approved, or since superseded).
   - Lines more than 2.5× apart are counted as unit differences, not flagged.

## Edge function
Redeploy `stockflow-orders`. New routed actions:
- **Growth reads:** `get_growth`, `get_growth_labs`, `get_growth_inbox`, `get_growth_margin`, `get_growth_margin_detail`, `get_growth_billed_below`.
- **Growth write:** `decide_growth_card`, through the request gate.
- **Brand-mapping write:** `set_item_kind`, through the request gate.

## Financial sign-off questions
1. **Growth figures:**
   - revenue = latest voucher revision, not cancelled, kinds sale, return and credit;
   - bulk = a sale voucher of ₹2 L or more.
   Production snapshot, 9 Nov: revenue ₹176.8 L, repeat ₹131.7 L, bulk ₹45.1 L.
2. **Certification:** sales from Aug to Oct show as "differs" against Tally, so every Growth figure, and every inbox card, is labelled "Not confirmed". The older Recover signal waits for 9 certified months; the inbox does not. Is that acceptable?
3. **GP method:**
   - average purchase cost to date, per item and unit;
   - returns reverse the matched sale's cost and bucket;
   - lines whose cost differs from the sale by more than 10× in either direction are left out (unit mismatch).
   Production estimates, 9 Nov:
   - cost known for 89.8% of sales;
   - overall about 18.6%;
   - consumables 28.1% once instruments are classified by item;
   - instruments below cost, about ₹3.0 L a year.
   Please spot-check a few lines against Tally.
4. **Instrument rule:** ₹25,000 average purchase cost. Today it catches only equipment (18 items).
5. **Price spread:**
   - typical price = the median of per-lab unit prices (at least 3 labs);
   - "below" means 0.4× to 0.9× of typical; under 0.4× is treated as a probable pack difference.
   Estimate: ₹2.05 L a year across 91 items. Some low prices are deliberate volume rates.
6. **Pricing engine dependency:** Review prices feeds the governed price book.
   - The pricing pilot is on hold, and production has 1 approved customer price.
   - Approved prices apply to new StockFlow orders. Tally invoices are not written by StockFlow; the billed-below check flags any differences.
   - Confirm the pricing pilot gates before relying on this.

## Access and data rules (verified in the review)
- Purchase-derived figures (GP, cost, margin) appear only behind `stockflow_growth_gateway`, which allows management and administrators only. Operations never sees them.
- Commercial actions created by Accept carry sales-derived figures only. "New, not back" cards carry no expected gain.
- Price-review reasons carry sales figures only.
- Override and decision tables are append-only and audited.

## Checks to run at release
- Replay `tests/pricing-migration-local.ps1` on PG15, then `node tests/pricing-release-preflight.mjs`.
- Full vitest and tsc.
- Playwright pricing config: Growth, Accounts, My actions, Brand setup, price-review hand-off.
- CI (`ci.yml`) on the pushed branch.

The AL9 auto-link timing check can fail under heavy machine load. It passed on a quiet rerun each time.

## Not in this train
- GP by principal (needs Brand setup saves).
- Territory chart (needs the territory list).
- A list of free-goods lines.
- Call logging.
- Stage 2 scoring.
