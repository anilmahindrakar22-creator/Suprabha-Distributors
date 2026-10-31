# Design: Approximate map placement by PIN code (Market Map v1.1)

*Claude, 31 Oct 2026. Train `claude/train-20261113` or the next one. It builds on `docs/CUSTOMER-MAP-DESIGN-20261030.md` and amends §1 and §M1 there. It depends on migration `20261102130000_customer_city_pin` (stores `pin_code`).*

**Owner, 31 Oct:** "Yes, plan PIN placement on the map." That approves both the design change (approximate locations on the map) and planning the use of the public PIN directory. The **download itself still needs the owner's explicit yes**, with the file name, source and size stated (see §7).

## 1. Why
- **Today:** the map is empty. 0 of 463 labs are pinned, and "Pin here" fills it one visit at a time.
- **PIN codes in Tally (measured 31 Oct, connector snapshot):**
  - **315 of 462** ledgers have a valid 6-digit PIN, across 95 distinct PINs.
  - Kalaburagi city alone spans 585101–585105 (77 / 29 / 24 / 14 / 10 labs).
  - So a PIN shows **which part of the city** and which district town, not just "Kalaburagi".
- **Result:** about two-thirds of labs become visible on day one as **approximate** groups. Exact pins replace them as staff visit.

## 2. Principles
1. **Never fake precision.**
   - An approximate location is drawn as a **group at the PIN centre**, never as a jittered single pin that looks exact.
   - Every approximate element says "approx" in words.
2. **An exact pin always wins.** A lab with an exact pin (`precision='pin'`) is never also counted in a PIN group.
3. **The decision comes first.** A group's colour is its **most urgent lab** (red > amber > green > grey), so a group hiding an overdue lab is red. The tone rules are unchanged (§2 of the map design).
4. **Same role shaping.** Sales and operations get no ₹, share or wallet fields, in groups as everywhere else.
5. **One clear next action.** In an approximate lab's sheet, the location line offers **Pin here** to place it exactly.

## 3. Data
### 3.1 Reference table: `private.stockflow_pin_centroids`
| column | type | note |
| --- | --- | --- |
| `pin_code` | text, primary key | `^[1-9][0-9]{5}$` |
| `latitude`, `longitude` | numeric(9,6) | the PIN centre |
| `district`, `state` | text | from the directory |
| `office_count` | int | post offices used for the centre |
| `source_version` | text | for example `data.gov.in all-india-pincode-directory, fetched 2026-11-01, sha256 <…>` |

- **Scope:** Karnataka PINs only (`56xxxx`–`59xxxx` with `StateName` Karnataka), about 1,400 rows. Labs outside Karnataka stay in "Not on map".
- **Seeded by a migration as static values, about 60 KB.**
  - No runtime call to any external service.
  - Read-only for every role.
  - Readable only inside the security-definer gateway.

### 3.2 Building the centres (one-off script, committed with its output)
- **Script:** `scripts/build-pin-centroids.mjs` reads the downloaded CSV locally and writes `supabase/seed-data/pin-centroids-karnataka.csv` plus the migration's `values` list.
- **Rows used:** a post office counts only when all of these hold:
  - its PIN is valid;
  - its state is Karnataka;
  - its latitude and longitude are numeric, not 0, and not blank;
  - it falls inside the Karnataka box (lat 11.5–18.5, lng 74.0–78.6).

  The source is known to hold placeholder or blank coordinates for some offices.
- **The centre:**
  1. Take the **median** latitude and longitude of the PIN's offices.
  2. Drop offices more than **25 km** from that median (bad geocodes).
  3. Recompute the median.
  4. If the PIN has no office left, it gets no centre and stays "Not on map".
- **Report printed by the script, and recorded in the handover:**
  - the PINs built;
  - the offices dropped;
  - **how many of the 95 customer PINs got a centre**.

### 3.3 Which labs are approximate
An active customer is **approximate** when all three hold:
- it has no exact location (no `stockflow_customer_locations` row with `precision='pin'`);
- its `pin_code` is not null;
- a centre exists for that PIN.

A manual `town` location doesn't change this. Town-only labs with a PIN centre are approximate; without one, they stay in "Not on map".

## 4. Gateway changes (`stockflow_customer_map_gateway`, new migration)
- **`get_map_pins`** (bbox) returns, in addition to `pins`:
  - `approxGroups`: `[{ pinCode, latitude, longitude, count, tone, openOrders }]` for centres inside the bbox.
    - `tone` is the most urgent tone among the group's labs, using the same per-lab tone function as exact pins.
    - `openOrders` is the sum of the group's labs.
    - At most 500 groups.
  - `coverage`: `{ placed, approx, total }`, where `placed` counts exact pins only.
  - `notOnMapCount`: labs that are neither exact nor approximate.
