# Suprabha 80, V1: Market Map and wallet (design, Claude, 12 Oct 2026)

**Status:** design only. Nothing is built.
- It builds on the approved direction in `SUPRABHA80-PROFITABLE-WALLET-CAPTURE.md` and the full spec `SUPRABHA80-UI-FUNCTIONAL-TECHNICAL-SPEC.md` (§§ 4–26).
- This document picks the **smallest first release** of that spec: spec sequence steps 4–5 plus the map's WALLET and COVERAGE modes.
- **Later releases:** Opportunity, Action, constraint diagnosis, pricing links and outcome learning.
- **Release rule:**
  - built on its own branch after the current release;
  - new migrations sort after the 15 pending ones;
  - nothing joins the current release candidate.
- The spec says this layer should follow the pricing pilot. The owner asked to start now, so **design now and build after the current release**.

### Dependencies found while designing (resolve before W2)
- **Not all sales are imported yet.**
  - The Economics import is "targeted", around the pilot instruments: 313 source vouchers, and no complete-window claim. "Our sales" needs **every** sales voucher for every customer and item over the window.
  - The connector owner (the integration chat) must confirm the current scope. A full-sales read-only export is a prerequisite.
  - In production, none of this sales data exists until the Economics cutover.
- **Customer identity.**
  - Tally sales link to a StockFlow customer only through `stockflow_economic_customer_identities` (company and source ledger → `stockflow_customers.id`). That table is filled per customer and verified by a person.
  - W2 therefore needs a matching step: an exact Tally ledger key match is proposed automatically and confirmed by a person, never fuzzy.
  - Sales from customers that aren't linked yet show as "Unmatched customers: ₹X" and are never dropped silently.
- **Item groups:** there's no group master table; the group exists only as the `item_group` text on the Tally catalog and order lines. Division mapping keys on that exact text, scoped by company.

## 1. What management gets from V1
One screen, **Market**, that answers two questions:
1. **Where is the money?** For each customer: estimated monthly wallet by division, what we sell them today (from Tally), our share, and the untapped amount.
   - A Pareto line says, for example, "12 customers hold 80% of the untapped wallet". Those 12 are the default list.
2. **What don't we know yet?** Customers with sales but no map pin, no wallet estimate, or an estimate older than 6 months.

It offers a **list** and a **map** of the same records. Tapping either opens the same customer panel.

## 2. Starting point (verified in code)
- **`private.stockflow_customers`** (Tally-synced): `tally_key`, `name`, `phone`, `city`, `tally_balance`. It has **no coordinates, divisions or salesperson.**
- **Tally sales lines:** the Economics import already stores customer sales by product (`stockflow_economic_source_lines`, with the customer identity in `stockflow_economic_customer_identities`). Item groups are already mapped in `stockflow_economic_item_group_mappings`.
  - The history window is about 3 months (`EconomicHistoryMonths=3`).
- **Access:** Economics data is finance-only (administrator, management, accounts).

## 3. Data (all new; nothing copied from Tally)
| Table | Purpose | Key rules |
| --- | --- | --- |
| `stockflow_customer_locations` | one map pin per customer (the canonical geography, spec MAP-FR-04) | `customer_id` unique; `lat` in −90..90 and `lng` in −180..180, `numeric(9,6)`; `source` is `manual_pin` or `pasted_link`; `version`; set by / at. No delete. Every change is written to `stockflow_customer_location_events` with old and new values. |
| `stockflow_wallet_divisions` | management's division list (e.g. Biochemistry, Haematology, Immunoassay, Electrolytes, Coagulation, Urine, Other) | name unique; `active`; ordered |
| `stockflow_wallet_division_groups` | Tally item group → division | one division per item group; changes are audited. **Unmapped groups show as "Unassigned"; nothing is guessed.** |
| `stockflow_wallet_estimates` | estimated monthly wallet per customer and division | **append-only**, effective-dated: `customer_id`, `division_id`, `monthly_wallet_paise` (bigint ≥ 0), `method` (`customer_stated` / `test_volume` / `manager_estimate`), `confidence` (`high` / `medium` / `low`), `note` (required), `as_of` date, entered by and at. The current estimate is the latest by `as_of` and then `created_at`; corrections are new rows. |

- **Our revenue is never stored here.** It is computed when read from the Tally sales lines: the last 3 complete months, net sales, divided by 3. It is tagged with its source run and watermark, and shown as "From Tally, Jul–Sep 2026".
  - **Months** are calendar months in Asia/Kolkata.
  - **Rounding:** integer paise with BigInt, rounding half-up after the ÷3.
  - **Lines with open import exceptions are left out** of the total and counted separately as "₹X under review".
- **Share:** `revenue ÷ wallet`, only when an estimate exists. Otherwise the screen says "No estimate", never 0%.
- **Untapped:** `max(wallet − revenue, 0)`. When revenue is higher than the wallet, the screen flags "Estimate below actual sales; review".

## 4. Commands (single gateway, same safety as the rest of StockFlow)
- **Commands:**

  | Command | Inputs |
  | --- | --- |
  | `set_customer_location` | `customerId, lat, lng, source, expectedVersion?` |
  | `record_wallet_estimate` | `customerId, divisionId, monthlyWalletPaise, method, confidence, note, asOf` |
  | `set_division` | create or rename or deactivate |
  | `map_item_group` | `itemGroupId, divisionId \| null` |

- **Every command:**
  - is idempotent through `begin_/finish_stockflow_command`;
  - is version-checked where it updates a row;
  - is role-checked on the server;
  - writes an audit event.
