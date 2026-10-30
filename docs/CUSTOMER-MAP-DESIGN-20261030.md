# Design: Customer map and customer sheet (Market Map v1)

*Claude, 30 Oct 2026. Train `claude/train-20261113` or the next one. This implements a first slice of `docs/intelligence/MARKET-MAPS.md` (approved design; Leaflet with OpenStreetMap approved by the owner on 12 Oct).*

**Owner, 30 Oct:** "Can we build maps like this. And when we click on customer. It should show details like this. Ui is good. Color also good." The reference was a dark map with coloured pins and a dark bottom sheet holding stat tiles, a "Held back by" line, and a list.

## 1. Data reality (read-only production check, 30 Oct)
- **Pins:** 463 active customers, and **0** have a location row (`private.stockflow_customer_locations`).
- **Town field:** 421 have a `city`, but it's free text with 294 variants (`kalaburagi`, `kalaburgi`, `kalaburagi.`, `dist. kalaburagi.` and so on). It can't be placed on a map without a curated town list.
- **Consequence:** v1 must **fill itself through use**. Each lab sheet gets a one-tap **"Pin here"** (phone GPS) and keeps the existing paste-a-link and manual pin entry. The map header shows coverage (`112 of 463 placed`). Labs with no pin appear in a **"Not on map (351)"** list, so nobody is hidden. Town-level bubbles wait for a curated town list (a separate owner decision).

## 2. Map
- **Library:** Leaflet 1.9.4 (MIT), with OpenStreetMap standard tiles and the required attribution "© OpenStreetMap contributors". It's free with no API key, used at low volume for one small team under the OSM tile policy, with browser caching.
- **Dark look:** a CSS filter on the tile layer only (`invert(0.9) hue-rotate(180deg) brightness(0.85) saturate(0.6)`), with no paid dark tiles.
- **Privacy:** tile requests carry only map coordinates. No customer data leaves StockFlow.
- **Placement:** a new **Map** view inside Accounts (beside Wallet and My actions), for administrator, management, sales and operations, the same roles as Accounts. Full height, at 375px and on desktop. The initial view is the market area (`MARKET_AREA` in the accounts lib), or the bounds of the placed pins.
- **Pins:**
  - a teardrop marker with a flask icon, coloured by **one status**, computed server-side;
  - the marker is larger when the lab is in the Focus band;
  - a small white badge shows the number of open orders when it's above 0;
  - there's no clustering in v1 (at most 500 pins); add clustering when pins exceed 300 in view.
- **Status colours** (each colour means one thing; the legend is always visible):
  | Tone | Meaning (first match wins) |
  | --- | --- |
  | red | an overdue commercial action, or an order stuck over 24 h (the Today U3 rule) |
  | amber | a deadline without a plan, a Focus lab with no diagnosis, or no known decider |
  | green | share at or above the 80% target (certified only) |
  | grey | nothing known yet |
- **Filter chips:** Wallet (the default for administrator/management), Actions, Orders, No data. Each filter only hides pins; it never changes their colour.

## 3. Customer sheet (bottom sheet, as in the reference; amended 30 Oct with the owner's request)
**Owner, 30 Oct:** "Clicking on customer should show relevant information like wallet share, instruments, decision maker and etc."

A dark sheet (`#1b2124` surface, `#262d30` tiles). It opens on a pin tap, on a row tap in "Not on map", and from Today's Grow cards. **Each section appears only when it has content** (the declutter rule). The order runs top to bottom.

1. **Header:**
   - the name;
   - `town · Owner: <assignee> · Class <A/B>` (the class only when published);
   - the **share chip** coloured by share tone, plus a thin share bar with the 80% tick.

   The share chip and bar are administrator/management only.
2. **Held back by:** `Held back by: <current constraint label>` in amber, with the category icon; price that isn't proven gets "(not proven)".
3. **Tiles (4):**
   - **administrator and management:** wallet per month, sales per month, gap per month (danger colour), and last visit;
   - **sales and operations:** open orders, last visit, next action due, and overdue.
4. **Next action:** the earliest open action with one button (**Plan** for administrator/management, **Done** for the owner).
5. **Decision maker:**
   - the decider contact (crown icon, name, role, stance chip: supportive in green, neutral or unknown in amber, opposed in red);
   - "Reach via" route chips, with the champion marked.
   - If no decider is known, one amber row reads "No decider known · Add contact".

   Source: Power Map contacts, influence and route (`stockflow_power_route`).
