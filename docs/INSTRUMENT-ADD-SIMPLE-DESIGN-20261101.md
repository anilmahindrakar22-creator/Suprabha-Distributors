# Design: Add an instrument in four taps, including rentals

**Date:** 1 Nov 2026. **Author:** Claude. **Builder:** Codex. **Train:** `claude/train-20261113`. **Order:** runs after wallet packages P1 and P2, because it shares their registration files.

**Owner feedback (1 Nov, phone screenshots of Instrument economics > Set up):**
- "Instrument setup is too cumbersome."
- "How do I record rental equipment since there will be no billing. But purchase exists."
- "Customer selection brings a big list."
- "Still complex."

## What is wrong today
1. **Six forms in three steps.** The same invoice, lab, serial and date are entered several times.
2. **Raw IDs and system terms are shown to the user.**
   - The instrument pickers show GUID-style labels (`c0071957-… · 2025-10-07 · …-00005977 / 3 · AriQuant…`).
   - "Record the instrument purchase" asks for Target kind, Tally company GUID, Canonical customer GUID, Site ID and Model ID. A person can't know any of these.
3. **Reagents fill the pickers.** They list every quantity-1 line, so a single reagent kit appears as an "instrument".
4. **The customer is picked from a native list of every lab.**
5. **A rental can't be registered.** Registration (`private.stockflow_register_historical_instrument`) requires a Tally **sale** line, and a rental has only our **purchase**.
   - The later stages already allow no billing: `stockflow_economic_billing_current` is true with no billing linked. So investment = purchase cost.

## Evidence (production, read-only, 1 Nov)
- **Equipment filter.** Lines with quantity 1, net ≥ ₹50,000 and not cancelled are only equipment: **21 purchase lines** and **26 sale lines**. Examples: Sys 240, XN-350, XNL 330/550, CA-660, MEK1303, ST200, CelQuant Edge, a microscope and a cold room.
  - The existing quantity-1 filter, with no amount floor, also lists reagent kits such as "SYS 480 Albumin FS".
- **No product flag** marks an item as an instrument (`stockflow_products`: item_group and tracking_mode only). The amount floor is the practical filter. A "Show cheaper items" link keeps everything else reachable.

## The new screen: Set up → "Add an instrument"
**Four taps, one Save. Nothing technical is visible.**

1. **Which machine?** A short list of our equipment purchases not yet used by an instrument.
   - Newest first, with a search box.
   - Each row reads `Sys 240 Biochemistry Analyzer · bought 23 Jul 2026 · ₹4,20,000 · <supplier>`.
2. **Sold or rental?** Two large buttons.
   - **Sold:** a second short list shows the equipment **sale** invoices for the **same item** that no instrument uses yet, for example `Sys 240 · sold 23 Jul 2026 · ₹3,00,000 · <lab>`.
     - **The lab comes from the invoice.**
     - When there is exactly one matching invoice, it is preselected.
   - **Rental:** a lab search box.
     - Type at least 2 letters; at most 20 results, each with its city. Never a full list.
     - Only labs linked to Tally are offered. A lab not linked to Tally shows "Link to Tally first" with a link to that screen.
3. **Serial and installation date,** both prefilled:
   - the serial from the invoice or purchase batch;
   - the date from the sale date (Sold) or the purchase date (Rental).
4. **Check and Save.**
   - One summary line: `Investment ₹1,20,000 = bought ₹4,20,000 − billed ₹3,00,000`. For a rental, billed is ₹0.
   - Save.

**After Save:** the screen shows "Added. Waiting for approval" with an **Approve now** button. It opens this instrument's existing approval review directly, never the 1338-item To do list.

**Reagents** are added later from the instrument's own row ("Add reagents"), with the existing item-group form prefilled for that instrument. This keeps Add short, and the item mapping needs no new rules.

**The old forms move under "Advanced"** (collapsed). They stay for corrections and special cases.

## What the screen fills in itself
These are hidden fields, so the person never sees them:
- **Company:** the purchase line's company.
- **Lab's Tally ledger** (`customerSourceId`):
  - Sold: the sale voucher's customer.
  - Rental: the lab's confirmed ledger identity.