- **New action `get_pin_labs`** (`pinCode`, `page`, `q`) returns a paginated (20) list of the approximate labs in that PIN, in the same row shape as `get_not_on_map`: `customerId`, `name`, `city`, `tone`. It is ordered by tone urgency, then name.
- **`get_not_on_map`** now excludes approximate labs.
- **`get_customer_sheet`** adds `location.approximate: { pinCode }` when the lab is approximate. It never adds coordinates.
- **Same roles and errors** as the existing gateway (PT403 / 42501 / 22023). No financial keys go to sales or operations.

## 5. UI
- **Group marker:** a **circle**, not the teardrop used for exact pins.
  - A thin dashed white ring, filled with the tone colour at 85%.
  - The count sits in the centre (12px bold); the size grows a little with the count (28 px, 34 px from 10 labs, 40 px from 50).
  - A white open-orders badge when above 0, as on pins.
  - Accessible label: `"PIN 585102, approx, 77 labs, <tone meaning>"`.
- **Tapping a group** opens a small dark list sheet: the title `PIN 585102 · approx · 77 labs`, then a searchable, paginated list (the Not-on-map list style). Each row has a tone dot and the name, and tapping a row opens the customer sheet.
- **Header coverage:** `12 placed · 203 approx · 248 not on map`. The parts are tappable: "not on map" opens the existing list.
- **Legend:** add one row, a dashed circle labelled "Approx (PIN centre)".
- **Filter chips** also hide groups that have no lab matching the filter. A group's count shows only the matching labs.
- **Sheet:** under the header, a muted line for approximate labs: `Approx location · PIN 585102 · Pin here to place exactly`. The existing **Pin here** button does the rest. After saving, the lab leaves the group (the refresh already exists).
- **Attribution** gains `PIN locations: India Post via data.gov.in (GODL-India)`.
- **Type sizes and colours** follow `VISUAL-GLANCE-DESIGN-20261030.md`, with no new colours.

## 6. Checks
- **SQL:** `supabase/tests/pin_placement.sql`, on a real database, asserting only on fixture rows.
  - **M9:** a lab with a PIN centre and no exact pin is counted in its group, and not in `pins` or `notOnMapCount`.
  - **M10:** a lab with an exact pin is never in a group, even with a PIN.
  - **M11:** the group tone is the most urgent lab's tone, and the count and openOrders are correct.
  - **M12:** `get_pin_labs` pages 20 at a time and searches by name; the order is tone, then name.
  - **M13:** sales and operations: no financial keys anywhere in groups, `get_pin_labs` or the sheet; `cost`, `margin`, `gross` and `purchase` never appear.
  - **M14:** a PIN with no centre gives "Not on map", and the coverage numbers add up to the total.
- **Unit:** the centroid builder runs on a fixture CSV.
  - The median rule holds.
  - The 25 km outlier is dropped.
  - Placeholder, blank, zero and out-of-box coordinates are rejected.
  - Non-Karnataka rows are ignored.
- **Browser:** `customer-map.spec.ts`, at 375 and 1280.
  - A group renders with its count and label.
  - A tap opens the PIN list, and a row opens the sheet.
  - The sheet shows the approx line.
  - The coverage header shows three numbers.
  - Filters hide groups.
  - No horizontal overflow.
- **Design review (Claude)** on the phone, of the group markers against exact pins in the dark theme.

## 7. Source file and permission
- **Source:** data.gov.in, "All India Pincode Directory with contact details along with Latitude and longitude" (CSV), Government Open Data License – India (GODL-India), which allows reuse with attribution.
- **Before downloading:** Claude states the exact file name, URL and size, and gets the owner's yes.
- **The file:**
  - It is saved to its own empty folder outside the repo, as data only, never run.
  - Only the derived Karnataka centres (§3.2) are committed, with the source file's sha256 in `source_version`.
  - The source is read with node, as data; no script inside it is executed.
- **If data.gov.in is unreachable:** use no third-party mirror without the owner's separate yes.

## 8. Order of work
1. Owner's yes on the download.
2. Claude builds the centres with the script (a Codex package) and records the coverage numbers.
3. Codex: the migration, gateway and SQL tests (heavy review by Claude: role shaping, counts).
4. Codex: the UI (the group marker, PIN list, coverage header and sheet line).
5. Claude runs the browser checks and the design review.
