# Installed-base register: design (ADR-0011)

**Status:** approved (owner, 13 Oct 2026; D-14). No code until the Economics production cutover is done.
**Phase:** 2 (first item, [MASTER-ROADMAP](planning/MASTER-ROADMAP.md)). **Release gate:** "One register ID per physical instrument; installations and placements linked" ([RELEASE-GATES](planning/RELEASE-GATES.md)).
**Authoritative rule:** economics plan §2: *"A physical Instrument has a persistent asset ID and serial identity… Relocation creates a new placement; it does not rewrite the old customer."*
**Author:** Claude (design), 13 Oct 2026.

## 1. What already exists (most of it)

We are **not** building a new register. `private.stockflow_equipment_installations` is already the register:

| Already true | Evidence |
| --- | --- |
| Every completed installation has a serial number (required at commissioning). | `20260902113000`, `complete_installation` |
| Historical instruments (no order) are registered in the same table from the Tally sale line. | `20261010071925` ("keep it in the existing register") |
| Every economic **placement** must point at a completed installation, and one installation cannot have two overlapping placements. | `stockflow_economic_targets.installation_id`, exclusion constraint |
| Service tickets point at the same installation. | `stockflow_service_tickets.installation_id` |

So installations and placements are **already linked**. One ID per *installation* exists.

## 2. The gap: one ID per *physical instrument*

An installation is an event at one customer. The instrument outlives it.

1. **Relocation is impossible without a duplicate.** A placement's customer must equal its installation's customer (`create_target` check). When an analyser is pulled from Lab A and placed at Lab B, the only way to record it is a second installation row, which becomes a **second identity for the same machine**.
   - **Money impact:** the payback clock restarts at Lab B, and Lab A's unrecovered capital is stranded on a "dead" record. Capital deployed is counted twice in any portfolio total.
2. **Duplicate serials are only checked within one customer**, and only for historical registration. An order commissioning never checks the serial at all. Serials are not normalised (`ab-123 ` ≠ `AB-123`).
3. **Model is typed by hand on each placement** (`model_id`, free text in the Economics form). Two placements of the same machine can carry different model IDs, which silently changes which reagents are mapped to it.

## 3. Design: a thin instrument identity, nothing else

### 3.1 New table `private.stockflow_instruments` (identity only)

| Column | Rule |
| --- | --- |
| `id uuid` | the **register ID** (one per physical machine) |
| `serial_key text` | normalised serial: `upper()`, remove spaces, `-`, `/` and `.`; unique |
| `serial_number text` | as written on the first commissioning (display) |
| `model_id text null` | set on the **first** placement; later placements must match (§3.4) |
| `created_by`, `created_at` | audit |

Nothing financial is copied here. Acquisition cost and placement investment stay in economics (acquisition links, event ledger) and are **linked** through the placement, never duplicated (ADR-0011 cost-separation rule).

### 3.2 Link installations to it
- Add `instrument_id uuid not null references private.stockflow_instruments(id)` to `stockflow_equipment_installations` for **completed** rows (scheduled rows have no serial yet; set at completion).
- One instrument → many installations over time (Lab A, then Lab B). At most one *open* placement at a time is already enforced per installation; add the same rule per instrument (exclusion on `instrument_id` + date range across placements) so a machine can't be "placed" at two labs at once.

### 3.3 Where the ID is assigned
- **Order commissioning** (`complete_installation`) and **historical registration**: look up `serial_key`.
  - Not found → create the instrument, link it.
  - Found and the instrument has **no open placement** (no placement with `effective_to` null or in the future) → this is a relocation or re-install: link to the **same** instrument (requires a reason, recorded in the order event / audit). Installations have no "removed" state today and don't need one: the placement window is the commercial truth.
  - Found and still placed elsewhere → **PT409** "Serial is placed at <customer>; end that placement first."
- **Serial collision** (two different machines genuinely share a serial string): an **administrator** may register with an explicit "different instrument" confirmation and reason. The key then becomes `serial_key || ':' || model_id`. Expected to be rare; the backfill report (§5) shows whether it happens at all.

### 3.4 Placements
- `create_target` (placement): the customer check moves from "installation customer = placement customer" to "**the chosen installation** is at this customer". Relocation = close the old placement (`effective_to`), record the new installation at Lab B (same instrument ID), create the new placement. Old history is never rewritten (plan §2).
- `model_id`: if the instrument already has one, the placement must use it (PT409 otherwise); if not, the first placement sets it. The form pre-fills and locks it.
- Capital: the new placement's opening capital is entered as today (manual, with reason). Carrying unrecovered capital from the old placement is an explicit **capital transfer** event (already in the plan's event ledger types), not automatic. That keeps the books honest and needs no new rule.

