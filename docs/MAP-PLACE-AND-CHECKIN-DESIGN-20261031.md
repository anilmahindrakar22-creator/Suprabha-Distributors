# Design: Place on map, and GPS check-in (Market Map v1.2)

*Claude, 31 Oct 2026. Train `claude/train-20261113` or the next one. It follows `PIN-PLACEMENT-DESIGN-20261031.md`.*

**Owner, 31 Oct:** "can we place them on maps manually? and can we do gps check in"

## 1. What exists today
- **The sheet's Pin here chooser:**
  - "Use my location" (GPS at the lab);
  - "Paste a map link or enter coordinates".
- A pinned lab has **Move pin…**.
- **Visits** (`private.stockflow_customer_visits`) store the date, outcome, note and next visit, with **no location**.

## 2. Place on map (manual, from anywhere)
For staff at a desk who know where the lab is.
- **Entry:** the sheet's Pin here chooser gains a third option, **"Place on map"**. **Move pin…** opens the same mode for a pinned lab.
- **Mode:** the sheet closes to a slim bar, and the map shows a **fixed centre crosshair**. The user **pans and zooms the map under the crosshair**. This is easier on a phone than dragging a small marker, and it works with one thumb.
  - **Start view:**
    - the lab's exact pin when moving;
    - else its PIN centre (approximate labs, at zoom 15);
    - else the market area.
  - **The bar:** `Place <lab name>` · **Save here** · **Cancel**. The ± and the coordinates show in muted 12px text.
- **Save** uses the **existing location write** (`precision='pin'`, `source='manual_pin'`), the same POST as the manual flow today:
  - it is rejected outside the market area with the existing `isInsideMarketArea` message;
  - the version check is the existing one.

  After a save, the lab leaves its PIN group, and the map refreshes (the refresh already exists).
- **Same roles** as the existing location write; no new permission.

## 3. GPS check-in (at the lab)
This proves a visit happened at the lab, and fills the map as a side effect.
### 3.1 Behaviour
- **The button:** the sheet's action bar gets **Check in**, next to Call. It replaces nothing; Pin here moves into the chooser if space is short at 375px, and the bar stays one row.
- **The GPS read:** a tap reads GPS once (`enableHighAccuracy`, a 10 s timeout). **There is no background or continuous tracking**: the location is read only on the tap, and only while the app is open.
- **The result:**
  - **Lab has an exact pin:** the app computes the distance to it.
    - **Verified** when the distance is ≤ **150 m** and the accuracy is ≤ **100 m**. The sheet shows a green `Checked in · 40 m from lab`.
    - Otherwise it is saved as **not verified**, in amber: `Checked in · 1.2 km from the lab pin`, or `· GPS too weak (±300 m)`. It's never blocked, because the pin itself can be wrong.
  - **Lab has no exact pin:** the check-in is saved with no distance, and the sheet offers **"Pin lab here too?"** (one tap, using the existing write with `source='manual_pin'` and this reading). That's how the map fills through visits.
- **Linked to the visit:** the visit form ("Save done" or visit outcome) shows `Checked in 10:42 ✓`. When it's saved the same day by the same user for the same lab, the visit links to that check-in automatically.
- **Last visit tile:** a ✓ when the latest visit has a verified check-in.
- **Permission denied:** one muted line, the same as Pin here today.

### 3.2 Data (new migration)
**`private.stockflow_visit_checkins`:**

| column | type and rule |
| --- | --- |
| `id` | uuid pk |
| `customer_id` | fk, `not null` |
| `checked_in_by` | text, `not null` |
| `checked_in_at` | timestamptz, default `now()`, server time |
| `latitude`, `longitude` | numeric(9,6), inside the market area |
| `accuracy_m` | int, 1–5000 |
| `distance_m` | int, null when there's no pin |
| `verified` | boolean, computed **server-side** from the stored pin, never sent by the client |
| `visit_id` | uuid, null, fk to visits; set when the visit is saved |
| `request_id` | text, unique per user (idempotent retry) |

- **The write:** a gateway action `check_in` on the existing accounts gateway path (same roles as visits). The server takes the pin from `stockflow_customer_locations` and computes the distance (haversine) and `verified`.
- **Linking:** the visit write links the latest unlinked same-day check-in by the same user for that customer.
- **Privacy:**
  - Coordinates are visible only to the person who checked in, administrator and management.
  - Others see only `verified` and `distance_m`.
  - Retention matches visits.
  - No raw coordinate leaves StockFlow; tiles get only map coordinates, as today.

## 4. Checks
- **SQL:** `supabase/tests/visit_checkins.sql`, asserting only on fixture rows.
  - **K1:** `verified` is computed server-side, and a client-sent `verified` is rejected.
  - **K2:** ≤ 150 m with accuracy ≤ 100 gives verified; 151 m or accuracy 101 gives not verified.
  - **K3:** no pin gives `distance_m` null and not verified.
  - **K4:** outside the market area gives 22023.
  - **K5:** the same request_id is idempotent.
  - **K6:** the same-day visit links the check-in; another user's or another day's doesn't.
  - **K7:** roles. Sales and operations can check in; a coordinate read by another non-manager returns no lat/lng.
- **Browser** (`customer-map.spec.ts`, 375 and 1280, mocked geolocation):
  - Place on map, crosshair:
    - save posts the map centre;
    - cancel posts nothing;
    - outside the area shows the message;
    - the start view is the PIN centre for an approximate lab.
  - Check in:
    - verified and not-verified copy;
    - no pin offers "Pin lab here too?";
    - denied shows a muted line;
    - the visit form shows the check-in.
  - The action bar stays one row at 375px.
- **Claude's design review** of the crosshair mode and the check-in states on the phone.

## 5. Order of work
These come after the PIN packages (centres → gateway → UI):
1. **Place on map** (UI only; it reuses the existing write).
2. **Check-in:** migration and gateway, then UI.