- **Roles (default):** administrator and management for everything in V1, pins included. The pin picker lives inside Market, which only they can open.
  - Letting sales and operations place pins would need a picker on a screen they can open, such as the customer panel in Orders. That is a later slice (owner decision 2).
- **Read:** `get_market_workspace {mode, page, filters}` returns at most **50 account summaries per page**: id, name, city, pin, total wallet, revenue, share, untapped, confidence, freshness, coverage flags. It also returns the Pareto summary.
  - Per-division detail comes from `get_market_account {customerId}` when a customer is opened.
  - **Map:** returns pins only for the filtered set, capped at 1,000, with clustering on the client.

## 5. Screen: Market (one screen, two modes, list ⇄ map)
- **Header:**
  - mode switch `Wallet | Coverage`;
  - view switch `List | Map`;
  - search;
  - filters: city, division, confidence.
- **Wallet mode, list:**
  - **Pareto line:** "12 customers hold 80% of untapped wallet · ₹8.4 L/month". It defaults to that focus set, with "Show all" to expand.
    - **Always show the base:** "based on 9 of 140 customers with a wallet estimate". Early on, the focus set covers only estimated customers and must not be read as the whole market.
  - **Each row:** customer, city, wallet/month, our sales/month, share bar, untapped, and a confidence dot (high, medium or low, with text).
- **Wallet mode, map:** circles sized by untapped wallet and coloured by share band, clustered when zoomed out.
- **Coverage mode:** three counts, each acting as a filter.

  | Count | Meaning |
  | --- | --- |
  | No map pin | the customer has sales but no pin |
  | No wallet estimate | no estimate has been recorded |
  | Estimate older than 6 months | the latest estimate's `as_of` is more than 6 months old |

  The list shows the customers with those gaps, largest Tally sales first. **No scores and no salesperson ranking** (spec non-goal).
- **Customer panel** (opened from a row or a marker):
  - **name, city, pin status:** "Place on map" opens a pin picker, or accepts a pasted Google Maps link or "lat, lng";
  - **division table:** wallet, our sales, share, untapped, method, confidence, and as-of;
  - **one primary action:** "Update estimate";
  - **history:** collapsed.
- **Language:** plain business words, every estimate shows its method, confidence and date, and missing stays visibly missing.

## 6. Map technology and privacy
- **Library:** Leaflet (open source, no key) behind one adapter component, `components/market-map.tsx`, so the provider can change later (spec 26.10).
  - This is a **new dependency**, so it is an owner decision.
  - It is loaded **only when the Map view opens**: the List view needs no map code.
  - The OSM tile domains must be allowed in the app's content-security policy. That is a security header change under primary review.
- **Pasted locations:** accept only plain "lat, lng" or full map links that contain the coordinates (`@lat,lng` or `q=lat,lng`).
  - Short links such as `maps.app.goo.gl` are rejected with "Open the link and copy the full address bar URL", because resolving them needs an outside request.
- **Map tiles:** OpenStreetMap, with the required attribution. This is fine for low-volume internal use under the OSM tile policy. If usage grows, move to a self-hosted or contracted tile source. **No paid service.**
- **No automatic geocoding.** Sending customer names or addresses to an outside geocoder would share private business data with an unapproved service. Pins are placed by hand or pasted from a map link. Tile requests reveal only the map area being viewed, never customer data.
- **Data stays behind server-side roles.** Pins and wallet figures are commercial data, so only allowed roles receive them.

## 7. Build slices (each: check written first, Codex implements, Claude reviews and commits)
1. **W1, geography:** location table, events, command, and the pin picker in the customer panel. **Check:** set a pin; a stale version gets `40001`; sales can set a pin but not an estimate; a historical (orderless) customer can still be pinned.
2. **W2, divisions:** divisions, item-group mapping, and the revenue read (3 complete months, from Tally lines). **Check:** a fixed set of sales lines gives exact per-division paise; unmapped lines land in "Unassigned"; a cancelled or superseded voucher revision is counted once at most.
3. **W3, wallet:** the append-only estimate table, the command, and the history. **Check:** a correction adds a row and the latest wins; no update or delete is possible; share is not shown without an estimate; the "below actual sales" flag appears.
4. **W4, screen:** the Market list and map, Wallet and Coverage modes, and the Pareto line. **Check:** the Pareto focus set is the smallest set whose cumulative untapped total is ≥ 80%; list and map return identical records for the same filter; 50 per page; the phone layout works.

W1–W3 touch different tables but share the gateway, so they run **one after another**. W4 needs all three.

## 8. Out of V1 (later releases, per spec)
- Opportunity and Action modes;
- constraint diagnosis;
- the Management Action Center;
- pricing links;
- outcome learning;
- territories and salesperson filters (salesperson assignment doesn't exist yet);
- competitor installed base;
- route suggestions;
- any AI.

## 9. Owner decisions (defaults used if none given)
1. **Division list.** Default: Biochemistry, Haematology, Immunoassay, Electrolytes, Coagulation, Urine, Other.
2. **Who can place map pins?** Default for V1: administrator and management, same as estimates. Sales and operations later, through a picker in the Orders customer panel.
3. **Pins by hand or paste only** (no outside geocoding)? Default: yes, by hand or paste.
4. **"Our sales" window.** Default: the last 3 complete months, monthly average, net of returns as Tally records them.
5. **Who sees the Market screen?** Default: administrator and management.
6. **Map library:** add Leaflet (free, open source) and allow OpenStreetMap tiles? Default: yes, loaded only on the Map view. Without it, V1 ships list-only.
7. **Full-sales import:** ask the integration chat to extend the read-only Tally export to all sales vouchers, so "our sales" covers every customer. **Required for the wallet figures.**