### 3.5 What the screens show (one decision each)
- **Economics placement form:** pick the instrument by serial; model is filled and locked. *Decision supported: correct reagent mapping, no restarted payback.*
- **Economics placement row / Service register row:** "Instrument SN … · placed here since … · previously at <customer> (₹x unrecovered moved)". *Decision supported: is this machine earning back what we put in, across moves?*
- No new screen, no new page.

## 4. Deliberately not in this change (utility rule)

| Field (roadmap list) | Why not now | When |
| --- | --- | --- |
| Warranty / contract end, service owner | only drive the service workflow, which the owner deferred (company handles service) | with service, if ever |
| Commercial-model label (rental, demo, loaner, customer-owned) | today every placement *is* our capital; customer-owned machines simply have no placement. A label adds no decision until those cases are actually recorded | when the first non-standard case appears |
| Manufacturer as its own field | the model ID already identifies it for every decision we make | not planned |
| Supplier / purchase evidence, acquisition cost | already in economics (acquisition links); linked, not copied | done |
| Competitor instruments at accounts | Power Map / Market Map evidence (Phases 4–5), different authority | Phases 4–5 |

## 5. Migration and backfill (additive, fails closed)

1. Create `stockflow_instruments`; add nullable `instrument_id` to installations.
2. Backfill: one instrument per distinct `serial_key` among completed installations.
   - **If two completed installations share a `serial_key`, the migration stops and lists them.** It never merges silently. Each pair is either a real relocation (link both, owner/Accounts confirm) or a collision (admin path above). Resolution is a reviewed data script, not a guess.
3. Set `instrument_id not null` for completed rows (check constraint `status <> 'completed' or instrument_id is not null`).
4. Existing placements: unchanged rows, unchanged IDs, unchanged figures. `model_id` on the instrument is back-filled from its placements; **if one instrument's placements disagree, stop and list** (same rule).

**Pre-approval check (integration chat, read-only on production):**
```sql
select upper(regexp_replace(serial_number,'[\s\-/.]','','g')) as serial_key, count(*)
from private.stockflow_equipment_installations
where status = 'completed'
group by 1 having count(*) > 1;
```
plus a count of placements per installation with differing `model_id`. Zero rows means the backfill is mechanical.

**Integration-owner readback, 14 October 2026:** production has zero completed installations, zero duplicate serial groups and zero invalid normalized serials. Its Economics target table is absent, so the model-conflict check is unavailable there. Acceptance has one completed installation, no duplicate/invalid serials and no installation with conflicting placement models. This is a read-only check of current stored rows, not reconciliation of physical machines or approval of the backfill after cutover. Repeat both checks immediately before register integration/release, after the Economics cutover populates the relevant data.

The separately prepared `claude/instrument-register` branch remains outside the approval-controls integration. Its current two-session test proves both unplaced commissioning events link to one instrument ID; it does not demonstrate acceptance check 5's one-success/one-conflict behavior. The design's administrator serial-collision confirmation is also absent from that branch. Reconcile these requirements before register integration; do not silently claim full ADR-0011 acceptance from its passing tests.

## 6. Acceptance checks (written before code)

1. After backfill, every completed installation has an `instrument_id`; the count of instruments = distinct serial keys.
2. Every existing placement, expectation, event and result is byte-identical (snapshot compare) and summary/full economics reads still match (`instrument_economics_summary_read.sql` parity test).
3. Relocation: close placement at A, commission at B with the same serial → **same** instrument ID, new installation, new placement; A's history unchanged.
4. Same serial while still placed at A → PT409.
5. Two sessions commissioning the same serial at once → one succeeds, the other gets PT409 (two-session race test).
6. Placement with a model ID different from the instrument's → PT409.
7. Serial normalisation: `ab-123 `, `AB 123`, `AB/123` resolve to one key.
8. Service tickets and the Service register list are unchanged except the added instrument line.

## 7. Build notes for the later handoff
- Migration sorts after every RC migration (after `20261013120000`).
- Patch existing functions with the `pg_get_functiondef` technique and asserted anchor counts (`complete_installation` in the installation gateway, `stockflow_register_historical_instrument`, `create_target` in the economics gateway).
- Any change to the economics read applies to **both** the summary and full view (the parity test failed on the admin-tier branch when it didn't).
- Business conflicts use PT409, never 40001.
- Size: about one migration, three function patches, two form changes, five SQL tests. Small model first (per orchestration rules); Claude reviews the diff and the screens.

## 8. Owner decision (approved 13 Oct 2026)
ADR-0011 approved as: **"one persistent instrument ID per physical machine (by normalised serial); installations and placements hang off it; relocation keeps the ID and opens a new placement; nothing financial is duplicated."**
