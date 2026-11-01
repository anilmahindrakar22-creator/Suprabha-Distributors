# Lab test mix, equipment fit and brand targeting (spec, 1 Nov 2026)

Owner decisions, 1 Nov 2026:
- VIDAS/CLIA cutoff 15 immunoassay tests per day;
- busiest test recorded with its name;
- HbA1c has no brand;
- DiaSys does CLIA;
- bioMérieux was onboarded last week, and its Tally items are not created yet;
- visible to sales, management and admin only, never to operations.

Train: 22 Nov, branch `claude/train-20261120`, worktree `stockflow-train3`. New migrations use timestamps `20261116xxxxxx` and later.

This file is the only spec. Earlier drafts, such as routine/hormone or HbA1c in the busiest list, are superseded.

## 1. What sales record (quick fill, phone)

### Areas
A fixed list in a new table `private.stockflow_lab_areas` with `code, name, sort_order, brands_hint, active`. It is **not** the wallet divisions, which stay untouched.

| code | name | brands (display hint) |
|---|---|---|
| HAEM | Haematology (CBC) | Nihon Kohden, Sysmex |
| BIOCHEM | Biochemistry | DiaSys, Agappe, Meril |
| IMMUNO | Hormones / immunoassay | bioMérieux (VIDAS), Meril, DiaSys (CLIA) |
| HBA1C | HbA1c | (none) |
| URINE | Urine | Arkray, Sysmex |
| COAG | Coagulation | Sysmex, Tulip |
| RAPID | Rapid tests / serology | J Mitra, Tulip |
| CULTURE | Culture | bioMérieux |

Each area row takes one tap:
- **Not done** (status `not_done`);
- **Sends out** (status `sends_out`);
- one count band (status `in_house`):
  - IMMUNO bands: 1–14, 15–30, 31–60, 61+;
  - every other area: 1–20, 21–50, 51–100, 101+;
- an untouched area is not stored, which means "unknown".

An exact count is optional (an integer from 1 to 100000). When it is given, it overrides the band, and the stored minimum and maximum both equal it.

Stored per area: `status, min_per_day, max_per_day` (null max = open-ended), `exact boolean`.

### Busiest immunoassay test
Optional, and only when IMMUNO is `in_house`.
- **Test:** chosen from a fixed table `private.stockflow_lab_tests`: TSH (the default in the UI), FT4, FT3/T3, Vitamin D, B12, Ferritin, Prolactin, Beta-hCG, PSA, Procalcitonin, Other.
- **Count:** one of the bands 1–3, 4–8, 9+, or an exact number.

### Special immunoassay panels
Optional, from a fixed table `private.stockflow_lab_panels`: Fertility, Vitamin D/B12, Cardiac, Tumour markers, Infectious, Other.
- Each panel is one of: in-house, sent out, or not offered.
- An untouched panel means unknown and is not stored.
- Culture is an area, not a panel.

### Optional total and spend
The same form also takes the existing Lab size fields: total tests per day, basis, the lab's stated monthly spend, and a note.
- When the total is given, the same command calls the existing `private.stockflow_record_lab_size` inside the same transaction.
- A mix-only report doesn't touch the Lab size table.
- The wallet prefill keeps reading Lab size, unchanged.

### No change
One tap. The command `confirm_lab_mix` takes `{customerId, previousReportId}`.
- It inserts a new report copying the latest report's areas, test and panels, with a new `reported_by` and `reported_at`.
- It raises PT409 if `previousReportId` is not the latest report.

### Freshness
A report older than the policy's `stale_after_days` (90) has `stale: true`, and the UI shows "Re-check".

### Target
Under 30 seconds on a 375 px phone. "No change" is one tap.

## 2. Equipment fit (derived at read time, never stored)

The policy is versioned in `private.stockflow_lab_mix_policies`: `version, clia_cutoff_per_day (15), pack_waste_per_day (4), stale_after_days (90), recorded_by, recorded_at`. Only admin and management can set a new version.

IMMUNO fit:

| Fit | Rule |
|---|---|
| `none` | IMMUNO is `not_done` or `sends_out` |
| `vidas` | in_house and `max_per_day < cutoff` |
| `clia` | in_house and `min_per_day >= cutoff` |
| `check` | in_house and the range straddles the cutoff, which only happens after the cutoff is changed. The UI says "Check volume". |
| `unknown` | no IMMUNO row, or no report |

CLIA pack-waste flag:
- `packWasteRisk = true` when fit is `clia` and the busiest test has `max_per_day < pack_waste_per_day`;
- `packWasteRisk = null` when it can't be decided: no busiest test, or a range that straddles the threshold.

The bands are fixed. If the owner changes a threshold, a straddling band reads `check` (or null), never a guessed value.

The pack facts behind 4 a day:
- CLIA packs of 100 or 200 tests expire 30–45 days after opening;
- VIDAS kits of 30 or 60 tests last 8–12 months;
- a 100-test pack over 30 days is about 3.8 per working day.

## 3. Visibility (server enforced)
- The customer sheet's `labMix` (and the existing `labSize`) appear only for administrator, management or sales. Operations gets neither key.
- `record_lab_mix`, `confirm_lab_mix` and every targeting/filter read raise PT403 for anyone else.
- Spend stays administrator and management only (`v_financial`), as today.

## 4. Brand targeting (later package)
Sales lines join products by `source_lines.evidence->>'label' = stockflow_products.tally_item_key`. On production, read-only, 1 Nov: all 2,577 sale lines in the last 180 days matched.
- About 81% of their value is in brand stock groups.
- 18.5% (₹17.5 L of ₹94.3 L) is in `"\u0004 Primary"`.

Mappings, admin and management only:
- **stock group → brand.** Arkray has 3 spellings, J Mitra 2, and Sysmex 3 groups.
- **item → brand** overrides for Primary items.
- **equipment item → area,** for "has our machine" via `stockflow_equipment_installations.tally_key`.

Unmapped sales show as "Unmapped", never guessed. bioMérieux exists as a brand with no items: every lab counts as a prospect.

The targeting list for a chosen brand shows labs that report `in_house` volume in that brand's areas and have low or no sales of that brand from us (180 days). It is ranked by area volume (minimum of the range), with fit, sends-out, freshness and our current brand sales. "Open opportunity" reuses `stockflow_commercial_opportunities`.

## 5. Wallet split (last package)
The two-price wallet comes later, as its own owner-reviewed package. The existing snapshot rule (total = tests × days × price) stays intact until then.

## Packages
| # | Tree | What | Tier |
|---|---|---|---|
| P0 | train2 | Gate the existing `labSize` on the sheet to admin, management and sales, and hide the section for operations (LS9) | standard |
| P1 | train3 | Section 1–3 SQL: tables, policy, record/confirm commands, read with fit, sheet gating, accounts dispatch, Edge allowlist, TS types/parsers | heavy |
| P2 | train3 | Quick-fill UI on the customer sheet | standard |
| P3 | train3 | Brand mappings (SQL + admin screen) | heavy |
| P4 | train3 | Targeting read + filters + UI | heavy |
| P5 | train3 | Wallet split | owner first |

## Acceptance checks
- **SQL (P1), write first:**
  - roles: operations gets PT403 on both commands and no `labMix`/`labSize` keys;
  - validation: unknown area/test/panel codes, overlapping or invalid ranges, a busiest test without in-house IMMUNO, and keys outside the allowed set all fail with 22023;
  - fit at exact 0 (not_done), 14, 15 and null; straddle after a policy change;
  - `packWasteRisk` at 3, 4 and null;
  - `confirm_lab_mix` copies, and gives PT409 when stale;
  - the optional total writes Lab size atomically: a failing Lab size rolls back the mix;
  - reports are immutable (update and delete refused);
  - idempotent replay returns the stored result.
- **Browser (P2):** quick fill on a phone; No change; Re-check badge; operations sees no section.
