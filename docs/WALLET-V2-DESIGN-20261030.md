# Wallet V2 (Market rework, first slice): design

**Date:** 30 Oct 2026. **Author:** Claude (design, and design review of the screens). **Builder:** Codex. **Advisor-reviewed** before the handoff.
**Owner request (30 Oct):** "Market / wallet", chosen as the build until Sunday.
- It replaces the parked `claude/market-w1` slice, which is not integrated. Its tables are superseded and nothing is copied from it.
- **Train:** train 2 only if the full gate passes by Fri 6 Nov; otherwise train 3.

## 1. Decision it drives, and where it deviates from the ADRs
**Which accounts should management attack first, and where don't we know enough yet?** One list, ranked by **capture gap to the Wallet-share target**, with a computed **Focus band**. This slice has no map (Phase 7).

**Recorded deviations (not conformance claims):**
- **ADR-0006 (rank by expected GP opportunity).** A single company-wide margin would not change the order, so this slice ranks by capture gap, labelled as such. The GP ranking needs margin evidence per account or per division, and is the next slice.
- **ADR-0006 (rankings stored as `opportunity_score_snapshot` rows).** This slice computes rankings on read. Every read returns the policy version it used, and a stored ranking comes with the opportunity slice.
- **ADR-0007 (verifier).** Each snapshot records `entered_by` and an optional `verified_by`. Verification is a separate later action; in this slice `verified_by` stays null and the screen shows "Not verified".
- **Terms (ADR-0006).** "**Focus band**" (attention concentration, default 80%) and "**Wallet-share target**" (per-account destination, default 80%) are separate policy fields with these exact labels, and they are never conflated.

## 2. Measured on production (read-only, 30 Oct)
| Fact | Value |
| --- | --- |
| Customers in the master | 463 |
| Tally sales ledgers with sales since 1 Jul 2026 | 113 |
| … with a ledger master (GUID and name) | 112 |
| … whose name exactly matches one customer (0 ambiguous) | 106 |
| … already linked (`stockflow_economic_customer_identities`) | **2** |

