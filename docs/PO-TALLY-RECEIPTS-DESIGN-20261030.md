# Design: Tally receipts for purchase orders (next train)

*Claude, 30 Oct 2026. Train `claude/train-20261113` (cut Fri 13 Nov, release Sun 15 Nov). Builds on the supplier POs in `20261029100000_supplier_purchase_orders` (train 6 Nov).*

## 1. Problem and decision it drives
Today a person marks a PO received by typing quantities, even though Tally already has the purchase voucher. That's double entry, and receipts get forgotten. Forgotten receipts leave "To order" overstated, because open PO quantity is subtracted from need.

**Outcome:** on an open PO, StockFlow shows "Tally shows a receipt", and one confirmation records it with the voucher as evidence.

## 2. Evidence (read-only production check, 30 Oct)
- **Purchase vouchers:** `private.stockflow_economic_source_vouchers` has 544 purchase vouchers with 1,629 lines, from 3 Oct 2025 to 29 Oct 2026. 56 of them fall in the last 30 days.
- **Item match:** the line `evidence->>'label'` exactly equals a catalogue `tallyKey` for **548/548** purchased items. `product_id` is a GUID and isn't the catalogue key.
- **No supplier** on purchase vouchers (`customer_source_id` is null; no party key). So a match is by **item + date**, and **a person always confirms** (consistent with "no automatic identity mapping").
- **Single company and a single unit value today.** 13 vouchers carry the same item on two lines (batches). Some vouchers have newer revisions.

## 3. Rules (invariants)
- **R-1 Person confirms.** Nothing is received automatically. Suggestions are advisory.
- **R-2 One voucher line, one PO.** A Tally purchase line (identified by `company_id` + voucher `source_id` + `line_key`, so it survives re-revision) can be linked to **at most one** PO line, ever. This is enforced by a unique index, not by app code.
- **R-3 Eligibility.** A candidate line must meet all of the following:
  - its voucher is `kind='purchase'`, not cancelled, and the **latest revision** for its `source_id`;
  - its label equals the PO line's `tally_item_key`;
  - `business_date >= (po.created_at at time zone 'Asia/Kolkata')::date`;
  - `quantity > 0`;
  - it isn't linked yet.
- **R-4 Units.** The candidate is selectable only when `lower(btrim(unit))` equals the PO line unit, or the product's base unit when the PO unit is null. Otherwise it shows as "different unit, enter by hand".
- **R-5 No over-receipt.** For each line, the linked quantity plus the existing `received_quantity` must be ≤ the PO line quantity. If it's more, the command is rejected with the remaining quantity in the message, and the person records it by hand. Nothing is capped silently.
- **R-6 No amounts.** Candidates carry date, voucher reference, quantity and unit only, never rates or values. Operations may see them.
- **R-7 Audit.** Links are append-only (`no_delete` and `immutable` triggers). The receipt writes the existing `receive_purchase_order` event with `metadata.source='tally'` and the links. Idempotency uses `begin_/finish_stockflow_command` with a UUID key. The PO `version` check and `for update` lock work as today.
- **R-8 Roles.** The same roles as the purchase gateway: administrator, management, operations. The same rate limit.

## 4. Schema (migration `20261102090000_po_tally_receipts`, additive)
`private.stockflow_po_tally_receipt_links`:
- `po_id uuid` references the PO;
- `tally_item_key text`, with an FK to the PO line (`po_id`, `tally_item_key`);
- `company_id`, `source_id`, `line_key text not null`;
- `source_line_id uuid`, references `stockflow_economic_source_lines` (the revision used);
- `business_date date`, `quantity numeric > 0`, `unit text`;
- `linked_by text`, `linked_at timestamptz default now()`.

Constraints and access:
- unique (`company_id`, `source_id`, `line_key`) → R-2;
- RLS enabled, all access revoked, and `no_delete` and `immutable` triggers.

Also add the index `stockflow_economic_source_lines ((evidence->>'label'))`. It's the only change to an existing economics object, and it's an index only.

## 5. Gateway `public.stockflow_po_receipt_gateway(p_gateway_key, p_actor_email, p_action, p_payload)`
Key check, active member, roles and rate limit are the same as `stockflow_purchase_gateway`.

