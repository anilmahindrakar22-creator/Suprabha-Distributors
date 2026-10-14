# Phase 4, slice 2: A/B account classes (D-13)

**Status:** owner chose this as the next step (14 Oct 2026). Built on a branch; **activation depends on the full-sales import** ([MARKET-FULL-SALES-IMPORT-PLAN](MARKET-FULL-SALES-IMPORT-PLAN.md)) and on customer↔Tally links. **Author:** Claude.
**Utility:** decides where visit effort goes. A accounts get the most attention, and the coverage list can be filtered by class.

## 1. Definition (no new revenue rule)
- **Monthly business** = net Tally sales excluding GST, with returns and credit notes signed and FOC counted as zero. Averaged over the **last three complete calendar months** (Asia/Kolkata). This is the window and value rule from the full-sales plan, steps 2 and 5.
- **Policy** (versioned table; only an administrator changes it):
  - **A:** ≥ ₹2,00,000 a month;
  - **B:** ₹75,000 to < ₹2,00,000;
  - **below B:** less than ₹75,000.

## 2. Five states, never four
| State | Shown as | When |
| --- | --- | --- |
| A / B / below B | chip "A", "B", "Below B" | the account is linked to Tally **and** the three-month window has complete sales coverage |
| Not available | muted "Class not available yet" | sales coverage for the window is incomplete. **Never** zero and never "below B" |
| Not linked | muted "Not linked to Tally sales" | there's no person-confirmed customer↔Tally link (`stockflow_economic_customer_identities`) |

An unlinked large account must never look small.

## 3. Gates
1. **Coverage gate:** `private.stockflow_sales_window_complete(company, from, to)`.
   - The branch ships it returning **false**, as an explicit seam.
   - The integration chat replaces it when the bounded full-sales import marks windows complete (plan, step 4). It should probably extend `private.stockflow_economic_source_coverage` with a completeness status; that's their call.
   - Until then every account shows "Class not available yet". That is honest.
2. **Identity gate:**
   - Links exist today only where someone confirmed them (placements, historical instruments), so most accounts are unlinked.
   - **Proposal for the integration chat** (financial and source review owner): a management screen that lists **exact** ledger-master matches (customer `tally_key` = ledger name in the same company export, with the ledger GUID), confirmed **in batches by a person**. Each confirmation writes the identity with `verified_by`.
   - No automatic name linking (plan, step 6). Not built until they agree.

## 4. What the branch builds
- **Policy table and seed:** `private.stockflow_account_class_policies` (thresholds in paise, `effective_from`, actor, reason). Changes are administrator-only, through the accounts gateway's `set_class_policy`.
- **`get_accounts` extension:** `class: { state: 'A'|'B'|'below_b'|'not_available'|'not_linked', monthlyPaise: string|null, window: {from,to} }` per row, plus a `class` filter. The default sort (coverage order) is unchanged.
  - Value: net-sales lines from `stockflow_economic_source_lines` / `vouchers`, latest non-cancelled revision, kinds sale (+) and return/credit (−), summed over the window and divided by 3.
  - Computed **only** when both gates pass.
  - **Flag for the integration chat's financial review:** whether this matches the approved net-value policy (discount, rounding and freight).
- **UI:** a class chip on each card (beside the visit chip, smaller), and a **Class** filter (Any / A / B / Below B / Not available / Not linked).

## 5. Not in this slice
- Classes C and lower (D-13: the rest is "below B").
- Automatic linking.
- Any map.
- The market area (D-19, confirmed: Kalaburagi, Bidar, Raichur, Yadgir, Bijapur). It's used for map bounds and location sanity checks in a later slice.