- **Owner action:** confirm the customer links in Accounts (review exact matches; about 106, but the review screen's own count decides). This needs no build.
- **Sales figures are gated on certified coverage** (§4), so they appear only after train 2's connector update produces a certified nightly window, and the two Accounts-deferred vouchers no longer block it.

## 3. Data (new, append-only; nothing copied from Tally)
| Table | Rules |
| --- | --- |
| `private.stockflow_wallet_divisions` | Seeded: BIOCHEM Biochemistry, HAEM Haematology, IMMUNO Immunoassay, MOLECULAR Molecular, MICRO Microbiology, RAPID Rapid, COAG Coagulation, ELECTRO Electrolytes, HBA1C HbA1c, OTHERS Others. Columns: `code` (unique), `name`, `sort_order`, `active`. |
| `private.stockflow_wallet_snapshots` | `id uuid`; `customer_id` FK to `stockflow_customers`; `monthly_wallet_paise bigint` (≥ 0 and ≤ 9e15); `method` (`customer_stated`, `test_volume`, `manager_estimate`); `source text` (≥ 3 characters); `confidence` (`high`, `medium`, `low`); `as_of date` (≤ today IST); `note` (≥ 3 characters); `lowered_reason` (≥ 3 characters, required when below the current snapshot, otherwise null); `entered_by`; `entered_at`; `verified_by` (null). Current = latest by `(as_of, entered_at, id)`. |
| `private.stockflow_wallet_snapshot_divisions` | `(snapshot_id, division_id)` unique; `monthly_wallet_paise ≥ 0`; the sum must be ≤ the total. |
| `private.stockflow_wallet_policies` | `version int` (unique, inserted as max + 1; seed version 1 = 8000 / 8000 / 6, `entered_by 'seed'`); `wallet_share_target_bps` (1000–10000); `focus_band_bps` (1000–10000); `stale_after_months` (1–24); `note`; `entered_by`; `entered_at`. |

- Every table has a `no_delete` trigger using the existing `private.prevent_business_delete()` and an `immutable` trigger using the existing `private.prevent_immutable_pricing_update()`. Divisions get only `no_delete`; there are no division edits in this slice.
- Every table has RLS enabled and `revoke all … from public, anon, authenticated, service_role`.

## 4. Figures (computed on read)
- **Window:** the last 3 complete calendar months in Asia/Kolkata; for example, on 30 Oct that is Jul–Sep 2026.
- **Certified:** for every company present in `stockflow_economic_customer_identities`, `private.stockflow_sales_coverage_status(company, window_from, window_to_inclusive)->>'complete'` is true **and** `private.stockflow_sales_reconciliation(company, month)->>'state' = 'matches'` for each of the 3 months.
- **Not certified (fail closed):** the read returns `sales`, `share`, `untapped`, `captureGap`, `inFocusBand` and the focus summary as **null**, and the summary carries the coverage state. The no-estimate view then sorts by name.
- **Sales/month (certified only):**
  - for the account's linked ledgers, sum `net_sales_paise` over the latest revision per `source_id` that is not cancelled, of kind sale, return or credit, dated in the window;
  - this is exactly the selection used by `stockflow_sales_reconciliation`;
  - divide by 3, rounding half-up to integer paise: `floor((sum*2 + 3) / 6)` for sum ≥ 0. For negative sums use `-floor((-sum*2 + 3)/6)`.
- **Share** (permille): `round(sales*1000/wallet)`, half-up; null when there is no snapshot or wallet = 0.
- **Untapped:** `max(wallet − sales, 0)`.
- **Capture gap:** `max(ceil(target_bps*wallet/10000) − sales, 0)`. `ceil` keeps the target conservative; the integer arithmetic is in paise.
- **Focus band:**
  - order the accounts with a snapshot and a capture gap > 0 by capture gap descending, then by customer name, then by id;
  - the band is the shortest prefix whose cumulative gap × 10000 ≥ `focus_band_bps` × total gap.
- **Below sales:** sales > wallet. **Stale:** `as_of` < (today IST − `stale_after_months` months).
- **Unlinked line (certified only):** the sum over window ledgers with no identity, ÷ 3 as above, plus their count. It is never attributed to an account.

## 5. Contract: `lib/wallet-types.ts` (exact)
```ts
export type WalletMethod = 'customer_stated' | 'test_volume' | 'manager_estimate';
export type WalletConfidence = 'high' | 'medium' | 'low';
export type WalletView = 'focus' | 'all' | 'no_estimate' | 'stale' | 'below_sales';
export type WalletPolicy = { version: number; walletShareTargetBps: number; focusBandBps: number; staleAfterMonths: number; note: string; enteredBy: string; enteredAt: string };
export type WalletCoverage = { certified: boolean; windowFrom: string; windowTo: string; windowLabel: string; reason: string | null };
export type WalletRow = {
  customerId: string; name: string; city: string | null;
  walletPaise: number | null; salesPaise: number | null; sharePermille: number | null;
  untappedPaise: number | null; captureGapPaise: number | null;
  confidence: WalletConfidence | null; asOf: string | null; verified: boolean;
  stale: boolean; belowSales: boolean; inFocusBand: boolean | null;
};
export type WalletWorkspace = {
  policy: WalletPolicy; coverage: WalletCoverage; view: WalletView; page: number; pageSize: 50; total: number; rows: WalletRow[];
  summary: { focusCount: number | null; focusGapPaise: number | null; estimatedAccounts: number; accountsWithSales: number | null; unlinkedSalesPaise: number | null; unlinkedLedgers: number | null };
};
export type WalletSnapshot = { id: string; monthlyWalletPaise: number; method: WalletMethod; source: string; confidence: WalletConfidence; asOf: string; note: string; loweredReason: string | null; enteredBy: string; enteredAt: string; verifiedBy: string | null; divisions: Array<{ code: string; name: string; monthlyWalletPaise: number }>; unallocatedPaise: number };
export type WalletAccount = { policy: WalletPolicy; coverage: WalletCoverage; row: WalletRow; current: WalletSnapshot | null; history: WalletSnapshot[]; divisions: Array<{ code: string; name: string }> };
export type WalletCommand =
  | { action: 'get_wallet_workspace'; payload: { view: WalletView; page: number; search: string } }
  | { action: 'get_wallet_account'; payload: { customerId: string } }
  | { action: 'record_wallet_snapshot'; payload: { requestId: string; customerId: string; monthlyWalletPaise: number; method: WalletMethod; source: string; confidence: WalletConfidence; asOf: string; note: string; loweredReason: string | null; divisions: Array<{ code: string; monthlyWalletPaise: number }>; expectedCurrentSnapshotId: string | null } }
  | { action: 'set_wallet_policy'; payload: { requestId: string; walletShareTargetBps: number; focusBandBps: number; staleAfterMonths: number; note: string; expectedVersion: number } };
export function validateWalletCommand(input: unknown): WalletCommand; // throws Error('Invalid wallet request') on any violation
```
- **Validation:**
  - `page` ≥ 1; `search` ≤ 80 characters;
  - UUIDs are canonical; `monthlyWalletPaise` is an integer from 0 to 9e15;
  - `source` and `note` are 3–500 characters; `loweredReason` is null or 3–500 characters;
  - `asOf` is `YYYY-MM-DD`; `divisions` holds at most 10 entries with unique codes;
  - policy bounds as in §3.
- **Writes return** `{ ok: true, snapshotId }` or `{ ok: true, version }`.

## 6. Gateway `public.stockflow_wallet_gateway(p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb)`
- **Signature and auth:** the same signature, gateway-key check and actor-role lookup as `public.stockflow_economics_gateway` (`20261007183000`).
- **Roles:** administrator and management for every action. Everyone else gets **PT403**.
- **Writes:** `begin_/finish_stockflow_command` for idempotency, plus an audit event.
- **`record_wallet_snapshot`:**
  - `pg_advisory_xact_lock(hashtextextended('wallet:'||customer_id,0))` **before** reading the current snapshot;
  - PT409 if the current id ≠ `expectedCurrentSnapshotId`;
  - 22023 if lowered without a reason, if a reason is given when not lowering, if the division sum exceeds the total, or if a division code is unknown or inactive;
  - 22023 if the customer is missing.
- **`set_wallet_policy`:**
  - takes `pg_advisory_xact_lock(hashtextextended('wallet-policy',0))`;
  - PT409 if `expectedVersion` ≠ the current version;
  - map any `unique_violation` to PT409.
- **Grants:** the gateway is executable by `service_role` only, like its siblings.
- **Wiring, all four places:**
  1. the Edge allowlist in `supabase/functions/stockflow-orders/index.ts`;
  2. the Next route `app/api/wallet/route.ts` (GET for the reads, POST for the writes, following `app/api/instrument-economics/route.ts`);
  3. the `GatewayAction` union in `lib/order-gateway.ts`;
  4. the gateway itself.
- **Registration:** the migration and the test go in `tests/pricing-migration-local.ps1` and `tests/pricing-release-preflight.mjs`, and the migration's `not_deployed` sha256 goes in `supabase/migration-history-map.json`.
- **Migration:** `20261030130000_wallet_v2.sql`, which sorts after `20261030101000`.

## 7. Screen: Accounts → Wallet (no new nav item)
- **Who sees it:** a "Wallet" view in `components/accounts-workspace.tsx`, for administrator and management only, lazily loaded.
- **Header, certified:**
  - "**Focus band**: 8 accounts hold 80% of the capture gap · ₹4.2 L/month";
  - "Ranked by gap to the 80% **Wallet-share target** · based on 9 of 112 accounts with an estimate · From Tally, Jul–Sep 2026".
- **Header, not certified:** "Sales figures appear once Tally coverage is certified (Jul–Sep 2026)". A Sales coverage link points to Economics.
- **Chips:** Focus · All · No estimate · Stale · Below sales. Focus and Below sales are disabled when not certified. There is a search box.
- **Row:**
  - name and city;
  - wallet/month; our sales/month; a share bar with its label;
  - the gap to the target;
  - a confidence dot with text; as-of; "Not verified".
  - On a phone, two lines and no horizontal scroll.
- **Account sheet:**
  - figures;
  - a division table with an Unallocated row;
  - **one primary action, "Update estimate"**;
  - the form: total (₹/month), method, source, confidence, as-of, note, an optional division split, and a reason field shown only when the new total is lower;
  - history, collapsed.
- **Targets link** (management): opens the policy form with the fields "Wallet-share target (%)", "Focus band (%)" and "Stale after (months)", plus a note.
- **Unlinked line:** "Not linked to a customer: ₹X/month across N Tally ledgers · Review links". The link opens the existing customer-link review.

## 8. Acceptance (written before code)
**SQL** (`supabase/tests/wallet_v2.sql`):
1. Update or delete on any of the four tables raises an exception.
2. Lowering without a reason gives 22023; a reason without lowering gives 22023; a division sum above the total gives 22023; an unknown division gives 22023.
3. A stale `expectedCurrentSnapshotId` gives PT409; a wrong policy version gives PT409.
4. **Two-session race** (`supabase/tests/wallet_v2_concurrency.sql`, in the pattern of `instrument_register_concurrency.sql`): two snapshot inserts for one customer with the same expected id give one success and one PT409.
5. Roles: sales, operations, warehouse, billing, accounts and viewer get PT403 on all four actions.
6. Not certified: the sales, share, gap and focus fields are null and `coverage.certified` is false.
7. Certified: build the fixture coverage and matching controls. Sales/month equals the hand-computed figure for a fixture with a sale, a return, a credit, a revised voucher (only the latest counts), a cancelled voucher (excluded) and a line outside the window (excluded), including half-up rounding of ÷ 3.
8. The Focus band equals a hand-computed prefix, including the tie order.
9. Share is null without an estimate; the below-sales and stale flags work; unlinked ledgers appear only in the unlinked line.
10. Replaying the same `requestId` returns the original result and inserts no second row.

**Unit:** `tests/unit/wallet-types.test.ts` (the validator) and the route tests in the style of the economics route tests.

**Browser:** `tests/pricing-browser/wallet.spec.ts`, phone 375 and desktop, with mocked API responses:
- both header states;
- the chips;
- recording an estimate;
- the reason field appears only when lowering;
- non-management roles have no Wallet view;
- no horizontal scroll.

## 9. Not in this slice
The map; opportunities and actions (ADR-0008); margin evidence and the GP ranking; stored ranking snapshots; verification; prospects (D-08).