6. **Instruments** (at most 3 rows, then "+n more"):
   - **Ours:** from the instrument register, installations and Instrument Economics targets. Each row shows the model or item name, the placed date, and the serial.
     - For administrator/management (and accounts, as on the Economics screen), a **payback chip** comes from the existing economics read: "Paying back" (green), "Behind" (red), or "Awaiting data" (grey).
     - Other roles see no chip.
   - **Theirs:** from the current `instrument` constraint facts (`analyser`, `owner`, `closedSystem`) and the `competitor_lock_in` deadline. Each row shows the analyser, "closed system" when set, and the lock-in countdown chip.
   - Nothing is invented: if neither source has data, the section is hidden.
7. **Open work:** orders on this lab that aren't delivered or cancelled (stage chip, number, ₹ for administrator/management, date), plus pending price approvals ("Price" chip, "≈ ₹" from the proposed rate). Each opens the order. At most 3.
8. **Recent orders:** the last 3 delivered orders.
9. **Contacts:** "n contacts · m champions", which opens the existing contacts.
10. **Action bar** (fixed at the bottom of the sheet):
    - **Call:** `tel:` with the primary contact or customer phone; hidden when there's none.
    - **Pin here:** see below.
    - **Order:** starts a new order for this customer, using the existing order capture with the customer preselected.

**Pin here:**
- shown when the lab has no pin, otherwise behind a "Move pin" overflow;
- uses `navigator.geolocation` with high accuracy and a 10 s timeout;
- shows the accuracy and asks for confirmation;
- saves through the existing location write (`precision:'pin'`, `source:'manual_pin'`);
- rejects positions outside `isInsideMarketArea`.

**Never sent to sales or operations:** wallet, sales, share, gap, payback, ₹ order values, or any cost, margin or purchase field. The server omits them; the UI doesn't just hide them.

## 4. Read gateway
`public.stockflow_customer_map_gateway`. It uses the key check, active member, and role from members. Read-only.
- **`get_map_pins`**, payload `{south, west, north, east}`, validated as finite and at most about 3° across.
  - **Returns:** `{coverage:{placed, total}, pins:[{customerId, name, lat, lng, tone, focus, openOrders}], notOnMapCount}`.
  - **Bounds:** at most 500 pins.
  - **Tone:** computed with the §2 rules by reusing the existing reads (wallet read, contract windows, opportunities and constraints, actions, the U3 stuck rule, power coverage). Don't invent new predicates.
  - **Role-based shaping:** for sales and operations, `focus` and the green and amber wallet-based tones are computed **without exposing** wallet figures. The tone is allowed; the numbers are not.
- **`get_not_on_map`**, payload `{page, query?}`: 20 rows per page with `customerId`, `name` and `city`.
- **`get_customer_sheet`**, payload `{customerId}`: the §3 fields, shaped by role. Cost, margin and purchase fields never appear.

Migration `2026110212xxxx_customer_map.sql` holds the function only. No tables.

## 5. Checks
**SQL**, on a real database:
- **M1:** pins inside the bounding box only; town-only and unpinned customers are excluded and counted in `notOnMapCount`.
- **M2:** each tone rule, first match wins.
- **M3:** a sales member gets tones but no wallet, sales or gap keys in pins or the sheet.
- **M4:** an invalid or oversized bounding box returns 22023, and an unauthorised key returns 42501.
- **M5:** the sheet's recent orders, open work and next action are correct.
- **M7:** the decider and route come from the Power Map, and "No decider known" appears when none exists.
- **M8:** instruments show ours (register and targets, with payback for administrator/management only) and theirs (current instrument and lock-in constraints). The section is absent when both are empty.
- **M6:** no `cost`, `margin` or `purchase` keys appear.

**Browser**, at 375 and 1280, with Leaflet tiles mocked to a blank PNG and no network:
- the pins render with tones and the legend;
- a tap opens the sheet;
- the administrator sheet has wallet tiles and the sales sheet doesn't;
- "Pin here" works with mocked geolocation (accept, outside the market area, permission denied);
- the "Not on map" list;
- no horizontal overflow;
- the sheet scrolls on a phone.

## 6. Build notes
- **Dependency:** add `leaflet@1.9.4` and `@types/leaflet`.
  - The `stockflow-train2` worktree currently junctions `node_modules` to `stockflow-classes` (the 8 Nov train).
  - **Before installing,** replace that junction with the worktree's own install (`corepack pnpm@11.19.0 install`), so the 8 Nov environment is untouched.
  - Lazy-load the map component so other screens don't pay for Leaflet.
- **Sequence:** SQL and the read (heavy tier), then the UI (standard tier), then Claude's design review against the owner's reference screenshots.