- **Site:** the lab's city, or the lab's name when the city is unknown.
  - Production on 1 Nov has 2 placements, with hand-typed sites "MS Palya" and "Yelahanka". Tally vouchers carry no site (1930 of 1930 null).
- **Model:** the purchase line's item **name**, for example "Sys 240 Biochemistry Analyzer".
  - Existing placements hand-typed "SYS 240".
  - If the instrument already has a model, it must match, and the existing rule (PT409) applies. In that case the screen uses the instrument's model.
- **Name:** `<item> · <lab>`.
- **Effective from:** the installation date.
- **Capital evidence:** `Tally purchase <reference>`.
- **Kind:** placement.

## Server changes (small; reuse what exists)
- **The save runs the existing actions in order from the client, each with its own idempotency key,** kept in the form state so a retry resumes at the failed step:
  1. `register_historical_instrument`, with the rental basis described next;
  2. `create_target`, with `acquisitionPurchaseLineId`;
  3. Sold only: `link_instrument_billing`, with the same sale line.
- **Why not one server command:** `create_target`, `link_instrument_billing` and `set_item_group_mapping` are inline blocks inside `stockflow_economics_gateway` (`20261007183000_instrument_economics_commands.sql`). Pulling them out means rewriting the most sensitive gateway 12 days before the freeze.
  - These steps are already separate saves today, so running them in order is no weaker.
  - If a step fails, the form shows which one and offers Retry. A retry reuses that step's key.
- **The only new SQL is migration `20261102192000_instrument_rental_registration.sql`.** It patches `private.stockflow_register_historical_instrument` with exact-once anchors so it accepts `basis: 'rental'`:
  - **The source line must be a `purchase`:** quantity 1, net > 0, not cancelled, current revision, unresolved = false, dated on or before installation.
  - **No customer identity is written.** The lab must already have a confirmed Tally identity (22023 "Link this lab to Tally first").
  - **`tally_key` is the purchase line key.** The existing unique index stops one purchase becoming two instruments.
  - If the purchase line already has an acquisition or cost link → PT409.
  - The serial must match the batch when there is one.
  - **Sold (no basis, or `basis: 'sold'`) is unchanged.**
- **Readable picker data.** If the workspace read doesn't already return them, add to its `sourceLines`: the party name (supplier or customer ledger name), the amount, and whether an instrument already uses the line. Use the same patch style. Never show ids in the UI.
- **The edge function:** if `economicActions` needs no new action, there's no change. P2 already requires a redeploy.

## Acceptance
- **SQL test `supabase/tests/instrument_rental_registration.sql`:**
  - **IR1:** a rental registration from a purchase line creates the installation; then create_target with that purchase creates a proposed placement whose capital = the purchase amount, with no billing.
  - **IR2:** after approval, health is not `data_incomplete` because of billing.
  - **IR3:** the same purchase used twice → 409.
  - **IR4:** a sale line passed as a rental → 22023, and a purchase passed as Sold → 22023.
  - **IR5:** a lab with no Tally identity → 22023.
  - **IR6:** sold registration and all existing economics tests pass unchanged.
- **Browser (mocked; `/?view=frame&role=administrator&roles=administrator`; see CONSTRAINTS):**
  - The machine list shows only lines of at least ₹50,000, with readable labels and no ids.
  - Sold with one matching invoice preselects it, and the lab text comes from the invoice.
  - The rental lab search needs 2 letters and shows at most 20 results.
  - The summary maths is correct.
  - **POSTs, in order:** register → create_target → link_instrument_billing (Sold), or no billing call (Rental).
  - A failure at step 2 then a retry resumes at step 2 with the same key.
  - Approve now opens the review.
  - The old forms are under Advanced.
  - No horizontal scroll at 375 px.

## Not in this change
- **Monthly rent invoices.** The owner says rentals have no billing. If a rent invoice ever exists, it can be linked as billing later.
- **Moving a rental to another lab.** Keying on the purchase line could collide with the unique index at a second installation. Relocation keeps using the existing register flow; this is noted for a later slice.
- **Customer-owned machines:** no placement, as before.