| Action | Payload | Returns |
| --- | --- | --- |
| `get_tally_receipt_counts` | `{ids: uuid[1..20]}` | `{counts: {<poId>: n}}`. `n` is the number of eligible, selectable candidate lines across that PO's lines with remaining > 0. Non-open POs → 0. |
| `get_tally_receipts` | `{id}` | `{poId, version, lines:[{itemKey, itemName, unit, quantity, receivedQuantity, remaining, candidates:[{sourceId, lineKey, date, reference, quantity, unit, selectable, reason}]}]}`. At most 20 candidates per line, ordered by date then reference. `reason` ∈ `unit_mismatch` \| `exceeds_remaining` \| null. Open POs only. |
| `receive_from_tally` | `{id, expectedVersion, idempotencyKey, links:[{itemKey, sourceId, lineKey}] (1..100, distinct)}` | the PO JSON, the same shape and redaction as `receive_purchase_order`. |

For `receive_from_tally`, inside one transaction:
1. lock the PO and check its version;
2. re-validate each link against R-3, R-4 and R-5 (summed per item);
3. insert the links. A unique violation becomes `PT409` "Already recorded on another PO";
4. add the summed quantity to `received_quantity`;
5. set status to `received` when every line is complete;
6. bump the version;
7. write the event.

Errors use the existing codes: `22023` invalid, `PT409` conflict or changed, `42501` role.

## 6. App
- **Edge function and route:** add the three actions to the allowlist and routing in `supabase/functions/stockflow-orders/index.ts`, and to the purchase-orders Next route. Then register them, following the gateway checklist in `CONSTRAINTS.md`: `GatewayAction`, `pricing-migration-local.ps1`, the preflight and its arrays, and `migration-history-map.json` (`not_deployed`).
- **PO list** (`components/purchase-orders-panel.tsx`): after a page of open POs loads, call `get_tally_receipt_counts` once for the visible open IDs. A PO with n > 0 shows a small **"Tally shows a receipt"** chip. That's the only list change. A failed count read shows nothing; it never shows an error on the list.
- **Mark received sheet:**
  - **When candidates exist,** a "From Tally" section comes first. Each line lists its candidates as checkboxes: "29 Oct · Purchase 1234 · 10 Nos".
    - A candidate is preselected only when it is the line's single selectable candidate.
    - Non-selectable candidates show their reason in muted text ("different unit, enter by hand" or "more than still due (4)").
    - The primary button is **"Record Tally receipt"**. The manual quantities stay available behind "Enter quantities by hand".
  - **When there are none,** today's manual form appears unchanged.
  - **409 handling:** the sheet stays open, the candidates reload, and the notice reads "This PO changed; check and try again".
- **Phone:** the sheet must scroll at 375px, with no horizontal overflow and the sticky primary button reachable.

## 7. Acceptance checks (write these first)
**SQL** `supabase/tests/po_tally_receipts.sql`, on a real database:
- **R1:** a purchase line with a matching label, dated on or after the PO date, is a candidate. One dated before the PO isn't. A cancelled voucher isn't. A superseded revision isn't, while its latest revision is.
- **R2:** `receive_from_tally` adds the quantity, writes the link and the event (`source='tally'`), bumps the version, and sets status to `received` when complete.
- **R3:** the same line can't be linked to a second PO (`PT409`), including after a newer revision of the same voucher arrives.
- **R4:** an over-receipt is rejected with `22023`. Nothing changes.
- **R5:** a unit mismatch is not selectable, and the write rejects it.
- **R6:** idempotent replay returns the same result with no double add. A stale `expectedVersion` returns `PT409`.
- **R7:** operations gets candidates and receives, and no response contains `rate`, `amount` or `paise`. A sales or warehouse member gets `42501`.
- **R8:** links can't be updated or deleted (triggers).
- **R9:** counts: an open PO with one candidate returns 1, a received PO returns 0, and a request with more than 20 IDs returns `22023`.
- **R10 (`po_tally_receipts_concurrency.sql`, dblink):** two sessions link the same voucher line to two POs; exactly one succeeds.

**Browser** `tests/pricing-browser/po-tally-receipts.spec.ts`, at 375px and 1280px:
- the chip appears;
- the sheet shows the candidates with the single one preselected;
- Record sends the `links` payload;
- a mismatched unit shows the muted reason and no checkbox;
- a 409 keeps the sheet open with the notice;
- with no candidates, the manual form appears.

Plus the replay, unit, tsc and oxlint.

## 8. Known limits
- No supplier on the Tally purchase, so a person checks it is the right supplier.
- A Tally revision after linking doesn't update the receipt. The link keeps the revision that was used.
- Purchase returns aren't subtracted.
